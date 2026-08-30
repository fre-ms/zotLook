// Recording a shortcut, and the two ways the pane has to say that one will
// not do.
//
// Both were reported from use. A combination the system claims never reaches
// Zotero at all, so the pane sat on "press keys…" for ever and said nothing —
// which reads as "recording is broken". And a collision inside Zotero was
// only ever announced in the moment of recording, so an assignment that
// already clashed was invisible on opening the pane, while one of the two
// actions silently never fired.
import { openPane, command, key } from './pane.mjs';
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const PREF = (k) => 'extensions.zotlook.key.' + k;
const note = (doc, k) => doc.getElementById('zotlook-note-' + k);
const noteId = (doc, k) =>
  note(doc, k).hidden ? null : note(doc, k).getAttribute('data-l10n-id');

// ── the ordinary case still works ─────────────────────────────────────
{
  const { doc, store } = await openPane();
  const button = doc.getElementById('zotlook-key-preview');
  command(doc, 'zotlook-key-preview');
  eq(button.getAttribute('data-l10n-id'), 'zotlook-prefs-key-recording',
     'the button says it is listening');

  key(doc, 'keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
  key(doc, 'keydown', { key: 'y', code: 'KeyY', metaKey: true });
  eq(button.getAttribute('label'), '⌘Y', 'the face follows the keys');
  key(doc, 'keyup', { key: 'y', code: 'KeyY', metaKey: true });

  eq(store[PREF('preview')], 'Meta+y', 'and the combination is stored');
  eq(noteId(doc, 'preview'), null, 'with nothing to complain about');
}
{
  // Escape leaves the stored value alone
  const { doc, store } = await openPane({ [PREF('preview')]: 'Space' });
  command(doc, 'zotlook-key-preview');
  key(doc, 'keydown', { key: 'Escape', code: 'Escape' });
  eq(store[PREF('preview')], 'Space', 'Escape abandons the recording');
  eq(doc.getElementById('zotlook-key-preview').getAttribute('label'), 'Space',
     'and the old combination comes back on the face');
}

// ── a combination that never arrives ──────────────────────────────────
// The system takes it before Zotero sees it, so the modifiers come down and
// go up again with nothing in between. That absence is the only evidence
// there is: neither macOS nor Windows publishes a list to consult.
{
  const { doc, store } = await openPane({ [PREF('preview')]: 'Space' });
  command(doc, 'zotlook-key-preview');

  // ⌘ down, ⌘ up — the letter in between was swallowed
  key(doc, 'keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
  key(doc, 'keyup', { key: 'Meta', code: 'MetaLeft' });

  eq(noteId(doc, 'preview'), 'zotlook-prefs-key-unreachable',
     'the pane says the combination did not reach Zotero');
  eq(store[PREF('preview')], 'Space', 'and nothing was stored');
  eq(doc.getElementById('zotlook-key-preview').getAttribute('label'), 'Space',
     'the recording ends rather than waiting for ever');
}
{
  // Two modifiers, released one after the other: nothing may be said while
  // one is still held, or the note fires mid-combination
  const { doc } = await openPane();
  command(doc, 'zotlook-key-notes');
  key(doc, 'keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
  key(doc, 'keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true });
  key(doc, 'keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });
  eq(noteId(doc, 'notes'), null, 'silent while a modifier is still down');
  key(doc, 'keyup', { key: 'Meta', code: 'MetaLeft' });
  eq(noteId(doc, 'notes'), 'zotlook-prefs-key-unreachable',
     'and only once the last one is let go');
}
{
  // A key that did arrive must never be reported as missing, however the
  // modifiers are released afterwards
  const { doc, store } = await openPane();
  command(doc, 'zotlook-key-notes');
  key(doc, 'keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
  key(doc, 'keydown', { key: 'k', code: 'KeyK', altKey: true });
  key(doc, 'keyup', { key: 'Alt', code: 'AltLeft' });
  eq(store[PREF('notes')], 'Alt+k', 'the combination is stored');
  eq(noteId(doc, 'notes'), null, 'and not called unreachable');
}
{
  // Without any modifier there is nothing to conclude from: a bare key that
  // never arrives is indistinguishable from a user who pressed nothing
  const { doc } = await openPane();
  command(doc, 'zotlook-key-notes');
  key(doc, 'keyup', { key: 'a', code: 'KeyA' });
  eq(noteId(doc, 'notes'), null, 'a stray keyup alone says nothing');
  eq(doc.getElementById('zotlook-key-notes').getAttribute('data-l10n-id'),
     'zotlook-prefs-key-recording', 'and the recording stays open');
}

// ── a collision inside zotLook, made visible and kept visible ─────────
// bindings.find() takes the first match, so two actions on one combination
// means one of them never fires. Until now the pane said so once, in the
// moment of recording, and never again.
{
  const { doc } = await openPane({
    [PREF('preview')]: 'Ctrl+Alt+K',
    [PREF('notes')]: 'Ctrl+Alt+K',
  });
  eq(noteId(doc, 'preview'), 'zotlook-prefs-conflict',
     'an existing collision is announced on opening, not only on recording');
  eq(noteId(doc, 'notes'), 'zotlook-prefs-conflict', 'on both rows');
  eq(doc.getElementById('zotlook-key-preview').getAttribute('data-conflict'),
     'true', 'and the button carries the mark');
  ok(note(doc, 'preview').l10nArgs.conflicts.includes('notes'),
     'the note names what else answers to it: '
     + note(doc, 'preview').l10nArgs.conflicts);
  eq(noteId(doc, 'contactSheet'), null, 'rows that do not clash stay quiet');
}
{
  // Recording onto a combination another action already has
  const { doc } = await openPane({ [PREF('notes')]: 'Ctrl+Alt+K' });
  eq(noteId(doc, 'preview'), null, 'nothing to say beforehand');

  command(doc, 'zotlook-key-preview');
  key(doc, 'keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  key(doc, 'keydown', { key: 'Alt', code: 'AltLeft', ctrlKey: true, altKey: true });
  key(doc, 'keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
  key(doc, 'keyup', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });

  eq(noteId(doc, 'preview'), 'zotlook-prefs-conflict', 'the clash is reported');
  eq(noteId(doc, 'notes'), 'zotlook-prefs-conflict',
     'and on the other row too, which is the one that will lose');
}
{
  // Resolving it has to clear both rows again
  const { doc } = await openPane({
    [PREF('preview')]: 'Ctrl+Alt+K',
    [PREF('notes')]: 'Ctrl+Alt+K',
  });
  command(doc, 'zotlook-clear-preview');
  eq(noteId(doc, 'preview'), null, 'the row that was reset is quiet again');
  eq(noteId(doc, 'notes'), null, 'and so is the other one');
  eq(doc.getElementById('zotlook-key-preview').hasAttribute('data-conflict'),
     false, 'the mark is taken off the button');
}
{
  // The shipped defaults must not collide with one another
  const { doc } = await openPane();
  const { zotLookUtil: U } = loadPlugin();
  for (const key of ['preview', 'notes', 'contactSheet', 'contactSheetWindow']) {
    eq(noteId(doc, key), null,
       `${key}: the shipped default (${U.defaultShortcut('key.' + key)}) clashes with nothing`);
  }
}
{
  // A collision with Zotero's own keys, which is the other half of the check
  const mainWindow = {
    document: {
      querySelectorAll: () => [{
        getAttribute: (n) => ({ key: 'K', modifiers: 'accel,alt', id: 'key_test' })[n] || null,
      }],
    },
  };
  const { doc } = await openPane(
    { [PREF('preview')]: 'Ctrl+Alt+K' }, false, { getMainWindow: () => mainWindow });
  eq(noteId(doc, 'preview'), 'zotlook-prefs-conflict',
     'a key element of Zotero collides too');
  ok(note(doc, 'preview').l10nArgs.conflicts.includes('Zotero'),
     'and is named as Zotero: ' + note(doc, 'preview').l10nArgs.conflicts);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
