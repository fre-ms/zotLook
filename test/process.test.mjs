import { loadPlugin } from './load.mjs';
let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`)); };

// ── _runProcess deadline (P1.3) ───────────────────────────────────────
{
  let killed = false;
  const { zotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({ wait: () => new Promise(()=>{}), kill: () => { killed = true; } }) }})}});
  const t0 = Date.now();
  const res = await Q._runProcess('/bin/fake', [], { timeoutMs: 300 });
  const dt = Date.now() - t0;
  eq(res.exitCode, -1, 'timeout yields exitCode -1');
  eq(killed, true, 'timed-out process is killed');
  eq(dt >= 280 && dt < 1500, true, `timeout fires promptly (${dt} ms)`);
}
{
  const { zotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async () => ({ wait: async () => ({ exitCode: 7 }), kill(){} }) }})}});
  eq((await Q._runProcess('/bin/x', [], { timeoutMs: 5000 })).exitCode, 7, 'fast process reports its own code');
  eq((await Q._runProcess('/bin/x', [])).exitCode, 7, 'no timeout requested still works');
}

// ── launch guard (P1.1) ───────────────────────────────────────────────
{
  const { zotLook: Q } = loadPlugin();
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
  const { zotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
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
  const { zotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
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
  const { zotLook: Q } = loadPlugin({ ChromeUtils: { importESModule: () => ({ Subprocess: {
    call: async (o) => { calls.push(o); return { wait: () => new Promise(() => {}), kill(){} }; } }})}});
  Q._ensureBinary = async () => null;

  await Q._launchPreview(['/a/paper.pdf']);
  eq(calls[0].command, '/usr/bin/qlmanage', 'it falls back to qlmanage');
  eq(calls[0].arguments, ['-p', '/a/paper.pdf'], 'with the flag that tool needs');
}

// ── a one-shot preview request is waited for, and reported ────────────
// Sushi is started by D-Bus on demand. A sender that hands over its message
// and leaves before the service is up loses it: dbus-daemon drops what it had
// queued for the activation. So the request has to be awaited — and once it
// is, its exit status is the first thing this plugin has ever had to say why
// a preview did not appear.
{
  const linux = { isMac: false, isLinux: true, isWin: false };
  const stubProc = (exitCode, complaint = '') => ({
    stderr: { readString: async () => complaint },
    wait: async () => ({ exitCode }),
    kill(){},
  });

  {
    let waited = false;
    const { zotLook: Q, logs } = loadPlugin({ zotero: linux,
      ChromeUtils: { importESModule: () => ({ Subprocess: {
        call: async (o) => {
          eq(o.stderr, 'pipe', 'stderr is captured, so a refusal can be quoted');
          return { stderr: { readString: async () => '' },
                   wait: async () => { waited = true; return { exitCode: 0 }; },
                   kill(){} };
        } }})}});
    Q._ensureSushiMonitor = () => {};
    await Q._launchPreview(['/a/paper.pdf']);
    eq(waited, true, 'the request is awaited rather than fired and forgotten');
    eq(Q._proc, null, 'but nothing is held: there is no process to dismiss');
    eq(Q._isActive, false, 'and no preview state to track');
    eq(logs.some(l => /delivered/.test(l)), true, 'delivery is logged');
  }

  {
    const reports = [];
    const { zotLook: Q, logs } = loadPlugin({ zotero: linux,
      ChromeUtils: { importESModule: () => ({ Subprocess: {
        call: async () => stubProc(1,
          'Error org.freedesktop.DBus.Error.ServiceUnknown: The name is not ' +
          'provided by any .service files') }})}});
    Q._writeFailureReport = async (what) => { reports.push(what); };
    Q._ensureSushiMonitor = () => {};
    await Q._launchPreview(['/a/paper.pdf']);
    eq(logs.some(l => /refused \(exit 1\)/.test(l)), true, 'a refusal is logged');
    eq(logs.some(l => /gnome-sushi/.test(l)), true,
       'and names the missing package rather than leaving the user guessing');
    eq(reports.length, 1, 'a failure report is left behind');
  }

  {
    // A preview that works must not leave a failure report behind
    const reports = [];
    const { zotLook: Q } = loadPlugin({ zotero: linux,
      ChromeUtils: { importESModule: () => ({ Subprocess: {
        call: async () => stubProc(0) }})}});
    Q._writeFailureReport = async (what) => { reports.push(what); };
    Q._ensureSushiMonitor = () => {};
    await Q._launchPreview(['/a/paper.pdf']);
    eq(reports, [], 'nothing reported when the request succeeds');
  }
}

// ── the two contact sheet routes ──────────────────────────────────────
// The same generated file is either handed to QuickLook or opened in Zotero's
// viewer window; only the latter can act on the per-page links, because
// QuickLook previews run without JavaScript and do not follow links.
{
  let viewed = null;
  const { zotLook: Q } = loadPlugin({
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
  const { zotLook: Q } = loadPlugin();
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
