// The preview mechanism differs per platform, and only one of them can hold a
// process open for as long as the preview is visible.
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const on = (platform) => {
  const flags = { isMac: false, isLinux: false, isWin: false };
  flags['is' + platform] = true;
  const { ZotLook: Q } = loadPlugin({ zotero: flags });
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
  // The third argument is "close if already shown", which is what makes a
  // second Space dismiss the preview without a process to kill.
  eq(plan.arguments[plan.arguments.length - 1], 'boolean:true',
     'asking it to close when the same file is already showing');
  eq(plan.holdsProcess, false, 'the request returns at once, so nothing is tracked');
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

// ── the contact sheet needs the bundled renderer ──────────────────────
{
  const mac = on('Mac'), linux = on('Linux');
  eq(mac._contactSheetSupported(), true, 'the contact sheet works on macOS');
  eq(linux._contactSheetSupported(), false, 'and not where its renderer is not shipped');
  eq(await linux._buildContactSheet([{}]), null, 'building one yields nothing there');

  const sheetEntry = mac.MENU_ITEMS.find(e => e.macOnly);
  ok(sheetEntry, 'the contact sheet entries are marked macOS-only');
  const pdf = { isNote: () => false, isAttachment: () => true,
                isPDFAttachment: () => true, attachmentFilename: 'a.pdf' };
  eq(mac._menuApplies(sheetEntry, [pdf]), true, 'shown on macOS with a PDF');
  eq(linux._menuApplies(sheetEntry, [pdf]), false, 'hidden elsewhere');
  const preview = mac.MENU_ITEMS.find(e => !e.macOnly);
  eq(linux._menuApplies(preview, [pdf]), true, 'while the plain preview stays');
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
