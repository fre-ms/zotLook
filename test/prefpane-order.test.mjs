// Runs the preference pane script against a real DOM and drives the ordering
// controls. The previous tests only checked that the buttons existed in the
// markup, which is why "the buttons do nothing" went unnoticed.
import fs from 'node:fs';
import { ADDON, loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

async function openPane(prefs = {}, isMac = true) {
  const { DOMParser } = await import('linkedom');
  // Zotero resolves the html: prefix; linkedom needs it stripped
  const fragment = fs.readFileSync(ADDON + 'prefs-pane.xhtml', 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(\/?)html:/g, '<$1');
  const doc = new DOMParser().parseFromString(
    '<html><body>' + fragment + '</body></html>', 'text/html');
  doc.createXULElement = (t) => doc.createElement(t);
  doc.l10n = { setAttributes: (el, id) => el.setAttribute('data-l10n-id', id) };

  const store = { ...prefs };
  const Zotero = {
    debug: () => {},
    isMac,
    getMainWindow: () => null,
    Prefs: {
      get: (n) => store[n],
      set: (n, v) => { store[n] = v; },
      rootBranch: { getChildList: () => [] },
    },
  };
  const { ZotLookUtil } = loadPlugin();
  const src = fs.readFileSync(ADDON + 'prefs-pane.js', 'utf8');
  new Function('Zotero', 'ZotLookUtil', 'document', 'window', 'MutationObserver', src)(
    Zotero, ZotLookUtil, doc, { document: doc },
    class { observe() {} disconnect() {} });
  return { doc, store };
}

// ── "Restore defaults" has to offer a shortcut that can actually fire ──
// The pane writes an explicit value rather than clearing the preference, so
// its idea of the default is what the user ends up with — and Alt+Space, the
// old one, is the window menu on GNOME and on Windows, taken by the window
// manager before Zotero sees the key.
{
  const { ZotLookUtil: U } = loadPlugin();
  for (const isMac of [true, false]) {
    const { doc, store } = await openPane({}, isMac);
    doc.getElementById('zotlook-reset-shortcuts')
       .dispatchEvent(new doc.defaultView.Event('command'));
    eq(store['extensions.zotlook.key.contactSheet'], 'Ctrl+Shift+Space',
       `${isMac ? 'macOS' : 'Linux'}: reset offers the shipped shortcut`);
    eq(store['extensions.zotlook.key.preview'], U.defaultShortcut('key.preview'),
       'and the other actions get theirs');
    // Only how it is written differs: keycap symbols are a Mac convention
    eq(doc.getElementById('zotlook-key-contactSheet').getAttribute('label'),
       isMac ? '\u2303\u21e7Space' : 'Ctrl+Shift+Space',
       'the button face is written the way that platform writes it');
  }
}

const typesInOrder = (doc) =>
  Array.from(doc.querySelectorAll('.zotlook-order-row')).map((r) => r.dataset.type);
const rowFor = (doc, type) =>
  doc.querySelector(`.zotlook-order-row[data-type="${type}"]`);
const press = (doc, id) => {
  const btn = doc.getElementById(id);
  ok(!btn.disabled, `${id} is enabled`);
  btn.dispatchEvent(new doc.defaultView.Event('command'));
};

// ── the stored order is drawn ─────────────────────────────────────────
{
  const { doc } = await openPane({ 'extensions.zotlook.attachmentOrder': 'epub,pdf' });
  eq(typesInOrder(doc).slice(0, 2), ['epub', 'pdf'], 'stored types come first, in order');
  const { ZotLookUtil } = loadPlugin();
  eq(typesInOrder(doc).sort(), ZotLookUtil.ATTACHMENT_TYPES.slice().sort(),
     'and every known type is present exactly once, even those not stored');
}

// ── the buttons actually move things ──────────────────────────────────
{
  const { doc, store } = await openPane();
  const before = typesInOrder(doc);
  eq(before[0], 'pdf', 'PDF starts at the top');

  // select the second row the way a user would, then move it up
  rowFor(doc, 'epub').dispatchEvent(new doc.defaultView.Event('mousedown'));
  press(doc, 'zotlook-order-down');
  eq(typesInOrder(doc)[1], 'html', 'moving down swaps with the row below');
  eq(typesInOrder(doc)[2], 'epub', 'and the moved row follows it');
  eq(store['extensions.zotlook.attachmentOrder'].split(',').slice(0, 3),
     ['pdf', 'html', 'epub'], 'and the new order is stored');

  press(doc, 'zotlook-order-up');
  eq(typesInOrder(doc)[1], 'epub', 'moving up puts it back');
  eq(store['extensions.zotlook.attachmentOrder'].split(',')[1], 'epub', 'and that is stored too');
}

// ── the ends are respected ────────────────────────────────────────────
{
  const { doc } = await openPane();
  rowFor(doc, 'pdf').dispatchEvent(new doc.defaultView.Event('mousedown'));
  eq(doc.getElementById('zotlook-order-up').disabled, true, 'the top row cannot move up');
  rowFor(doc, 'other').dispatchEvent(new doc.defaultView.Event('mousedown'));
  eq(doc.getElementById('zotlook-order-down').disabled, true, 'the bottom row cannot move down');
}

// ── what is stored is a complete ranking ──────────────────────────────
{
  const { doc, store } = await openPane();
  rowFor(doc, 'other').dispatchEvent(new doc.defaultView.Event('mousedown'));
  press(doc, 'zotlook-order-up');
  const { ZotLookUtil } = loadPlugin();
  eq(store['extensions.zotlook.attachmentOrder'].split(',').sort(),
     ZotLookUtil.ATTACHMENT_TYPES.slice().sort(),
     'every type is written out, so the setting is a ranking and not a filter');
  eq(store['extensions.zotlook.attachmentOrder'].split(','), typesInOrder(doc),
     'and it matches what the list shows');
}

// ── "first" mode disables the list ────────────────────────────────────
{
  const { doc } = await openPane({ 'extensions.zotlook.attachmentMode': 'first' });
  eq(doc.getElementById('zotlook-order-box').getAttribute('disabled'), 'true',
     'the list is disabled when the type order does not apply');
  eq(doc.getElementById('zotlook-order-up').disabled, true, 'and so are the buttons');
  eq(rowFor(doc, 'pdf').getAttribute('tabindex'), '-1', 'and the rows drop out of the tab order');
}

// ── the layout that rendered badly ────────────────────────────────────
{
  const css = fs.readFileSync(ADDON + 'prefs-pane.css', 'utf8');
  // comments stripped: the markup explains in prose why richlistitem is gone
  const xhtml = fs.readFileSync(ADDON + 'prefs-pane.xhtml', 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  eq(/richlistitem/.test(xhtml), false,
     'no XUL richlistitem, whose checkbox rendered clipped and widely spaced');
  ok(/\.zotlook-order-row\s*{[^}]*display:\s*flex/.test(css), 'rows are laid out with flexbox');
  ok(/\.zotlook-order-row\s*{[^}]*gap:/.test(css), 'with an explicit gap instead of default spacing');
  eq(/type="checkbox"/.test(xhtml), false, 'and no platform checkbox to misrender');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
