import { loadPlugin, stubPrefs } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const { ZotLookUtil: U } = loadPlugin();
const sc = (o) => ({ ctrl:false, alt:false, shift:false, meta:false, ...o });

// ── parseShortcut ─────────────────────────────────────────────────────
eq(U.parseShortcut('Space'), sc({ code:'Space' }), 'bare code');
eq(U.parseShortcut('Shift+Space'), sc({ shift:true, code:'Space' }), 'one modifier');
eq(U.parseShortcut('Meta+y'), sc({ meta:true, key:'y' }), 'single character becomes a key');
eq(U.parseShortcut('Ctrl+Alt+Shift+Meta+KeyQ'),
   sc({ ctrl:true, alt:true, shift:true, meta:true, code:'KeyQ' }), 'all four modifiers');
eq(U.parseShortcut('shift+space'), sc({ shift:true, code:'space' }), 'modifiers are case-insensitive');
eq(U.parseShortcut(''), null, 'empty string');
eq(U.parseShortcut('   '), null, 'blank string');
eq(U.parseShortcut('Bogus+Space'), null, 'unknown modifier rejected');
eq(U.parseShortcut(null), null, 'null');
eq(U.parseShortcut(42), null, 'non-string');

// ── round trip ────────────────────────────────────────────────────────
for (const s of ['Space','Shift+Space','Alt+Space','Meta+y','Ctrl+Alt+KeyQ']) {
  eq(U.formatShortcut(U.parseShortcut(s)), s, `round trip: ${s}`);
}
eq(U.formatShortcut(null), '', 'formatting nothing');
eq(U.formatShortcut(sc({})), '', 'formatting a shortcut with no key');

// ── describeShortcut ──────────────────────────────────────────────────
eq(U.describeShortcut(U.parseShortcut('Alt+Space')), '⌥Space', 'option symbol');
eq(U.describeShortcut(U.parseShortcut('Meta+y')), '⌘Y', 'command symbol, key upper-cased');
eq(U.describeShortcut(U.parseShortcut('Ctrl+Shift+KeyQ')), '⌃⇧Q', 'KeyQ shown as Q');

// ── shortcutFromEvent ─────────────────────────────────────────────────
const ev = (o) => ({ key:'', code:'', ctrlKey:false, altKey:false, metaKey:false, shiftKey:false, ...o });
eq(U.shortcutFromEvent(ev({ key:'Shift' })), null, 'a modifier alone is not a shortcut');
eq(U.shortcutFromEvent(ev({ key:'Meta' })), null, 'command alone is not a shortcut');
eq(U.shortcutFromEvent(ev({ key:' ', code:'Space' })), sc({ code:'Space' }), 'space recorded by code');
eq(U.shortcutFromEvent(ev({ key:'Y', code:'KeyZ', metaKey:true })), sc({ meta:true, key:'y' }),
   'letter recorded by character, not by physical position');
eq(U.shortcutFromEvent(ev({ key:'F5', code:'F5' })), sc({ code:'F5' }), 'function key by code');

// ── conflicts ─────────────────────────────────────────────────────────
const registry = [
  { shortcut: U.parseShortcut('Meta+f'), label: 'Zotero: find' },
  { shortcut: U.parseShortcut('Shift+Meta+y'), label: 'Zotero: sync' },
];
eq(U.findShortcutConflicts(U.parseShortcut('Meta+f'), registry).map(c=>c.label),
   ['Zotero: find'], 'exact collision found');
eq(U.findShortcutConflicts(U.parseShortcut('Meta+y'), registry), [],
   'Cmd+Y does not collide with Cmd+Shift+Y');
eq(U.findShortcutConflicts(U.parseShortcut('Alt+Space'), registry), [], 'unrelated shortcut is free');
eq(U.findShortcutConflicts(null, registry), [], 'nothing conflicts with nothing');
eq(U.findShortcutConflicts(U.parseShortcut('Meta+f'), null), [], 'empty registry');

// ── <key> elements ────────────────────────────────────────────────────
const keyEl = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null) });
eq(U.shortcutFromKeyElement(keyEl({ key:'F', modifiers:'accel' }), true),
   sc({ meta:true, key:'f' }), 'accel is Command on macOS');
eq(U.shortcutFromKeyElement(keyEl({ key:'F', modifiers:'accel' }), false),
   sc({ ctrl:true, key:'f' }), 'accel is Control elsewhere');
eq(U.shortcutFromKeyElement(keyEl({ key:'S', modifiers:'accel shift' }), true),
   sc({ meta:true, shift:true, key:'s' }), 'space-separated modifiers');
eq(U.shortcutFromKeyElement(keyEl({ key:'S', modifiers:'accel,shift' }), true),
   sc({ meta:true, shift:true, key:'s' }), 'comma-separated modifiers');
eq(U.shortcutFromKeyElement(keyEl({ keycode:'VK_ESCAPE', modifiers:'' }), true),
   sc({ code:'ESCAPE' }), 'keycode with the VK_ prefix stripped');
eq(U.shortcutFromKeyElement(keyEl({ modifiers:'accel' }), true), null,
   'element with neither key nor keycode is skipped');

// ── the shipped defaults are internally consistent ────────────────────
const { ZotLook: Q } = loadPlugin();
const bindings = Q.bindings;
eq(bindings.length, 3, 'all three default shortcuts parse');
eq(bindings.map(b => b.open),
   ['_openNotePreview','_openContactSheet','_openQuickLook'],
   'notes and contact sheet are matched before the bare preview');
for (let i = 0; i < bindings.length; i++) {
  for (let j = i + 1; j < bindings.length; j++) {
    if (U.shortcutsEqual(bindings[i], bindings[j])) {
      eq(false, true, `defaults ${i} and ${j} collide`);
    }
  }
}
ok(true, 'no two default shortcuts collide with each other');

// ── an unusable preference is skipped, not fatal ──────────────────────
// An unknown token is accepted as a key code (it simply never matches); what
// cannot be parsed is an empty value or an unknown modifier.
{
  const { ZotLook: B, logs } = loadPlugin({ prefValues: { 'extensions.zotlook.key.notes': '' } });
  eq(B.bindings.length, 2, 'an empty shortcut is dropped, the rest survive');
  eq(B.bindings.length, 2, 'binding list is stable across reads');
  ok(logs.some(l => /Unusable shortcut/.test(l)), 'and it is logged');
}

{
  const { ZotLook: B } = loadPlugin({ prefValues: { 'extensions.zotlook.key.preview': 'Bogus+Space' } });
  eq(B.bindings.length, 2, 'an unknown modifier is dropped too');
}

// ── edits take effect without a restart ───────────────────────────────
{
  const prefs = stubPrefs();
  const { ZotLook: B } = loadPlugin({ Prefs: prefs });
  B.KEY_ACTIONS.forEach(a => B._observePref(a.pref, () => { B._bindings = null; }));
  eq(B.bindings.find(b => b.open === '_openContactSheet').alt, true, 'default is Option+Space');
  prefs.set('extensions.zotlook.key.contactSheet', 'Ctrl+Shift+KeyC');
  const rebound = B.bindings.find(b => b.open === '_openContactSheet');
  eq([rebound.ctrl, rebound.shift, rebound.code], [true, true, 'KeyC'], 'rebinding is picked up live');
}

// ── contact sheet page limit ──────────────────────────────────────────
{
  // 0 means no limit, and that is also where anything unusable lands
  const cases = [[0,0],[500,500],[42,42],[-1,0],['abc',0],[7.9,7],['',0]];
  for (const [stored, expected] of cases) {
    const { ZotLook: B } = loadPlugin({ prefValues: { 'extensions.zotlook.contactSheetMaxPages': stored } });
    eq(B._maxContactSheetPages(), expected, `page limit ${JSON.stringify(stored)} → ${expected}`);
  }
}

// ── one shortcut per action, no duplicates ────────────────────────────
{
  const { ZotLook: Q } = loadPlugin();
  const actions = Q.KEY_ACTIONS.map((a) => a.open);
  eq(actions.length, new Set(actions).size,
     'no action is reachable through two different shortcuts');
  eq(Q.KEY_ACTIONS.map((a) => a.pref).sort(),
     ['key.contactSheet', 'key.notes', 'key.preview'],
     'exactly the three shortcuts the settings offer');
}

// ── contact sheet columns ─────────────────────────────────────────────
{
  const cases = [[5,5],[1,1],[3,3],[20,20],[99,20],[0,5],[-2,5],['abc',5],[4.7,4]];
  for (const [stored, expected] of cases) {
    const { ZotLook: B } = loadPlugin({ prefValues: { 'extensions.zotlook.contactSheetColumns': stored } });
    eq(B._contactSheetColumns(), expected, `columns ${JSON.stringify(stored)} → ${expected}`);
  }
}

// ── reader links ──────────────────────────────────────────────────────
{
  const libraries = new Map([
    [1, { isGroup: false }],
    [7, { isGroup: true, groupID: 4242 }],
  ]);
  const { ZotLook: B } = loadPlugin({ zotero: { Libraries: { get: (id) => libraries.get(id) } } });
  eq(B._readerLink({ key: 'ABCD1234', libraryID: 1 }),
     'zotero://open-pdf/library/items/ABCD1234', 'personal library link');
  eq(B._readerLink({ key: 'WXYZ9876', libraryID: 7 }),
     'zotero://open-pdf/groups/4242/items/WXYZ9876', 'group library link');
  eq(B._readerLink({ libraryID: 1 }), '', 'an item without a key is not addressable');
  eq(B._readerLink(null), '', 'no item at all');
  eq(B._readerLink({ key: 'K', libraryID: 99 }),
     'zotero://open-pdf/library/items/K', 'unknown library falls back to the personal form');
}

// ── the type-ahead guard follows what the user configured ─────────────
{
  const { ZotLook: B } = loadPlugin();
  eq(B._isTypeAheadKey(U.parseShortcut('Space')), true, 'bare Space can be mistaken for typing');
  eq(B._isTypeAheadKey(U.parseShortcut('Shift+Space')), true, 'so can Shift+Space');
  eq(B._isTypeAheadKey(U.parseShortcut('q')), true, 'so can a bare letter');
  eq(B._isTypeAheadKey(U.parseShortcut('Alt+Space')), false, 'Option+Space cannot');
  eq(B._isTypeAheadKey(U.parseShortcut('Meta+y')), false, 'Cmd+Y cannot');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
