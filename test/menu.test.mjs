import { loadPlugin } from './load.mjs';
let fail = 0;
const eq = (g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

// ── item doubles
const store = new Map();
let nextId = 1;
const mkAtt = ({ pdf = false, name = 'f.bin', hasApi = true }) => {
  const id = nextId++;
  store.set(id, { id, isNote: () => false, isAttachment: () => true,
    attachmentFilename: name, ...(hasApi ? { isPDFAttachment: () => pdf } : {}) });
  return id;
};
const mkParent = (attIds) => ({ isNote: () => false, isAttachment: () => false,
  getAttachments: () => attIds });
const Items = { get: (id) => store.get(id) };

// ── _hasPDF / _menuApplies ────────────────────────────────────────────
{
  const { ZotLook: Q } = loadPlugin({ Items });
  const pdfAtt = store.get(mkAtt({ pdf: true, name: 'a.pdf' }));
  const epubAtt = store.get(mkAtt({ pdf: false, name: 'a.epub' }));
  const notyped = store.get(mkAtt({ pdf: false, name: 'scan.PDF', hasApi: false }));
  const note = { isNote: () => true, isAttachment: () => false };

  eq(Q._hasPDF([pdfAtt]), true, 'selected PDF attachment counts');
  eq(Q._hasPDF([epubAtt]), false, 'EPUB attachment does not');
  eq(Q._hasPDF([notyped]), true, 'PDF without content type falls back to filename');
  eq(Q._hasPDF([note]), false, 'a note does not');
  eq(Q._hasPDF([]), false, 'empty selection does not');
  eq(Q._hasPDF([mkParent([epubAtt.id, pdfAtt.id])]), true, 'parent with a child PDF counts');
  eq(Q._hasPDF([mkParent([epubAtt.id])]), false, 'parent without a PDF does not');
  eq(Q._hasPDF([{ isNote: () => false, isAttachment: () => false }]), false, 'item without getAttachments is survivable');

  const preview = Q.MENU_ITEMS.find(e => !e.needsPDF);
  const sheet = Q.MENU_ITEMS.find(e => e.needsPDF);
  eq(Q._menuApplies(preview, [epubAtt]), true, 'preview entry shown for any selection');
  eq(Q._menuApplies(preview, []), false, 'preview entry hidden for empty selection');
  eq(Q._menuApplies(sheet, [epubAtt]), false, 'contact sheet hidden without a PDF');
  eq(Q._menuApplies(sheet, [pdfAtt]), true, 'contact sheet shown with a PDF');
  eq(Q._menuApplies(sheet, undefined), false, 'missing item list is survivable');
}

// ── menu insertion into the item context menu ─────────────────────────
// Inserted directly rather than through Zotero.MenuManager, which accepts only
// an l10n id and therefore renders blank whenever the document's Fluent context
// cannot resolve it.
{
  const { DOMParser } = await import('linkedom');
  const doc = new DOMParser().parseFromString(
    '<html><body><menupopup id="zotero-itemmenu"><menuitem id="zotero-own"/></menupopup></body></html>',
    'text/html');
  // Record the command handlers as they are attached: linkedom's event
  // dispatch does not survive being handed a plain Event, and what matters
  // here is which action an entry is wired to.
  const commands = new Map();
  doc.createXULElement = (tag) => {
    const el = doc.createElement(tag);
    const add = el.addEventListener.bind(el);
    el.addEventListener = (type, fn, opts) => {
      if (type === 'command') commands.set(el.id || el, fn);
      return add(type, fn, opts);
    };
    return el;
  };
  const popup = doc.getElementById('zotero-itemmenu');

  const selected = [store.get(mkAtt({ pdf: true, name: 'm.pdf' }))];
  const win = { document: doc, ZoteroPane: { getSelectedItems: () => selected } };
  Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });

  const { ZotLook: Q } = loadPlugin({ Items });
  const listeners = {};
  Q._addMenuToWindow(win, doc, listeners);

  // ── labels must never be blank
  for (const entry of Q.MENU_ITEMS) {
    const el = doc.getElementById(entry.id);
    ok(el, `${entry.id}: inserted`);
    const label = el && el.getAttribute('label');
    ok(label && label.length > 0, `${entry.id}: carries a non-empty label`);
    eq(el.hasAttribute('data-l10n-id'), false,
       `${entry.id}: does not depend on the document resolving an l10n id`);
  }
  eq(doc.getElementById(Q.MENU_ITEMS[0].id).getAttribute('label'), 'Quick Look',
     'the shipped fallback is used when no bundle is available');

  // ── appended, so Zotero's positional indexing of its own entries holds
  eq(popup.firstElementChild.id, 'zotero-own', "Zotero's own entry stays first");
  eq(popup.lastElementChild.id, Q.MENU_ITEMS[2].id, 'ours are appended at the end');
  ok(doc.getElementById(Q.SEPARATOR_ID), 'a separator sets them apart');

  // ── a reload must not double the entries up
  const before = popup.children.length;
  Q._addMenuToWindow(win, doc, {});
  eq(popup.children.length, before, 'inserting again replaces rather than duplicates');

  // ── visibility follows the selection
  Q._onMenuShowing(doc);
  eq(doc.getElementById(Q.MENU_ITEMS[0].id).hidden, false, 'preview shown for a PDF');
  eq(doc.getElementById(Q.MENU_ITEMS[1].id).hidden, false, 'contact sheet shown for a PDF');
  eq(doc.getElementById(Q.SEPARATOR_ID).hidden, false, 'separator shown with them');

  selected[0] = store.get(mkAtt({ pdf: false, name: 'm.epub' }));
  Q._onMenuShowing(doc);
  eq(doc.getElementById(Q.MENU_ITEMS[1].id).hidden, true, 'contact sheet hidden without a PDF');
  eq(doc.getElementById(Q.MENU_ITEMS[0].id).hidden, false, 'preview still shown');
  eq(doc.getElementById(Q.SEPARATOR_ID).hidden, false, 'separator stays while anything shows');

  selected.length = 0;
  Q._onMenuShowing(doc);
  eq(doc.getElementById(Q.MENU_ITEMS[0].id).hidden, true, 'nothing selected, nothing shown');
  eq(doc.getElementById(Q.SEPARATOR_ID).hidden, true, 'and no stray separator line');

  // ── repeated openings keep working
  selected.push(store.get(mkAtt({ pdf: true, name: 'again.pdf' })));
  for (let i = 0; i < 5; i++) Q._onMenuShowing(doc);
  eq(doc.getElementById(Q.MENU_ITEMS[1].id).hidden, false,
     'the menu still updates after repeated openings');

  // ── clicking routes to the right action
  let opened = null;
  Q._openContactSheetInViewer = (items) => { opened = items; };
  commands.get(Q.MENU_ITEMS[2].id)();
  eq(opened, selected, 'the windowed entry routes to the viewer');

  // ── removal cleans up after itself
  Q._removeMenuFromDocument(doc);
  for (const entry of Q.MENU_ITEMS) {
    eq(doc.getElementById(entry.id), null, `${entry.id}: removed`);
  }
  eq(doc.getElementById(Q.SEPARATOR_ID), null, 'separator removed');
  eq(popup.children.length, 1, "only Zotero's own entry remains");
}


// ── nothing may escape into Zotero's menu build ───────────────────────
// _onMenuShowing runs as a popupshowing listener beside Zotero's own, so a
// fault here must stay contained rather than disturb the menu being built.
{
  const { DOMParser } = await import('linkedom');
  const doc = new DOMParser().parseFromString(
    '<html><body><menupopup id="zotero-itemmenu"/></body></html>', 'text/html');
  doc.createXULElement = (tag) => doc.createElement(tag);
  const win = { document: doc, ZoteroPane: { getSelectedItems: () => [{}] } };
  Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });

  const { ZotLook: Q } = loadPlugin({ Items });
  Q._addMenuToWindow(win, doc, {});
  Q._menuApplies = () => { throw new Error('boom'); };

  let threw = false;
  try { Q._onMenuShowing(doc); } catch (e) { threw = true; }
  eq(threw, false, 'a failing visibility check does not propagate');

  // A pane that is not ready yet must be survivable too
  Object.defineProperty(doc, 'defaultView', { value: {}, configurable: true });
  threw = false;
  try { Q._onMenuShowing(doc); } catch (e) { threw = true; }
  eq(threw, false, 'a window without ZoteroPane is survivable');
}


// ── an unusable attachment must not break the check ───────────────────
{
  const hostile = {
    isNote: () => false, isAttachment: () => true,
    get attachmentFilename() { throw new Error('NS_ERROR_FILE_UNRECOGNIZED_PATH'); },
  };
  const { ZotLook: Q } = loadPlugin({ Items });
  let threw = false, result = null;
  try { result = Q._hasPDF([hostile]); } catch (e) { threw = true; }
  eq(threw, false, 'an attachment whose filename getter throws is survivable');
  eq(result, false, 'and it simply does not count as a PDF');
}

// ── addToWindow must be idempotent ────────────────────────────────────
// startup() and onMainWindowLoad can both reach the same window. Adding a
// second keyboard listener and a second popupshowing handler each time is how
// a window ends up sluggish and the entries appear twice.
{
  const { DOMParser } = await import('linkedom');
  const doc = new DOMParser().parseFromString(
    '<html><body><div id="zotero-items-tree"/><menupopup id="zotero-itemmenu"><menuitem id="zotero-own"/></menupopup></body></html>',
    'text/html');
  doc.createXULElement = (tag) => doc.createElement(tag);
  const tree = doc.getElementById('zotero-items-tree');
  const popup = doc.getElementById('zotero-itemmenu');

  let treeListeners = 0, popupListeners = 0;
  const countOn = (el, counter) => {
    const add = el.addEventListener.bind(el), remove = el.removeEventListener.bind(el);
    el.addEventListener = (...a) => { counter(1); return add(...a); };
    el.removeEventListener = (...a) => { counter(-1); return remove(...a); };
  };
  countOn(tree, (d) => { treeListeners += d; });
  countOn(popup, (d) => { popupListeners += d; });

  const win = { document: doc, ZoteroPane: { getSelectedItems: () => [] },
                MozXULElement: { insertFTLIfNeeded: () => {} } };
  Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });

  const { ZotLook: Q } = loadPlugin({ Items });
  for (let i = 0; i < 4; i++) Q.addToWindow(win);

  eq(treeListeners, 1, 'exactly one keyboard listener after four calls');
  eq(popupListeners, 1, 'exactly one popupshowing handler after four calls');
  eq(popup.querySelectorAll('#zotlook-menu-item').length, 1, 'exactly one preview entry');
  eq(popup.children.length, 1 + 1 + Q.MENU_ITEMS.length,
     "Zotero's entry, one separator and one set of ours");

  Q.removeFromWindow(win);
  eq(treeListeners, 0, 'removal detaches the keyboard listener');
  eq(popupListeners, 0, 'removal detaches the popupshowing handler');
  eq(popup.children.length, 1, "only Zotero's own entry remains");
}

// ── platform guard ────────────────────────────────────────────────────
{
  const { DOMParser } = await import('linkedom');
  const doc = new DOMParser().parseFromString(
    '<html><body><div id="zotero-items-tree"/><menupopup id="zotero-itemmenu"/></body></html>',
    'text/html');
  doc.createXULElement = (tag) => doc.createElement(tag);
  const win = { document: doc, ZoteroPane: { getSelectedItems: () => [] },
                MozXULElement: { insertFTLIfNeeded: () => {} } };
  Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });

  const { ZotLook: Q } = loadPlugin({ Items, zotero: { isMac: false } });
  Q.addToWindow(win);
  eq(doc.getElementById('zotlook-menu-item'), null, 'no entries are added off macOS');
}


// ── strings ───────────────────────────────────────────────────────────
// Loaded asynchronously and cached. _string itself must never touch the
// filesystem: it runs while the context menu is being built, and a synchronous
// Localization does synchronous I/O on the main thread.
{
  const { ZotLook: Q } = loadPlugin();
  eq(Q._string('anything', 'fallback'), 'fallback',
     'before the bundle has loaded, the shipped fallback is used');
  eq(Q._string('anything'), undefined, 'and nothing is invented when there is no fallback');
}
{
  const values = { 'zotlook-menu-preview': 'Übersicht' };
  const { ZotLook: Q } = loadPlugin({
    Localization: function () {
      return { formatValues: async (ids) => ids.map((o) => values[o.id] ?? null) };
    },
  });
  await Q._loadStrings();
  eq(Q._string('zotlook-menu-preview', 'Quick Look'), 'Übersicht', 'a translated string wins');
  eq(Q._string('zotlook-menu-contactsheet', 'Contact Sheet'), 'Contact Sheet',
     'an untranslated one keeps its fallback');
}
{
  const { ZotLook: Q, logs } = loadPlugin({
    Localization: function () { throw new Error('no bundle'); },
  });
  let threw = false;
  try { await Q._loadStrings(); } catch (e) { threw = true; }
  eq(threw, false, 'a bundle that will not load is survivable');
  eq(Q._string('zotlook-menu-preview', 'Quick Look'), 'Quick Look', 'and everything falls back');
  ok(logs.some((l) => /Could not load localization/.test(l)), 'and it is logged');
}

// ── labels are applied to menus already on screen ─────────────────────
{
  const { DOMParser } = await import('linkedom');
  const doc = new DOMParser().parseFromString(
    '<html><body><div id="zotero-items-tree"/><menupopup id="zotero-itemmenu"/></body></html>',
    'text/html');
  doc.createXULElement = (tag) => doc.createElement(tag);
  const win = { document: doc, ZoteroPane: { getSelectedItems: () => [] },
                MozXULElement: { insertFTLIfNeeded: () => {} } };
  Object.defineProperty(doc, 'defaultView', { value: win, configurable: true });

  const values = { 'zotlook-menu-preview': 'Übersicht' };
  const { ZotLook: Q } = loadPlugin({
    Items,
    Localization: function () {
      return { formatValues: async (ids) => ids.map((o) => values[o.id] ?? null) };
    },
  });
  Q.addToWindow(win);
  eq(doc.getElementById('zotlook-menu-item').getAttribute('label'), 'Quick Look',
     'the fallback is shown immediately, without waiting for the bundle');

  await Q._loadStrings();
  eq(doc.getElementById('zotlook-menu-item').getAttribute('label'), 'Übersicht',
     'and is replaced once the bundle has loaded');
  eq(doc.getElementById('zotlook-contactsheet-menu-item').getAttribute('label'),
     'Quick Look Contact Sheet', 'untranslated entries keep their fallback');
}

// ── type-ahead deference ──────────────────────────────────────────────
{
  const { ZotLook: Q } = loadPlugin({ Items });
  let opened = 0;
  Q._openQuickLook = () => { opened++; };
  const win = (typing) => ({ ZoteroPane: { getSelectedItems: () => [{}],
    itemsView: { tree: { _typingString: typing } } } });
  const press = (w) => { let prevented = false; opened = 0;
    Q._onKeyDown({ code:'Space', key:' ', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
      preventDefault(){prevented=true}, stopPropagation(){} }, w);
    return { prevented, opened }; };

  eq(press(win('')), { prevented: true, opened: 1 }, 'Space previews when not typing');
  eq(press(win('mül')), { prevented: false, opened: 0 }, 'Space is left to the search while typing');
  eq(press({ ZoteroPane: { getSelectedItems: () => [{}] } }), { prevented: true, opened: 1 },
     'missing tree is treated as not typing');

  // A shortcut carrying a command modifier cannot be mistaken for typing, so
  // it keeps working during a search
  let sheet = 0;
  Q._openContactSheet = () => { sheet++; };
  let prevented = false;
  Q._onKeyDown({ code:'Space', key:' ', shiftKey:false, altKey:true, metaKey:false, ctrlKey:false,
    preventDefault(){prevented=true}, stopPropagation(){} }, win('mül'));
  eq({ prevented, sheet }, { prevented: true, sheet: 1 },
     'Option+Space still works during a search');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
