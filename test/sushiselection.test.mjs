// Sushi keeps the arrow keys — they are window accelerators — but reports
// each press on the bus as a SelectionEvent, which is how Files walks its
// list with the preview open. This suite drives the plugin's listener with
// lines captured from a real gdbus monitor against Sushi 46, so the parsing
// is held to what the bus actually says, not to what a fixture wishes it said.
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      got:  ${JSON.stringify(g)}\n      want: ${JSON.stringify(w)}`)); };
const ok = (c, l) => eq(!!c, true, l);

// Captured verbatim on 2026-09-01, GNOME 46 / gnome-sushi 46.0-2
const LINE = {
  right: '/org/gnome/NautilusPreviewer: org.gnome.NautilusPreviewer2.SelectionEvent (uint32 5,)',
  up: '/org/gnome/NautilusPreviewer: org.gnome.NautilusPreviewer2.SelectionEvent (uint32 2,)',
  visibleTrue: "/org/gnome/NautilusPreviewer: org.freedesktop.DBus.Properties.PropertiesChanged ('org.gnome.NautilusPreviewer2', {'ParentHandle': <'x11:0'>, 'Visible': <true>}, @as [])",
  visibleFalse: "/org/gnome/NautilusPreviewer: org.freedesktop.DBus.Properties.PropertiesChanged ('org.gnome.NautilusPreviewer2', {'Visible': <false>}, @as [])",
  noise: '/org/gnome/NautilusPreviewer/window/1: org.gtk.Actions.Changed (@as [], @a{sb} {}, @a{sv} {}, {})',
};

function harness({ focused = 5, rowCount = 10, prefValues } = {}) {
  const view = {
    rowCount,
    visible: [],
    selection: {
      focused,
      select(i) { this.focused = i; },
    },
  };
  view.ensureRowIsVisible = (i) => view.visible.push(i);
  const items = [{ id: 'current' }];
  const win = { ZoteroPane: { itemsView: view, getSelectedItems: () => items } };
  const { zotLook: Q, logs } = loadPlugin({
    prefValues,
    zotero: {
      isMac: false, isLinux: true, isWin: false,
      getMainWindow: () => win,
    },
  });
  const previews = [];
  Q._openQuickLook = (its) => { previews.push(its); };
  Q.SUSHI_STEP_PREVIEW_DELAY_MS = 20;   // the tests should not sit around
  const settle = () => new Promise((r) => setTimeout(r, 60));
  return { Q, view, previews, settle, logs };
}

// ── left and right walk an item's files, up and down the list ─────────
{
  const { Q, view, settle } = harness();
  Q._sushiShown = true;
  Q._previewList = { paths: ['/lib/paper.pdf', '/lib/notes.html'], index: 0 };
  const delivered = [];
  Q._deliver = async (plan) => { delivered.push(plan); return true; };
  Q._onSushiMonitorLine(LINE.right);
  await settle();
  eq(delivered.length, 1, 'right shows the next file');
  ok(delivered[0].arguments.includes('string:file:///lib/notes.html'), 'the second of the press');
  ok(delivered[0].arguments.includes('boolean:false'), 'shown in place, not toggled');
  eq(view.selection.focused, 5, 'and the selection stays');
  Q._onSushiMonitorLine(LINE.up);
  eq(view.selection.focused, 4, 'up moves the selection, as in Files');
}

// ── an arrow in the preview walks the list ────────────────────────────
{
  const { Q, view, previews, settle } = harness();
  Q._sushiShown = true;
  Q._onSushiMonitorLine(LINE.right);
  eq(view.selection.focused, 6, 'right moves the selection down the list');
  Q._onSushiMonitorLine(LINE.up);
  eq(view.selection.focused, 5, 'up moves it back');
  eq(view.visible, [6, 5], 'each step is scrolled into view');
  eq(previews.length, 0, 'the preview does not fire per step');
  await settle();
  eq(previews.length, 1, 'it follows once the keys come to rest');
}

// ── a held key is one preview, not a storm ────────────────────────────
{
  const { Q, view, previews, settle } = harness({ focused: 0 });
  Q._sushiShown = true;
  for (let i = 0; i < 4; i++) Q._onSushiMonitorLine(LINE.right);
  eq(view.selection.focused, 4, 'four events, four rows');
  await settle();
  eq(previews.length, 1, 'one preview at the end of the run');
}

// ── the edges hold ────────────────────────────────────────────────────
{
  const { Q, view } = harness({ focused: 9, rowCount: 10 });
  Q._sushiShown = true;
  Q._onSushiMonitorLine(LINE.right);
  eq(view.selection.focused, 9, 'the last row is the last row');
  const bottom = harness({ focused: 0 });
  bottom.Q._sushiShown = true;
  bottom.Q._onSushiMonitorLine(LINE.up);
  eq(bottom.view.selection.focused, 0, 'and the first the first');
}

// ── only our preview drives the list ──────────────────────────────────
// Files' own previews speak on the same bus. Visible: true is therefore not
// believed — only a ShowFile this plugin sent sets the flag — and an event
// arriving with the flag down moves nothing.
{
  const { Q, view, previews, settle } = harness();
  Q._sushiShown = false;
  Q._onSushiMonitorLine(LINE.visibleTrue);
  eq(Q._sushiShown, false, "another caller's window is not claimed");
  Q._onSushiMonitorLine(LINE.right);
  eq(view.selection.focused, 5, "and its arrows do not move Zotero's selection");
  await settle();
  eq(previews.length, 0, 'nor preview anything');
}

// ── the window going away is heard, however it went ───────────────────
// q, Space or Escape inside Sushi, the toggle, or our Close: all end in the
// same PropertiesChanged, and that is what keeps the flag honest.
{
  const { Q, previews, settle, logs } = harness();
  Q._sushiShown = true;
  Q._onSushiMonitorLine(LINE.visibleFalse);
  eq(Q._sushiShown, false, 'Visible false takes the flag down');
  ok(logs.some((l) => /window gone/.test(l)), 'and says so');

  // A preview already scheduled must not reopen a window just closed
  Q._sushiShown = true;
  Q._onSushiMonitorLine(LINE.right);
  Q._onSushiMonitorLine(LINE.visibleFalse);
  await settle();
  eq(previews.length, 0, 'a pending step-preview dies with the window');
}

// ── the walking is a choice, and off means off ────────────────────────
// The setting turns the answer off, not the listening: Visible must still be
// heard, or Escape in Zotero would close windows long gone.
{
  const { Q, view, previews, settle } = harness({
    prefValues: { 'extensions.zotlook.sushiArrowSelection': false },
  });
  Q._sushiShown = true;
  Q._onSushiMonitorLine(LINE.right);
  eq(view.selection.focused, 5, 'with the setting off, an arrow moves nothing');
  await settle();
  eq(previews.length, 0, 'and previews nothing');
  Q._onSushiMonitorLine(LINE.visibleFalse);
  eq(Q._sushiShown, false, 'while the window going away is still heard');
}

// ── the monitor's chunks are reassembled into lines ───────────────────
{
  const { Q, view } = harness();
  Q._sushiShown = true;
  const whole = LINE.noise + '\n' + LINE.right + '\n';
  const chunks = [whole.slice(0, 40), whole.slice(40, 90), whole.slice(90), ''];
  const proc = {
    stdout: { readString: async () => chunks.shift() },
  };
  await Q._pumpSushiMonitor(proc);
  eq(view.selection.focused, 6, 'a line split across reads still steps once');
}

// ── the monitor starts with the first delivered preview ───────────────
{
  const { Q } = harness();
  let ensured = 0;
  Q._ensureSushiMonitor = () => { ensured++; };
  Q._subprocess = () => ({ Subprocess: {
    call: async () => ({
      stderr: { readString: async () => '' },
      wait: async () => ({ exitCode: 0 }), kill() {} }),
  } });
  await Q._deliver(await Q._previewCommand(['/a/p.pdf']));
  eq(ensured, 1, 'a delivered ShowFile brings the listener up');
  eq(Q._sushiShown, true, 'and marks the preview as showing');
}

// ── one listener, restarted only after it dies ────────────────────────
{
  const { Q } = harness();
  let calls = 0;
  let release;
  const gone = new Promise((r) => { release = r; });
  Q._subprocess = () => ({ Subprocess: {
    call: async () => { calls++; return {
      stdout: { readString: () => gone },
      kill() { release(''); } }; },
    pathSearch: async () => '/usr/bin/gdbus',
  } });
  await Q._ensureSushiMonitor();
  await Q._ensureSushiMonitor();
  eq(calls, 1, 'asked twice, started once');
  ok(Q._sushiMonitor, 'and remembered');
  Q._sushiMonitor.kill();
  await new Promise((r) => setTimeout(r, 10));
  eq(Q._sushiMonitor, null, 'a dead monitor is forgotten');
  await Q._ensureSushiMonitor();
  eq(calls, 2, 'so the next preview can bring it back');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
