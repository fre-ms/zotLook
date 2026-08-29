// The Windows pipe route, exercised against a fake ctypes.
//
// What these tests pin down is the protocol, not the FFI: QuickLook's pipe
// server dereferences whatever ReadLine returns, so a connection that sends
// anything less than one complete, terminated line kills the server until
// QuickLook is restarted. The line written here must therefore be exact.
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const win = { isMac: false, isLinux: false, isWin: true };

/**
 * A stand-in for js-ctypes covering exactly the surface winpreview.js uses.
 * `impl` supplies one function per Win32 call; every call is recorded.
 */
function makeCtypes(impl) {
  const state = { lastError: 0, calls: [] };
  const handleOf = (v) => ({ _h: v, isNull: () => v === 0 });
  const T_INTPTR = 't_intptr', T_VOIDPTR_PTR = 't_voidptr_ptr';
  const voidptr = Object.assign(
    () => { const h = { value: null, address: () => h }; return h; },
    { ptr: T_VOIDPTR_PTR });
  const char16ptr = Object.assign(
    () => { const h = { address: () => h, readString: () => impl.sidString }; return h; },
    { ptr: 't_wstr_ptr' });
  const uint32 = Object.assign(
    (v) => { const h = { value: v ?? 0, address: () => h }; return h; },
    { ptr: 't_uint32_ptr' });
  const ctypes = {
    winapi_abi: 'winapi',
    int32_t: 't_int32',
    intptr_t: T_INTPTR,
    voidptr_t: voidptr,
    char16_t: { ptr: char16ptr },
    uint32_t: uint32,
    uint8_t: { array: (n) => () => {
      const a = new Uint8Array(n); a.address = () => a; return a; } },
    get winLastError() { return state.lastError; },
    cast: (x, t) => {
      if (t === T_INTPTR) return { value: x && x._h !== undefined ? x._h : 0 };
      if (t === T_VOIDPTR_PTR) return { contents: 'PSID' };
      return x;   // a voidptr cast passes through, so tests can see buffers
    },
    open: (name) => ({
      declare: (fn) => (...args) => {
        state.calls.push([fn, args]);
        return impl[fn](args, state);
      },
      close: () => state.calls.push(['close ' + name]),
    }),
  };
  return { ctypes, state, handleOf };
}

const loadW = (impl) => {
  const { zotLookWinPreview: W } = loadPlugin({ zotero: win });
  const fake = makeCtypes(impl);
  W._ctypes = () => fake.ctypes;
  return { W, ...fake };
};

const calledNames = (state) => state.calls.map(([n]) => n);

// ── the happy path writes one complete, terminated line ───────────────
{
  let wrote = null, closed = [];
  const { W, state, handleOf } = loadW({
    CreateFileW: (args) => { return handleOf(7); },
    WriteFile: (args) => { wrote = { buffer: args[1], length: args[2] }; return 1; },
    CloseHandle: (args) => { closed.push(args[0]); return 1; },
  });
  const line = 'QuickLook.App.PipeMessages.Toggle|C:\\a\\Müller — Studie.pdf|';
  W.postLine('\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-9', line);

  const expected = Array.from(Buffer.from(line + '\r\n', 'utf8'));
  eq(Array.from(wrote.buffer.slice(0, wrote.length)), expected,
     'the bytes are the line as UTF-8, terminated — never a partial message');
  eq(wrote.length, expected.length, 'and the length says exactly that many');
  eq((line.match(/\n/g) || []).length, 0, 'one line per connection: the payload holds no newline');
  eq(closed.length, 1, 'the handle is closed');
  ok(calledNames(state).includes('close kernel32.dll'), 'and the library released');

  const create = state.calls.find(([n]) => n === 'CreateFileW')[1];
  eq(create[1], 0x40000000, 'opened GENERIC_WRITE');
  eq(create[4], 3, 'OPEN_EXISTING — a pipe is connected to, never created');
}

// ── nothing listening is the one failure a user can act on ────────────
{
  const { W, state, handleOf } = loadW({
    CreateFileW: (args, s) => { s.lastError = 2; return handleOf(-1); },
  });
  let error = null;
  try { W.postLine('P', 'L'); } catch (e) { error = e; }
  ok(error, 'a missing pipe throws');
  eq(error.quickLookAbsent, true, 'marked as QuickLook not running');
  ok(calledNames(state).includes('close kernel32.dll'), 'the library is still released');
}

// ── a busy pipe instance is waited for, once, then retried ────────────
// The server keeps a single instance; while it dispatches another client's
// message a connect fails with PIPE_BUSY rather than queueing.
{
  let attempts = 0;
  const { W, state, handleOf } = loadW({
    CreateFileW: (args, s) => {
      attempts++;
      if (attempts === 1) { s.lastError = 231; return handleOf(-1); }
      return handleOf(9);
    },
    WaitNamedPipeW: () => 1,
    WriteFile: () => 1,
    CloseHandle: () => 1,
  });
  W.postLine('P', 'L');
  eq(attempts, 2, 'the connect is retried');
  const waited = state.calls.find(([n]) => n === 'WaitNamedPipeW');
  ok(waited, 'after waiting for the instance to free up');
  eq(waited[1][1], 2000, 'with a bound, so a wedged server cannot hang the plugin');
}

// ── a failed write still closes the handle ────────────────────────────
{
  let closed = 0;
  const { W, handleOf } = loadW({
    CreateFileW: () => handleOf(7),
    WriteFile: (args, s) => { s.lastError = 232; return 0; },
    CloseHandle: () => { closed++; return 1; },
  });
  let error = null;
  try { W.postLine('P', 'L'); } catch (e) { error = e; }
  ok(error, 'the failure is thrown');
  eq(error.quickLookAbsent, undefined, 'but not blamed on QuickLook being absent');
  eq(closed, 1, 'and the handle does not leak');
}

// ── the pipe name is built from the process token's SID ───────────────
{
  let freed = 0, tokenClosed = [];
  const { W, state } = loadW({
    sidString: 'S-1-5-21-4242',
    GetCurrentProcess: () => 'PSEUDO',
    OpenProcessToken: (args) => { args[2].value = 'TOKEN'; return 1; },
    GetTokenInformation: (args, s) => {
      if (args[2] === null) { s.lastError = 122; args[4].value = 44; return 0; }
      return 1;
    },
    ConvertSidToStringSidW: () => 1,
    LocalFree: () => { freed++; return null; },
    CloseHandle: (args) => { tokenClosed.push(args[0]); return 1; },
  });
  eq(W.pipePath(), '\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-4242',
     'the full path QuickLook listens on for this user');
  const openToken = state.calls.find(([n]) => n === 'OpenProcessToken');
  eq(openToken[1][1], 0x0008, 'the token is opened TOKEN_QUERY, nothing more');
  eq(freed, 1, 'the SID string the system allocated is freed');
  eq(tokenClosed.length, 1, 'the token handle is closed');
  ok(calledNames(state).includes('close advapi32.dll'), 'advapi32 is released');
  ok(calledNames(state).includes('close kernel32.dll'), 'kernel32 as well');
}

// ── delivery and refusal, seen from the plugin ────────────────────────
{
  const posted = [];
  const { zotLook: Q, logs } = loadPlugin({ zotero: win });
  Q._winPreview = () => ({
    pipePath: () => '\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-9',
    postLine: (path, line) => posted.push([path, line]),
  });
  await Q._launchPreview(['C:/a/paper.pdf']);
  eq(posted, [['\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-9',
               'QuickLook.App.PipeMessages.Toggle|C:/a/paper.pdf|']],
     'the plan is delivered as one line into the pipe');
  ok(logs.some(l => /Preview request delivered/.test(l)), 'and logged as such');
  eq(Q._proc, null, 'nothing is held: QuickLook does its own toggling');
  eq(Q._isActive, false, 'and no preview state is tracked');
}
{
  const reports = [];
  const { zotLook: Q, logs } = loadPlugin({ zotero: win });
  Q._writeFailureReport = async (what) => { reports.push(what); };
  Q._winPreview = () => ({
    pipePath: () => 'P',
    postLine: () => {
      const e = new Error('Could not open P (Win32 error 2)');
      e.quickLookAbsent = true;
      throw e;
    },
  });
  await Q._launchPreview(['C:/a/paper.pdf']);
  ok(logs.some(l => /QuickLook does not appear to be running/.test(l)),
     'the one actionable failure is named');
  eq(reports, ['the preview request was refused'], 'and a failure report is written');
}

// ── the PowerShell fallback reports the same failure ──────────────────
{
  const reports = [];
  const { zotLook: Q, logs } = loadPlugin({ zotero: win,
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      call: async (o) => {
        eq(o.stderr, 'pipe', 'stderr is captured, so a refusal can be quoted');
        return { stderr: { readString: async () =>
                   'QuickLookUnreachable: Timeout für den Vorgang' },
                 wait: async () => ({ exitCode: 1 }), kill(){} };
      } } }) } });
  Q._writeFailureReport = async (what) => { reports.push(what); };
  await Q._launchPreview(['C:/a/paper.pdf']);
  ok(logs.some(l => /QuickLook does not appear to be running/.test(l)),
     "PowerShell's stable marker maps to the same hint, whatever .NET's locale");
  eq(reports.length, 1, 'and the failure report is written here too');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
