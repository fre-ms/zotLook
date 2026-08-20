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
  const { ZotLook: Q } = loadPlugin({ zotero: flags, prefValues });
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
  const { ZotLook: Q } = loadPlugin({
    zotero: { isMac: false, isLinux: true, isWin: false },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      pathSearch: async (bin) => '/opt/dbus/bin/' + bin } }) },
  });
  const plan = await Q._previewCommand(['/a/paper.pdf']);
  eq(plan.command, '/opt/dbus/bin/dbus-send', 'found wherever PATH has it');
}
{
  const { ZotLook: Q } = loadPlugin({
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

// ── Windows has nothing to drive yet ──────────────────────────────────
{
  const Q = on('Win');
  eq(await Q._previewCommand(['/a/p.pdf']), null, 'no mechanism on Windows');
  eq(Q._platformSupported(), false, 'so the plugin keeps out of the way there');
}

// ── the contact sheet is built everywhere, but not shown everywhere ───
// One renderer for every platform, the pdf.js build Zotero ships. Showing
// the sheet outside Zotero still needs a preview mechanism, and Windows
// has none — so there the window route is all that is offered.
{
  const mac = on('Mac'), linux = on('Linux'), win = on('Win');
  eq(mac._contactSheetSupported(), true, 'the contact sheet is built on macOS');
  eq(linux._contactSheetSupported(), true, 'on Linux as well');
  eq(win._contactSheetSupported(), true, 'and on Windows, for the window route');
  eq(mac._contactSheetPreviewable(), true, 'QuickLook can show it');
  eq(linux._contactSheetPreviewable(), true, 'Sushi can show it');
  eq(win._contactSheetPreviewable(), false, 'nothing on Windows can');
  const quickLookSheet = mac.MENU_ITEMS.find(e => e.needsSystemPreview);
  ok(quickLookSheet, 'the QuickLook sheet is marked as needing one');
  const pdf = { isNote: () => false, isAttachment: () => true,
                isPDFAttachment: () => true, attachmentFilename: 'a.pdf' };
  eq(mac._menuApplies(quickLookSheet, [pdf]), true, 'shown on macOS with a PDF');
  eq(linux._menuApplies(quickLookSheet, [pdf]), true, 'and on Linux');
  eq(win._menuApplies(quickLookSheet, [pdf]), false, 'but not on Windows');

  // The window route needs nothing but Zotero, so it is offered everywhere
  const windowSheet = mac.MENU_ITEMS.find(
    e => e.open === '_openContactSheetInViewer');
  eq(win._menuApplies(windowSheet, [pdf]), true, 'the window route stays');
}

// ── the window guard follows the platform ─────────────────────────────
{
  const { DOMParser } = await import('linkedom');
  for (const [platform, expected] of [['Mac', true], ['Linux', true], ['Win', false]]) {
    const doc = new DOMParser().parseFromString(
      '<html><body><div id="zotero-items-tree"/><menupopup id="zotero-itemmenu"/></body></html>',
      'text/html');
    doc.createXULElement = (t) => doc.createElement(t);
    const win = { document: doc, ZoteroPane: { getSelectedItems: () => [] },
                  MozXULElement: { insertFTLIfNeeded: () => {} } };
    Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });
    const flags = { isMac: false, isLinux: false, isWin: false };
    flags['is' + platform] = true;
    const { ZotLook: Q } = loadPlugin({ zotero: flags });
    Q.addToWindow(win);
    eq(!!doc.getElementById('zotlook-menu-item'), expected,
       `${platform}: menu entries ${expected ? 'are added' : 'are not added'}`);
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
