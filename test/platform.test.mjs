// The preview mechanism differs per platform, and only one of them can hold a
// process open for as long as the preview is visible.
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const on = (platform, prefValues = {}) => {
  const flags = { isMac: false, isLinux: false, isWin: false };
  flags['is' + platform] = true;
  const { zotLook: Q } = loadPlugin({ zotero: flags, prefValues });
  Q._ensureBinary = async (name) => '/tmp/zt/' + name + '-1.1.0';
  return Q;
};

// ── macOS drives QLPreviewPanel through the bundled helper ────────────
{
  const Q = on('Mac');
  const plan = await Q._previewCommand(['/a/film.mp4']);
  ok(plan, 'macOS has a preview mechanism');
  ok(plan.command.includes('qlpreview'), 'the bundled panel helper');
  eq(plan.arguments, ['/a/film.mp4'], 'given the plain file list');
  eq(plan.holdsProcess, true, 'and it stays running while the preview is up');
}
{
  const Q = on('Mac');
  Q._ensureBinary = async () => null;
  const plan = await Q._previewCommand(['/a/p.pdf']);
  eq(plan.command, '/usr/bin/qlmanage', 'falling back to qlmanage if it cannot be deployed');
  eq(plan.arguments, ['-p', '/a/p.pdf'], 'with the flag that tool needs');
}

// ── Linux asks GNOME's Sushi over D-Bus ───────────────────────────────
{
  const Q = on('Linux');
  const plan = await Q._previewCommand(['/a/paper.pdf']);
  ok(plan, 'Linux has one too');
  eq(plan.command, '/usr/bin/dbus-send', 'reached over D-Bus');
  ok(plan.arguments.includes('--dest=org.gnome.NautilusPreviewer'),
     'addressed to the Nautilus previewer');
  ok(plan.arguments.includes('org.gnome.NautilusPreviewer.ShowFile'),
     'calling ShowFile');
  ok(plan.arguments.includes('string:file:///a/paper.pdf'),
     'with the file as a URI, not a path');
  // Not cosmetic: dbus-send without --print-reply exits before the service it
  // just woke has finished starting, and dbus-daemon then throws the queued
  // message away. Sushi comes up, is never told what to show, and quits on its
  // idle timeout — the preview silently never appears.
  ok(plan.arguments.includes('--print-reply'),
     'waiting for the reply, so the message survives service activation');
  ok(plan.arguments.some(a => a.startsWith('--reply-timeout=')),
     'and bounded, so a wedged service cannot hang the plugin');
  // The third argument is "close if already shown", which is what makes a
  // second Space dismiss the preview without a process to kill.
  eq(plan.arguments[plan.arguments.length - 1], 'boolean:true',
     'asking it to close when the same file is already showing');
  eq(plan.holdsProcess, false, 'the request returns at once, so nothing is tracked');
}
{
  // dbus-send is not at /usr/bin everywhere, so PATH decides when it can
  const { zotLook: Q } = loadPlugin({
    zotero: { isMac: false, isLinux: true, isWin: false },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      pathSearch: async (bin) => '/opt/dbus/bin/' + bin } }) },
  });
  const plan = await Q._previewCommand(['/a/paper.pdf']);
  eq(plan.command, '/opt/dbus/bin/dbus-send', 'found wherever PATH has it');
}
{
  const { zotLook: Q } = loadPlugin({
    zotero: { isMac: false, isLinux: true, isWin: false },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      pathSearch: async () => { throw new Error('not found'); } } }) },
  });
  const plan = await Q._previewCommand(['/a/paper.pdf']);
  eq(plan.command, '/usr/bin/dbus-send', 'falling back to the usual place');
}
{
  // Sushi shows one file; several notes cannot all be handed over
  const Q = on('Linux');
  const plan = await Q._previewCommand(['/a/one.html', '/a/two.html']);
  ok(plan.arguments.includes('string:file:///a/one.html'), 'the first file is shown');
  ok(!plan.arguments.some(a => a.includes('two.html')), 'the rest are not');
}

// ── Windows writes into QuickLook's named pipe ────────────────────────
// QuickLook (QL-Win) listens on QuickLook.App.Pipe.<user SID>; one complete
// UTF-8 line shows the preview, the same line again dismisses it, and a
// different path switches. Both its builds answer the pipe — the Store
// package runs full-trust — so no subprocess and no bundled binary are
// needed: the line is written from the plugin itself via ctypes.
{
  const Q = on('Win');
  eq(Q._platformSupported(), true, 'Windows is a supported platform now');
  Q._winPreview = () => ({
    pipePath: () => '\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-9' });
  const plan = await Q._previewCommand(['C:/a/paper.pdf']);
  ok(plan, 'Windows has a preview mechanism');
  eq(plan.pipePath, '\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-9',
     "addressed to this user's QuickLook pipe");
  eq(plan.pipeLine, 'QuickLook.App.PipeMessages.Toggle|C:/a/paper.pdf|',
     "one Toggle line, exactly as QuickLook's own client sends it");
  eq(plan.holdsProcess, false, 'QuickLook itself toggles, so nothing is tracked');
  eq(plan.command, undefined, 'and no subprocess is involved');
}
{
  // QuickLook shows one file, like Sushi; several cannot all be handed over
  const Q = on('Win');
  Q._winPreview = () => ({ pipePath: () => 'P' });
  const plan = await Q._previewCommand(['C:/a/one.html', 'C:/a/two.html']);
  ok(plan.pipeLine.includes('one.html'), 'the first file is shown');
  ok(!plan.pipeLine.includes('two.html'), 'the rest are not');
}

// ── without ctypes, PowerShell writes the same line ───────────────────
// The fallback for the day Gecko drops js-ctypes. The script resolves the
// user's SID itself — the part of the pipe name a Gecko application cannot
// otherwise reach — and -EncodedCommand carries it without a file, so no
// execution policy applies, and without command-line quoting.
{
  const Q = on('Win');   // the stubbed ChromeUtils has no ctypes to import
  const plan = await Q._previewCommand(['C:/a/paper.pdf']);
  ok(plan.command.toLowerCase().endsWith('powershell.exe'),
     'PowerShell delivers the fallback');
  eq(plan.arguments.slice(0, 3),
     ['-NoProfile', '-NonInteractive', '-EncodedCommand'],
     'headless, and encoded rather than quoted');
  const script = Buffer.from(plan.arguments[3], 'base64').toString('utf16le');
  ok(script.includes(
       "WriteLine('QuickLook.App.PipeMessages.Toggle|C:/a/paper.pdf|')"),
     'the decoded script writes the very same line');
  ok(script.includes('WindowsIdentity'), 'and resolves the SID itself');
  ok(script.includes('QuickLookUnreachable'),
     'a dead pipe is renamed to a stable marker, since .NET localises its own');
  eq(plan.holdsProcess, false, 'one-shot, like the D-Bus route');
}
{
  // A quote in a filename must not end the PowerShell literal around it
  const Q = on('Win');
  const plan = await Q._previewCommand(["C:/a/O'Neill.pdf"]);
  const script = Buffer.from(plan.arguments[3], 'base64').toString('utf16le');
  ok(script.includes("Toggle|C:/a/O''Neill.pdf|"),
     "a quote in the path is doubled, PowerShell's own escape");
}
{
  // powershell.exe is found on PATH when it can be, like dbus-send
  const { zotLook: Q } = loadPlugin({
    zotero: { isMac: false, isLinux: false, isWin: true },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      pathSearch: async (bin) => 'D:/shells/' + bin } }) },
  });
  const plan = await Q._previewCommand(['C:/a/p.pdf']);
  eq(plan.command, 'D:/shells/powershell.exe', 'found wherever PATH has it');
}

// ── the contact sheet is built everywhere, and now shown everywhere ───
// One renderer for every platform, the pdf.js build Zotero ships. Showing
// the sheet outside Zotero needs a preview mechanism, and every platform
// has one now — QuickLook for Windows renders the sheet's HTML and loads
// the thumbnails beside it, which was measured before it was enabled.
{
  const mac = on('Mac'), linux = on('Linux'), win = on('Win');
  eq(mac._contactSheetSupported(), true, 'the contact sheet is built on macOS');
  eq(linux._contactSheetSupported(), true, 'on Linux as well');
  eq(win._contactSheetSupported(), true, 'and on Windows');
  eq(mac._contactSheetPreviewable(), true, 'QuickLook can show it');
  eq(linux._contactSheetPreviewable(), true, 'Sushi can show it');
  eq(win._contactSheetPreviewable(), true, 'QuickLook for Windows can show it');
  const quickLookSheet = mac.MENU_ITEMS.find(e => e.needsSystemPreview);
  ok(quickLookSheet, 'the QuickLook sheet is marked as needing one');
  const pdf = { isNote: () => false, isAttachment: () => true,
                isPDFAttachment: () => true, attachmentFilename: 'a.pdf' };
  eq(mac._menuApplies(quickLookSheet, [pdf]), true, 'shown on macOS with a PDF');
  eq(linux._menuApplies(quickLookSheet, [pdf]), true, 'on Linux');
  eq(win._menuApplies(quickLookSheet, [pdf]), true, 'and on Windows');

  // The window route needs nothing but Zotero, so it is offered everywhere
  const windowSheet = mac.MENU_ITEMS.find(
    e => e.open === '_openContactSheetInViewer');
  eq(win._menuApplies(windowSheet, [pdf]), true, 'the window route stays');
}

// ── the window guard follows the platform ─────────────────────────────
{
  const { DOMParser } = await import('linkedom');
  for (const [platform, expected] of [['Mac', true], ['Linux', true], ['Win', true]]) {
    const doc = new DOMParser().parseFromString(
      '<html><body><div id="zotero-items-tree"/><menupopup id="zotero-itemmenu"/></body></html>',
      'text/html');
    doc.createXULElement = (t) => doc.createElement(t);
    const win = { document: doc, ZoteroPane: { getSelectedItems: () => [] },
                  MozXULElement: { insertFTLIfNeeded: () => {} } };
    Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });
    const flags = { isMac: false, isLinux: false, isWin: false };
    flags['is' + platform] = true;
    const { zotLook: Q } = loadPlugin({ zotero: flags });
    Q.addToWindow(win);
    eq(!!doc.getElementById('zotlook-menu-item'), expected,
       `${platform}: menu entries ${expected ? 'are added' : 'are not added'}`);
  }
}

// ── on Linux, Escape reaches Sushi; the chord stays a live toggle ─────
// Once the preview opens, GNOME hands it the keyboard — as it does when
// Files opens it — and Sushi then answers its own keys: Space, Escape and q
// all close it. The plugin hears nothing until Zotero is focused again, so
// what it can do is answer the presses it does hear: Escape back in Zotero
// sends Sushi its Close.
{
  const launched = [];
  const { zotLook: Q } = loadPlugin({
    zotero: { isMac: false, isLinux: true, isWin: false },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      call: async (o) => { launched.push(o.arguments); return {
        stderr: { readString: async () => '' },
        wait: async () => ({ exitCode: 0 }), kill(){} }; } } }) },
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  // The selection monitor a delivery brings up has its own suite; here it
  // would only be counted as a launch it is not.
  Q._ensureSushiMonitor = () => {};

  const plan = await Q._previewCommand(['/a/paper.pdf']);
  eq(plan.sushiShows, true, 'a ShowFile may put a preview up');
  eq(await Q._deliver(plan), true, 'and is delivered');
  eq(Q._sushiShown, true, 'so the plugin knows something may be showing');

  Q._closeQuickLook();
  await settle(); await settle(); await settle();
  eq(launched.length, 2, "Escape becomes Sushi's Close");
  eq(launched[1][launched[1].length - 1], 'org.gnome.NautilusPreviewer.Close',
     'the method that closes rather than toggles');
  eq(launched[1].includes('--print-reply'), true,
     'delivered like every one-shot call, or activation drops it');
  eq(Q._sushiShown, false, 'and nothing is showing any more');

  Q._closeQuickLook();
  await settle(); await settle();
  eq(launched.length, 2, 'a second Escape sends nothing: there is nothing to close');
}
{
  // A refused request leaves the state alone: nothing went up
  const { zotLook: Q } = loadPlugin({
    zotero: { isMac: false, isLinux: true, isWin: false },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      call: async () => ({
        stderr: { readString: async () => 'Error org.freedesktop.DBus.Error.ServiceUnknown' },
        wait: async () => ({ exitCode: 1 }), kill(){} }) } }) },
  });
  Q._writeFailureReport = async () => {};
  eq(await Q._deliver(await Q._previewCommand(['/a/p.pdf'])), false, 'refused');
  eq(Q._sushiShown, false, 'and not believed to be showing');
  eq(Q._previewerAbsent, true, 'and the reason is known: Sushi is not there');

  // With no Sushi to answer, Space opens the sheet in a window instead
  const shown = [];
  Q._showSheetInViewer = async (items) => { shown.push(items); return true; };
  Q._killPreviewProcess = () => {};
  const items = [{ id: 7 }];
  await Q._launchPreview(['/a/p.pdf'], items);
  eq(shown, [items], 'the window stands in for the missing previewer');
  Q.prefs?.set?.('extensions.zotlook.windowFallback', false);
  Q._pref = (name, fallback) => (name === 'windowFallback' ? false : fallback);
  await Q._launchPreview(['/a/p.pdf'], items);
  eq(shown.length, 1, 'unless the preference says not to');
  Q._pref = (name, fallback) => fallback;
  await Q._launchPreview(['/a/p.pdf']);
  eq(shown.length, 1, 'and never without items to make a sheet of');
}

// ── on Windows the arrows walk the files, and the preview follows the list ──
{
  const Q = on('Win');
  const posted = [];
  Q._winPreview = () => ({ pipePath: () => 'P', lockForeground: () => true, postLine: (p, line) => posted.push(line) });
  Q.SUSHI_STEP_PREVIEW_DELAY_MS = 10;
  const settle = () => new Promise((r) => setTimeout(r, 40));
  Q._pipeShown = true;
  Q._previewList = { paths: ['C:\\a.pdf', 'C:\\b.html'], index: 0 };
  const ev = (key) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '',
    prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} });
  const selected = [{ id: 1, isNote: () => false, isAttachment: () => true }];
  const win = { ZoteroPane: { getSelectedItems: () => selected } };
  Q._getAttachmentPath = async () => 'C:\\next.pdf';
  Q._normalizeForPreview = async (p) => p;
  let e = ev('ArrowRight'); Q._onKeyDown(e, win); await settle();
  eq(posted, ['QuickLook.App.PipeMessages.Switch|C:\\b.html|'], 'right shows the next file of the press, by Switch');
  eq(e.prevented, true, 'and the tree does not see the key');
  e = ev('ArrowDown'); Q._onKeyDown(e, win);
  eq(e.prevented, false, 'down goes on to the tree, which moves the selection');
  await settle();
  eq(posted[1], 'QuickLook.App.PipeMessages.Switch|C:\\next.pdf|', 'and the preview follows once the keys rest');
  eq(Q._pipeShown, true, 'still showing');
  Q._pipeShown = false;
  e = ev('ArrowRight'); Q._onKeyDown(e, win);
  eq(e.prevented, false, 'with nothing up the arrows are the tree\'s');
}

// ── on Windows, Escape reaches QuickLook, and the keyboard stays put ──
{
  const Q = on('Win');
  const posted = [], calls = [];
  Q._winPreview = () => ({
    pipePath: () => '\\\\.\\pipe\\QuickLook.App.Pipe.S-1-5-21-9',
    lockForeground: () => { calls.push('lock'); return true; },
    postLine: (p, line) => { calls.push('post'); posted.push(line); },
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  const plan = await Q._previewCommand(['C:\\a\\p.pdf']);
  eq(plan.shows, true, 'a Toggle may put a preview up');
  eq(await Q._deliver(plan), true, 'and is delivered');
  eq(calls, ['lock', 'post'], 'the foreground is locked before the line goes out, not after');
  eq(Q._pipeShown, true, 'so the plugin knows something may be showing');

  Q._closeQuickLook();
  await settle();   // the Close is not awaited by the key handler that sends it
  eq(posted[1], 'QuickLook.App.PipeMessages.Close||', "Escape becomes QuickLook's Close");
  eq(calls.filter((c) => c === 'lock').length, 1, 'closing locks nothing');
  eq(Q._pipeShown, false, 'and nothing is showing any more');

  Q._closeQuickLook();
  await settle();
  eq(posted.length, 2, 'a second Escape sends nothing: there is nothing to close');
}
{
  // A refused request leaves the state alone: nothing went up
  const Q = on('Win');
  Q._winPreview = () => ({
    pipePath: () => 'P',
    lockForeground: () => true,
    postLine: () => { const e = new Error('no pipe'); e.quickLookAbsent = true; throw e; },
  });
  Q._writeFailureReport = async () => {};
  eq(await Q._deliver(await Q._previewCommand(['C:\\a\\p.pdf'])), false, 'refused');
  eq(Q._pipeShown, false, 'and not believed to be showing');
  eq(Q._previewerAbsent, true, 'and the reason is known: QuickLook is not running');
  const shown = [];
  Q._showSheetInViewer = async (items) => { shown.push(items); return true; };
  Q._killPreviewProcess = () => {};
  await Q._launchPreview(['C:\\a\\p.pdf'], [{ id: 9 }]);
  eq(shown.length, 1, 'so the window stands in');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
