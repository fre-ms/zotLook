// The orchestration around the rendering workers, driven by a stand-in that
// speaks the same two-step protocol the real one does. None of this was
// covered before, and it is where the sheet broke: a width handed out before
// the page count was known would have distorted every short document, and a
// worker that never answers would have hung the whole thing silently.

import { loadPlugin } from './load.mjs';
import { fakeWorkerFactory } from './fake-worker.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

function harness(options = {}) {
  const { FakeWorker, made } = fakeWorkerFactory(options);
  const written = new Map();
  const { ZotLook: Q, logs } = loadPlugin({
    ChromeWorker: FakeWorker,
    Services: { sysinfo: { getProperty: () => options.cores ?? 10 } },
    IOUtils: {
      read: async () => new Uint8Array(options.size ?? 1024),
      write: async (path, data) => { written.set(path, data.length); },
      makeDirectory: async () => {},
      remove: async () => {},
      writeUTF8: async () => {},
      exists: async () => false,
    },
  });
  Q.version = '1.1.0';
  Q._getTempDirPath = () => '/tmp/zt';
  Q._resourceAlias = () => 'resource://zotlook/';
  return { Q, made, written, logs };
}

// ── the ordinary run ──────────────────────────────────────────────────
{
  const { Q, made, written } = harness({ pageCount: 8 });
  const manifest = await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0);

  eq(made.length, 4, 'four workers are started');
  ok(made.every(w => w.url === 'resource://zotlook/render.worker.js'),
     'each from the resource alias');
  ok(made.every(w => w.options.type === 'module'),
     'and each as a module, the only kind that may import pdf.js');

  eq(manifest.pageCount, 8, 'the page count comes back');
  eq(manifest.pages.length, 8, 'every page is accounted for');
  eq(manifest.pages.map(p => p.page), [1, 2, 3, 4, 5, 6, 7, 8],
     'sorted, however out of order they arrived');
  eq(written.size, 8, 'and each was written to disk');
  ok(written.has('/img/p1.jpg') && written.has('/img/p8.jpg'),
     'under the names sheet.js references');
  ok(made.every(w => w.terminated), 'every worker is shut down afterwards');
}

// ── the width may not be handed out before the count is known ─────────
// Getting this wrong distorts short documents: the sheet reserves a box from
// the width it was told while the image was drawn at another.
{
  const { Q, made } = harness({ pageCount: 3 });
  const manifest = await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0);
  eq(manifest.columns, 3, 'three pages fill three columns, not five');
  eq(manifest.width, 833, 'and are drawn wider to suit');
  const render = made[0].posted.find(m => m.type === 'render');
  eq(render.width, 833, 'the workers are told that width, not the default');
  ok(made[0].posted[0].type === 'open' && made[0].posted[1].type === 'render',
     'and are told it only after they have opened the document');
}

// ── the pages are shared out, not rendered four times over ────────────
{
  const { Q, made } = harness({ pageCount: 10 });
  await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0);
  const dealt = made.map(w => w.posted.find(m => m.type === 'render').pages);
  eq(dealt, [[1, 5, 9], [2, 6, 10], [3, 7], [4, 8]], 'round-robin across four');
  eq(dealt.flat().length, 10, 'each page dealt exactly once');
}

// ── the count the progress window shows ───────────────────────────────
// A sheet of a long book takes seconds, and the window said only that it was
// working. The figure has to reach every page and has to stop short of the
// end, because the last page still has to be written and the sheet built.
{
  const { Q, made } = harness({ pageCount: 12 });
  const seen = [];
  const manifest = await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0,
    (done, total) => seen.push([done, total]));

  eq(seen.length, 12, 'every page is reported, not just the last');
  eq(seen.map(s => s[0]), [1,2,3,4,5,6,7,8,9,10,11,12],
     'the count climbs by one and never repeats');
  eq(seen.every(s => s[1] === 12), true, 'against the number to be drawn');
  eq(manifest.pages.length, 12, 'and the sheet still gets all of them');
  void made;
}
{
  // A cap means fewer pages, and the total has to be the capped one — a
  // count against the document's length would stall partway and stay there
  const { Q } = harness({ pageCount: 40 });
  const seen = [];
  await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 6,
    (done, total) => seen.push([done, total]));
  eq(seen.length, 6, 'the capped pages are counted');
  eq(seen[seen.length - 1], [6, 6], 'and the last one reaches the total');
}
{
  // Rendering must not depend on anyone listening
  const { Q } = harness({ pageCount: 4 });
  const manifest = await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0);
  eq(manifest.pages.length, 4, 'no progress callback is required');
}

// ── what the window is actually told ──────────────────────────────────
// The count is useless if it never reaches the window, and nothing about a
// window that quietly ignores it would show up anywhere else.
{
  const calls = { text: [], progress: [] };
  function FakeItemProgress(itemType, text) {
    calls.itemType = itemType;
    calls.initial = text;
    this.setText = (t) => calls.text.push(t);
    this.setProgress = (n) => calls.progress.push(n);
  }
  const { ZotLook: Q } = loadPlugin({
    zotero: {
      ProgressWindow: function () {
        this.changeHeadline = () => {};
        this.addDescription = () => { calls.description = true; };
        this.ItemProgress = FakeItemProgress;
        this.show = () => { calls.shown = true; };
        this.close = () => { calls.closed = true; };
      },
    },
  });

  const progress = Q._showProgress('Generating contact sheet…');
  ok(calls.shown, 'the window is shown');
  ok(!calls.description, 'with a progress line rather than a plain description');
  eq(calls.initial, 'Generating contact sheet…', 'carrying the message');

  Q._setProgress(progress, 3, 12);
  Q._setProgress(progress, 12, 12);
  eq(calls.text, ['Generating contact sheet…  3 / 12',
                  'Generating contact sheet…  12 / 12'],
     'each step names where it has got to');
  eq(calls.progress, [25, 99],
     'and never reaches 100, which would end the indicator before the '
     + 'last page is written and the sheet assembled');

  Q._closeProgress(progress);
  ok(calls.closed, 'and the window is closed at the end');
}
{
  // A window the user dismissed mid-run must not take the sheet with it
  const { ZotLook: Q } = loadPlugin({
    zotero: {
      ProgressWindow: function () {
        this.changeHeadline = () => {};
        this.ItemProgress = function () {
          this.setText = () => { throw new Error('window is gone'); };
          this.setProgress = () => {};
        };
        this.show = () => {};
        this.close = () => { throw new Error('window is gone'); };
      },
    },
  });
  const progress = Q._showProgress('x');
  Q._setProgress(progress, 1, 2);
  Q._closeProgress(progress);
  ok(true, 'a dismissed window throws nothing back into the render loop');
}
{
  // Zotero without ItemProgress still gets its message across
  const seen = {};
  const { ZotLook: Q } = loadPlugin({
    zotero: {
      ProgressWindow: function () {
        this.changeHeadline = () => {};
        this.ItemProgress = function () { throw new Error('no ItemProgress'); };
        this.addDescription = (t) => { seen.description = t; };
        this.show = () => {};
        this.close = () => {};
      },
    },
  });
  const progress = Q._showProgress('Generating contact sheet…');
  eq(seen.description, 'Generating contact sheet…',
     'falling back to the plain description it replaces');
  Q._setProgress(progress, 1, 2);
  ok(true, 'and advancing it is simply a no-op');
}

// ── the page limit reaches the workers ────────────────────────────────
{
  const { Q, written } = harness({ pageCount: 40 });
  const manifest = await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 6);
  eq(manifest.pageCount, 40, 'the document keeps its real length');
  eq(manifest.pages.length, 6, 'while only the capped pages are drawn');
  eq(written.size, 6, 'and only those are written');
}

// ── things going wrong ────────────────────────────────────────────────
{
  const { Q } = harness({ pageCount: 8, failOn: 2 });
  eq(await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0), null,
     'a worker reporting failure yields no sheet rather than a partial one');
}
{
  const { Q, made } = harness({ pageCount: 8, errorOn: 1 });
  eq(await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0), null,
     'and so does one that errors outright');
  ok(made.every(w => w.terminated), 'with the rest shut down, not left running');
}
{
  // A worker that never answers must not hang the sheet for ever
  const { Q, made } = harness({ pageCount: 8, silentOn: 3 });
  Q.CONTACT_SHEET_TIMEOUT_MS = 150;
  const started = Date.now();
  const manifest = await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0);
  ok(Date.now() - started < 2000, 'the deadline releases it');
  eq(manifest, null, 'and nothing was drawn, since none of them ever started');
  ok(made.every(w => w.terminated), 'everything is shut down');
}
{
  const { Q } = harness({});
  Q._resourceAlias = () => null;
  eq(await Q._renderPagesWithPdfjs('/a.pdf', '/img', 5, 0), null,
     'without the resource alias there is nothing to start');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
