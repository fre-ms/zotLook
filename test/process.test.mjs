import { loadPlugin } from './load.mjs';
let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`)); };

// ── _runProcess deadline (P1.3) ───────────────────────────────────────
{
  let killed = false;
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({ wait: () => new Promise(()=>{}), kill: () => { killed = true; } }) }})}});
  const t0 = Date.now();
  const res = await Q._runProcess('/bin/fake', [], { timeoutMs: 300 });
  const dt = Date.now() - t0;
  eq(res.exitCode, -1, 'timeout yields exitCode -1');
  eq(killed, true, 'timed-out process is killed');
  eq(dt >= 280 && dt < 1500, true, `timeout fires promptly (${dt} ms)`);
}
{
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({ wait: async () => ({ exitCode: 7 }), kill(){} }) }})}});
  eq((await Q._runProcess('/bin/x', [], { timeoutMs: 5000 })).exitCode, 7, 'fast process reports its own code');
  eq((await Q._runProcess('/bin/x', [])).exitCode, 7, 'no timeout requested still works');
}

// ── reading what a process prints ─────────────────────────────────────
// The renderer reports what it drew on stdout. Nothing here was captured at
// first, so the manifest never arrived and no contact sheet was ever written
// — while every test passed, because they all stub _runProcess itself.
{
  const chunks = ['{"pageCount":2,', '"pages":[]}', ''];
  let read = 0;
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({
      stdout: { readString: async () => chunks[read++] },
      wait: async () => ({ exitCode: 0 }), kill(){},
    }) }})}});

  const plain = await Q._runProcess('/bin/x', []);
  eq(plain.stdout, undefined, 'output is not read unless it is asked for');

  read = 0;
  const captured = await Q._runProcess('/bin/x', [], { captureOutput: true });
  eq(captured.stdout, '{"pageCount":2,"pages":[]}',
     'and every chunk is joined when it is, not just the first');

  read = 0;
  const timed = await Q._runProcess('/bin/x', [],
    { captureOutput: true, timeoutMs: 5000 });
  eq(timed.stdout, '{"pageCount":2,"pages":[]}', 'with a deadline set as well');
}
{
  // Subprocess hands back an object from another compartment, and hanging a
  // property on it through the wrapper fails silently outside strict mode.
  // A frozen object reproduces that: the result must be built, not decorated.
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({
      stdout: { readString: async () => '' },
      wait: async () => Object.freeze({ exitCode: 0 }), kill(){},
    }) }})}});
  const res = await Q._runProcess('/bin/x', [], { captureOutput: true });
  eq(res.stdout, '', 'output survives a result that cannot be written to');
  eq(res.exitCode, 0, 'and the exit code comes along with it');
}
{
  // A process without a pipe, or one that fails mid-read, must not take the
  // whole preview down with it
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({ wait: async () => ({ exitCode: 0 }), kill(){} }) }})}});
  eq((await Q._runProcess('/bin/x', [], { captureOutput: true })).stdout, '',
     'no pipe yields an empty string');
}
{
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({
      stdout: { readString: async () => { throw new Error('pipe broke'); } },
      wait: async () => ({ exitCode: 0 }), kill(){},
    }) }})}});
  eq((await Q._runProcess('/bin/x', [], { captureOutput: true })).stdout, '',
     'and a broken pipe yields one too');
}

// ── launch guard (P1.1) ───────────────────────────────────────────────
{
  const { ZotLook: Q } = loadPlugin();
  let started = 0, release;
  const gate = new Promise(r => { release = r; });
  const p1 = Q._withLaunchGuard(async () => { started++; await gate; return 'first'; });
  eq(await Q._withLaunchGuard(async () => { started++; return 'second'; }), false, 'concurrent request refused');
  eq(started, 1, 'refused request never ran its body');
  release();
  eq(await p1, 'first', 'first request completes');
  eq(await Q._withLaunchGuard(async () => 'third'), 'third', 'guard released afterwards');
  eq(await Q._withLaunchGuard(async () => { throw new Error('boom'); }), false, 'thrown error contained');
  eq(await Q._withLaunchGuard(async () => 'after'), 'after', 'guard released after a throw');
}

// ── process identity (P1.2) ───────────────────────────────────────────
{
  const spawned = [];
  const makeProc = () => { let done; const p = new Promise(r => { done = r; });
    return { killed:false, wait:()=>p, kill(){this.killed=true;done({exitCode:0});}, finish(){done({exitCode:0});} }; };
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async (o) => { const p = makeProc(); p.opts = o; spawned.push(p); return p; } }})}});
  Q._ensureBinary = async () => '/tmp/zt/qlpreview-1.1.0';
  const tick = () => new Promise(r => setImmediate(r));

  await Q._launchPreview(['/a.pdf']);
  eq(Q._isActive, true, 'first launch marks preview active');
  const p1 = spawned[0];
  await Q._launchPreview(['/b.pdf']);
  eq(p1.killed, true, 'previous preview killed, not orphaned');
  eq(spawned.length, 2, 'exactly two processes spawned');
  const p2 = spawned[1];
  eq(Q._proc === p2, true, '_proc points at the new process');
  await tick(); await tick();
  eq(Q._isActive, true, 'stale exit handler leaves the new preview active');
  eq(Q._proc === p2, true, 'stale exit handler does not clear _proc');
  p2.finish(); await tick(); await tick();
  eq(Q._isActive, false, 'own exit clears active state');
  eq(Q._proc, null, 'own exit clears _proc');
}

// ── the preview runs through the panel helper, not qlmanage ───────────
// qlmanage is a debugging tool: Apple's movie generator crashes inside it, so
// videos could not be previewed at all. QLPreviewPanel is what the Finder uses.
{
  const calls = [];
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async (o) => { calls.push(o); return { wait: () => new Promise(() => {}), kill(){} }; } }})}});
  Q._ensureBinary = async (name) => '/tmp/zt/' + name + '-1.1.0';

  await Q._launchPreview(['/a/film.mp4']);
  eq(calls[0].command, '/tmp/zt/qlpreview-1.1.0', 'the bundled panel helper is used');
  eq(calls[0].arguments, ['/a/film.mp4'], 'and gets the plain file list');
  eq(calls[0].arguments.includes('-p'), false, "no qlmanage's -p flag");
}
{
  // If the helper cannot be deployed, a preview is better than none
  const calls = [];
  const { ZotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async (o) => { calls.push(o); return { wait: () => new Promise(() => {}), kill(){} }; } }})}});
  Q._ensureBinary = async () => null;

  await Q._launchPreview(['/a/paper.pdf']);
  eq(calls[0].command, '/usr/bin/qlmanage', 'it falls back to qlmanage');
  eq(calls[0].arguments, ['-p', '/a/paper.pdf'], 'with the flag that tool needs');
}

// ── the two contact sheet routes ──────────────────────────────────────
// The same generated file is either handed to QuickLook or opened in Zotero's
// viewer window; only the latter can act on the per-page links, because
// QuickLook previews run without JavaScript and do not follow links.
{
  let viewed = null;
  const { ZotLook: Q } = loadPlugin({
    zotero: { openInViewer: (uri) => { viewed = uri; } },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      call: async () => ({ wait: async () => ({ exitCode: 0 }), kill(){} }) }})},
  });
  Q._buildContactSheet = async () => '/tmp/zt/QuickLook/sheet.html';

  eq(await Q._openContactSheetInViewer([{}]), true, 'the windowed route succeeds');
  eq(viewed, 'file:///tmp/zt/QuickLook/sheet.html', 'and hands the viewer a file URI');

  const launched = [];
  Q._launchPreview = async (paths) => { launched.push(...paths); };
  eq(await Q._openContactSheet([{}]), true, 'the QuickLook route succeeds');
  eq(launched, ['/tmp/zt/QuickLook/sheet.html'], 'and previews the same file');

  // A sheet that could not be built must not open an empty window
  viewed = null;
  Q._buildContactSheet = async () => null;
  eq(await Q._openContactSheetInViewer([{}]), false, 'no sheet, no window');
  eq(viewed, null, 'the viewer is not called at all');
  eq(await Q._openContactSheet([{}]), false, 'no sheet, no preview either');
}

// ── note rendering (P1.7 + P2 #10) ────────────────────────────────────
{
  const { ZotLook: Q } = loadPlugin();
  const html = Q._buildNoteHtml('Notiz & mehr', '<p>Text</p><script>alert(1)</script><img src=x onerror="y()">');
  eq(/<p>Text<\/p>/.test(html), true, 'note content preserved');
  eq(/alert\(1\)/.test(html), false, 'script in a note removed');
  eq(/onerror/i.test(html), false, 'handler in a note removed');
  eq(/Notiz/.test(html), true, 'title carried over');
  eq(html.startsWith('<!DOCTYPE html>'), true, 'note page has a doctype');
  const full = Q._buildNoteHtml('t', '<html><body><p>whole doc</p></body></html>');
  eq(/<p>whole doc<\/p>/.test(full), true, 'note stored as a whole document works too');
  eq(/<body><p>whole doc/.test(full), true, 'no nested body in the output');
  let threw = false;
  try { Q._buildNoteHtml('t', ''); } catch (e) { threw = true; }
  eq(threw, false, 'empty note does not throw');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
