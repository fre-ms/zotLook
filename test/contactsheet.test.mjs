// Exercises the real _buildContactSheet rather than stubbing it. The stub was
// how a lost function parameter — an identifier that still parses but throws
// at runtime — survived every previous run of this suite.
//
// The rendering itself is driven through the fake worker; what is checked
// here is everything around it: which attachment is chosen, whether an
// annotated copy is made, what the sheet is called, and what goes into it.
import { loadPlugin } from './load.mjs';
import { fakeWorkerFactory } from './fake-worker.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

function harness({ prefValues = {}, pdf = true, exitCode = 0,
                   mtime = 1000, size = 4096, outline = null,
                   annotations = [] } = {}) {
  const viewed = [];
  const written = new Map();
  const textWrites = [];
  const { FakeWorker, made } = fakeWorkerFactory({ pageCount: 3, outline });
  const files = new Set(['/plugin/qlpreview']);
  const IOUtils = {
    exists: async (p) => files.has(p),
    makeDirectory: async () => {},
    read: async () => new Uint8Array(1024),
    write: async (p, data) => { files.add(p); written.set(p, data.length); },
    writeUTF8: async (p, text) => {
      files.add(p); written.set(p, text); textWrites.push(p);
    },
    setPermissions: async () => {},
    remove: async () => {},
    readUTF8: async (p) => { if (!files.has(p)) throw new Error('no ' + p);
                             return written.get(p); },
    stat: async () => ({ size, lastModified: mtime }),
  };
  const attachment = {
    id: 1, key: 'ABCD1234', libraryID: 1,
    isNote: () => false, isAttachment: () => true,
    isPDFAttachment: () => pdf,
    attachmentFilename: pdf ? 'paper.pdf' : 'paper.epub',
    getAnnotations: () => annotations,
  };
  const { zotLook: Q } = loadPlugin({
    IOUtils, prefValues,
    ChromeWorker: FakeWorker,
    Services: { sysinfo: { getProperty: () => 4 } },
    zotero: {
      Libraries: { get: () => ({ isGroup: false }) },
      openInViewer: (uri) => viewed.push(uri),
    },
  });
  Q.version = '1.1.0';
  Q.rootURI = 'file:///plugin/';
  Q._getTempDirPath = () => '/tmp/zt';
  Q._getAttachmentPath = async () => '/lib/paper.pdf';
  Q._showProgress = () => ({});
  Q._closeProgress = () => {};
  Q._resourceAlias = () => (exitCode === 0 ? 'resource://zotlook/' : null);
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });
  return { Q, made, attachment, viewed, written, files, textWrites };
}

// ── the plain sheet, as QuickLook gets it ─────────────────────────────
{
  const { Q, made, attachment, written } = harness();
  const out = await Q._buildContactSheet([attachment]);
  ok(out, 'a sheet is produced');
  eq(made.length, 4, 'the renderers ran');
  ok(out.endsWith('.html'), 'the caller gets the sheet itself back');
  ok([...written.keys()].some(k => k.endsWith('contactsheet_paper.pdf_pages/p1.jpg')),
     'thumbnails go beside the sheet, in a directory named after it');
  ok(out.includes('zotLook-cache'),
     'and a kept sheet lives apart from the working directory, which is '
     + 'emptied on every start');

  const html = written.get(out);
  ok(html && html.includes('<!DOCTYPE html>'), 'the plugin wrote the sheet');
  ok(html.includes('repeat(3, 1fr)'), 'with a grid suiting the page count');
  ok(html.includes('contactsheet_paper.pdf_pages/p1.jpg'),
     'referencing the thumbnails by name');
  ok(html.includes('zotero://open-pdf/library/items/ABCD1234?page=1'),
     'and the reader links, which work once the sheet is opened in a browser');
  // Not decoration: Sushi's WebKit view follows links, fails to load a zotero:
  // URL, and hands the whole preview over to an error box. Asked for a new
  // window it raises "create" instead, which Sushi ignores.
  ok(/<a target="_blank" href="zotero:/.test(html),
     'opened in a new context, so a click cannot take the preview down');
}

// ── a sheet once built is shown again, not drawn again ────────────────
// Drawing every page of a long book takes seconds, and it was being done on
// every press. What decides is whether the renderers run a second time —
// that a path comes back proves nothing.
{
  const { Q, made, attachment } = harness();
  const first = await Q._buildContactSheet([attachment]);
  const afterFirst = made.length;
  const second = await Q._buildContactSheet([attachment]);

  eq(second, first, 'the same sheet comes back');
  eq(made.length, afterFirst, 'and no renderer was started for it a second time');
  ok(afterFirst > 0, 'while the first call really did draw it');
}
{
  // The file changed underneath: Zotero rewrites an attachment rather than
  // editing it, so a new modification time is what that looks like
  const { Q, made, attachment, files, written } = harness({ mtime: 1000 });
  await Q._buildContactSheet([attachment]);
  const afterFirst = made.length;

  const { Q: Q2, made: made2 } = harness({ mtime: 2000 });
  // Carry the first run's files over, so only the key differs
  await Q2._buildContactSheet([attachment]);
  ok(made2.length > 0, 'a changed file is drawn again rather than served stale');
  void files; void written; void afterFirst;
}
{
  // Asking for a different grid must not hand back the old one: the sheet
  // drawn in five columns is not the sheet the reader just asked for
  const { Q, made, attachment } = harness();
  await Q._buildContactSheet([attachment]);
  const afterFirst = made.length;
  Q._contactSheetColumns = () => 3;
  await Q._buildContactSheet([attachment]);
  ok(made.length > afterFirst, 'a changed column count is drawn again');
}
{
  // Same for the page limit
  const { Q, made, attachment } = harness();
  await Q._buildContactSheet([attachment]);
  const afterFirst = made.length;
  Q._maxContactSheetPages = () => 2;
  await Q._buildContactSheet([attachment]);
  ok(made.length > afterFirst, 'and so is a changed page limit');
}
{
  // Switched off, nothing is kept and nothing is reused
  const { Q, made, attachment, written } = harness({
    prefValues: { 'extensions.zotlook.keepPreviews': false } });
  const out = await Q._buildContactSheet([attachment]);
  const afterFirst = made.length;
  await Q._buildContactSheet([attachment]);

  ok(made.length > afterFirst, 'with keeping off the sheet is drawn every time');
  ok(!out.includes('zotLook-cache'),
     'and it is built where the startup clearing reaches it');
  ok(![...written.keys()].some(k => k.endsWith('.key')),
     'no key is left behind either');
}
{
  // A key beside a sheet that was never finished would hand back a
  // half-built one for ever after
  const { Q, attachment, written } = harness();
  Q._renderPagesWithPdfjs = async () => null;
  eq(await Q._buildContactSheet([attachment]), null, 'a failed run yields nothing');
  ok(![...written.keys()].some(k => k.endsWith('.key')),
     'and writes no key, so the next call tries again rather than serving it');
}

// ── one sheet serves both routes ──────────────────────────────────────
{
  const { Q, attachment } = harness();
  const a = await Q._buildContactSheet([attachment]);
  const b = await Q._buildContactSheet([attachment]);
  eq(a, b, 'the same file, whichever route asked for it');
}

// ── settings reach the renderer ───────────────────────────────────────
{
  const { Q, attachment, written } = harness({ prefValues: {
    'extensions.zotlook.contactSheetColumns': 2,
    'extensions.zotlook.contactSheetMaxPages': 250,
  }});
  const out = await Q._buildContactSheet([attachment]);
  ok(written.get(out).includes('repeat(2, 1fr)'),
     'the configured column count reaches the sheet');
}

// ── a book takes the other route ──────────────────────────────────────
// A reflowable book has no pages to render, but one published beside a print
// edition carries that edition's pagination, and the sheet is cut at it. So a
// selection with no PDF in it is not the end of the matter any more.
{
  const { Q, attachment } = harness({ pdf: false });
  const asked = [];
  Q._epubSheet = async (path, item) => { asked.push([path, item.key]); return '/out/sheet.html'; };
  eq(await Q._buildContactSheet([attachment]), '/out/sheet.html',
     'an EPUB gets a page sheet of its own');
  eq(asked, [['/lib/paper.pdf', 'ABCD1234']],
     'built from the book itself, with the item behind it for the reader links');
}
{
  // Both present: the PDF wins, because its pages are real ones
  const { Q, made } = harness();
  const book = { id: 2, key: 'BOOK', libraryID: 1, isNote: () => false,
                 isAttachment: () => true, isPDFAttachment: () => false,
                 attachmentFilename: 'same.epub' };
  const paper = { id: 1, key: 'ABCD1234', libraryID: 1, isNote: () => false,
                  isAttachment: () => true, isPDFAttachment: () => true,
                  attachmentFilename: 'paper.pdf' };
  Q._epubSheet = async () => '/out/sheet.html';
  const out = await Q._buildContactSheet([book, paper]);
  ok(out && out.endsWith('.html') && !out.includes('/out/'),
     'the PDF is rendered rather than the book: ' + out);
  ok(made.length > 0, 'and the renderers did run');
}

// ── failure paths return null rather than a broken path ───────────────
{
  const { Q, attachment } = harness({ pdf: false });
  attachment.attachmentFilename = 'notes.txt';
  eq(await Q._buildContactSheet([attachment]), null,
     'something that is neither yields nothing');
}
{
  const { Q, attachment } = harness({ exitCode: 1 });
  eq(await Q._buildContactSheet([attachment]), null, 'a failing renderer yields nothing');
}
{
  const { Q, attachment } = harness({ exitCode: -1 });
  eq(await Q._buildContactSheet([attachment]), null, 'a timed-out renderer yields nothing');
}
{
  const { Q } = harness();
  eq(await Q._buildContactSheet([]), null, 'an empty selection yields nothing');
}

// ── both routes go through the real builder ───────────────────────────
{
  const { Q, attachment } = harness();
  let launched = null;
  Q._launchPreview = async (p) => { launched = p; };
  eq(await Q._openContactSheet([attachment]), true, 'the QuickLook route succeeds');
  ok(launched && launched[0], 'and previewed the file it got back');
}
{
  const { Q, attachment, viewed } = harness();
  eq(await Q._openContactSheetInViewer([attachment]), true, 'the window route succeeds');
  eq(viewed.length, 1, 'and opened exactly one window');
  ok(viewed[0].startsWith('file://'), 'handing the viewer a file URI');
}

// ── only the chosen attachment is resolved ────────────────────────────
// Resolving every candidate would download every synced attachment of every
// selected item only to discard all but one.
{
  const att = (key) => ({ key, libraryID: 1, isNote: () => false, isAttachment: () => true,
                          isPDFAttachment: () => true, attachmentFilename: key + '.pdf' });
  const parent = (keys) => ({ isNote: () => false, isAttachment: () => false,
                              getAttachments: () => keys });
  const byKey = new Map([['A', att('A')], ['B', att('B')], ['C', att('C')]]);
  const { zotLook: R } = loadPlugin({
    Items: { get: (k) => byKey.get(k) },
    ChromeWorker: fakeWorkerFactory({ pageCount: 2 }).FakeWorker,
    Services: { sysinfo: { getProperty: () => 2 } },
    IOUtils: { exists: async () => true, makeDirectory: async () => {},
               read: async () => new Uint8Array(16),
               write: async () => {}, writeUTF8: async () => {},
               setPermissions: async () => {}, remove: async () => {} },
  });
  R.version = '1.1.0'; R.rootURI = 'file:///plugin/';
  R._getTempDirPath = () => '/tmp/zt';
  R._showProgress = () => ({}); R._closeProgress = () => {};
  R._resourceAlias = () => 'resource://zotlook/';
  const seen = [];
  R._getAttachmentPath = async (a) => { seen.push(a.key); return '/lib/' + a.key + '.pdf'; };

  const out = await R._buildContactSheet([parent(['A', 'B', 'C'])]);
  ok(out, 'a sheet is produced for an item with three attachments');
  eq(seen, ['A'], 'only the first candidate is resolved, not all three');

  // If the first cannot be resolved, the next is tried
  seen.length = 0;
  R._getAttachmentPath = async (a) => (a.key === 'A' ? null : '/lib/' + a.key + '.pdf');
  const out2 = await R._buildContactSheet([parent(['A', 'B', 'C'])]);
  ok(out2, 'an unresolvable first candidate falls through');
  eq(await R._pickPdfAttachment([parent(['A', 'B', 'C'])]).then(r => r.item.key), 'B',
     'and the next one wins');

  // None resolvable
  R._getAttachmentPath = async () => null;
  eq(await R._pickPdfAttachment([parent(['A', 'B'])]), null, 'nothing resolvable yields nothing');
}

// ── the sheet shows annotations too ───────────────────────────────────
// Space and Option+Space must not disagree about what the document looks like,
// and on a sheet of every page the marked-up ones are what one is looking for.
{
  const withAnnotations = (annotations, exported = []) => {
    const attachment = {
      id: 3, key: 'ANNKEY', libraryID: 1,
      isNote: () => false, isAttachment: () => true,
      isPDFAttachment: () => true, attachmentFilename: 'paper.pdf',
      getAnnotations: () => annotations,
    };
    const calls = [];
    const { zotLook: Q } = loadPlugin({
      ChromeWorker: fakeWorkerFactory({ pageCount: 2 }).FakeWorker,
      Services: { sysinfo: { getProperty: () => 2 } },
      IOUtils: { exists: async () => false, makeDirectory: async () => {},
                 read: async () => new Uint8Array(16),
                 write: async () => {}, writeUTF8: async () => {},
                 setPermissions: async () => {}, remove: async () => {} },
      zotero: {
        Libraries: { get: () => ({ isGroup: false }) },
        PDFWorker: { export: async (id, path) => { exported.push(path); } },
      },
    });
    Q.version = '1.1.0';
    Q._getTempDirPath = () => '/tmp/zt';
    Q._getAttachmentPath = async () => '/lib/paper.pdf';
    Q._showProgress = () => ({}); Q._closeProgress = () => {};
    Q._resourceAlias = () => 'resource://zotlook/';
    Q._renderPagesWithPdfjs = async (pdf) => {
      calls.push([pdf]);
      return { pageCount: 1, columns: 1, width: 2500,
               pages: [{ page: 1, height: 3236 }] };
    };
    return { Q, calls, attachment, exported };
  };

  {
    const exported = [];
    const { Q, calls, attachment } = withAnnotations([{ dateModified: '2026-01-01' }], exported);
    const out = await Q._buildContactSheet([attachment]);
    ok(out, 'a sheet is produced');
    eq(exported.length, 1, 'the annotated copy was exported');
    eq(calls[0][0], exported[0], 'and it is what the renderer is given');
    ok(!calls[0][0].includes('/lib/'), 'not the stored file');
  }

  {
    const exported = [];
    const { Q, calls, attachment } = withAnnotations([], exported);
    await Q._buildContactSheet([attachment]);
    eq(exported.length, 0, 'an unannotated PDF is not exported');
    eq(calls[0][0], '/lib/paper.pdf', 'and the stored file is rendered');
  }

  // The sheet keeps one name either way, so toggling the setting does not
  // leave a second file behind
  {
    const a = await withAnnotations([{ dateModified: '2026-01-01' }]).Q
      ._buildContactSheet([withAnnotations([]).attachment]);
    const b = await withAnnotations([]).Q
      ._buildContactSheet([withAnnotations([]).attachment]);
    eq(a, b, 'the sheet is named after the source, not after what was rendered');
  }

  // Turning annotations off reaches the sheet as well
  {
    const exported = [];
    const { attachment } = withAnnotations([]);
    const calls = [];
    const { zotLook: Q } = loadPlugin({
      prefValues: { 'extensions.zotlook.previewAnnotations': false },
      IOUtils: { exists: async () => false, makeDirectory: async () => {},
                 read: async () => new Uint8Array(16),
                 write: async () => {}, writeUTF8: async () => {},
                 remove: async () => {} },
      zotero: { Libraries: { get: () => ({ isGroup: false }) },
                PDFWorker: { export: async (i, p) => { exported.push(p); } } },
    });
    Q.version = '1.1.0';
    Q._getTempDirPath = () => '/tmp/zt';
    Q._getAttachmentPath = async () => '/lib/paper.pdf';
    Q._showProgress = () => ({}); Q._closeProgress = () => {};
    Q._resourceAlias = () => 'resource://zotlook/';
    Q._renderPagesWithPdfjs = async (pdf) => {
      calls.push([pdf]);
      return { pageCount: 1, columns: 1, width: 2500,
               pages: [{ page: 1, height: 3236 }] };
    };
    attachment.getAnnotations = () => [{ dateModified: '2026-01-01' }];
    await Q._buildContactSheet([attachment]);
    eq(exported.length, 0, 'the setting switches it off for the sheet too');
    eq(calls[0][0], '/lib/paper.pdf', 'so the stored file is rendered');
  }
}

// ── clearing out what was kept ────────────────────────────────────────
// Kept sheets accumulate silently: a directory nobody looks at, holding a
// megabyte per book. What is checked here is that the clearing takes the
// stale ones and only those, and that a sheet still in use survives it —
// which is the whole difference between a cache and a nuisance.

const DAY = 24 * 60 * 60 * 1000;

function cacheHarness({ entries = [], now = 100 * DAY, prefValues = {} } = {}) {
  // path -> {size, lastModified}; a directory is anything with children
  const fs = new Map();
  for (const e of entries) {
    // One directory per entry, which is what makes the clearing general:
    // it removes an entry without knowing what kind of thing is inside
    const dir = '/tmp/zt-cache/' + e.name;
    fs.set(dir + '/.key', { size: 100, lastModified: e.used });
    fs.set(dir + '/' + e.name + '.html', { size: e.html ?? 1000, lastModified: e.used });
    for (let i = 1; i <= (e.images ?? 0); i++) {
      fs.set(dir + '/' + e.name + '_pages/p' + i + '.jpg',
             { size: 10000, lastModified: e.used });
    }
  }
  const isDir = (path) => [...fs.keys()].some(p => p.startsWith(path + '/'));
  const IOUtils = {
    getChildren: async (dir) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const out = new Set();
      for (const path of fs.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const cut = rest.indexOf('/');
        out.add(prefix + (cut === -1 ? rest : rest.slice(0, cut)));
      }
      if (!out.size) throw new Error('no such directory: ' + dir);
      return [...out];
    },
    stat: async (path) => {
      if (fs.has(path)) return { type: 'regular', ...fs.get(path) };
      if (isDir(path)) return { type: 'directory', size: 0 };
      throw new Error('no such file: ' + path);
    },
    remove: async (path, opts = {}) => {
      if (fs.delete(path)) return;
      let hit = false;
      for (const p of [...fs.keys()]) {
        if (p.startsWith(path + '/')) { fs.delete(p); hit = true; }
      }
      if (!hit && !opts.ignoreAbsent) throw new Error('no such file: ' + path);
    },
  };
  const { zotLook: Q } = loadPlugin({ IOUtils, prefValues });
  Q._derivedRoot = (keep) => (keep ? '/tmp/zt-cache' : '/tmp/zt');
  const realNow = Date.now;
  Date.now = () => now;
  return { Q, fs, restore: () => { Date.now = realNow; } };
}

{
  const { Q, fs, restore } = cacheHarness({ entries: [
    { name: 'a', used: 100 * DAY, images: 3 },
    { name: 'b', used: 99 * DAY, images: 2 },
  ] });
  const bytes = await Q._keptSize();
  eq(bytes, 2 * 100 + 2 * 1000 + 5 * 10000, 'the figure counts keys, sheets '
     + 'and every thumbnail behind them');
  eq(fs.size, 9, 'and reading the size removes nothing');
  restore();
}
{
  const { Q, restore } = cacheHarness({ entries: [] });
  eq(await Q._keptSize(), 0, 'an empty — or absent — cache is zero, '
     + 'not an error the pane has to catch');
  restore();
}
{
  // The point of the whole feature: the button empties it
  const { Q, fs, restore } = cacheHarness({ entries: [
    { name: 'a', used: 100 * DAY, images: 2 },
    { name: 'b', used: 10 * DAY, images: 1 },
  ] });
  const result = await Q._purgeKept();
  eq(result.count, 2, 'both sheets go, however recently used');
  eq(result.bytes, 2 * 100 + 2 * 1000 + 3 * 10000, 'and it reports what it freed');
  eq(fs.size, 0, 'nothing is left behind — not the keys, not the thumbnails');
  restore();
}
{
  // The age-based clearing, which is the one that runs unattended and so
  // must not take a sheet somebody is still using
  const { Q, fs, restore } = cacheHarness({
    prefValues: { 'extensions.zotlook.previewKeepDays': 30 },
    entries: [
      { name: 'stale', used: 60 * DAY, images: 1 },
      { name: 'fresh', used: 95 * DAY, images: 1 },
    ] });
  const result = await Q._expireKept();
  eq(result.count, 1, 'only the one nobody has opened in a month');
  ok(!fs.has('/tmp/zt-cache/stale/stale.html'), 'the stale sheet is gone');
  ok(!fs.has('/tmp/zt-cache/stale/stale_pages/p1.jpg'), 'its thumbnails with it');
  ok(fs.has('/tmp/zt-cache/fresh/fresh.html'), 'the one in use stays');
  ok(fs.has('/tmp/zt-cache/fresh/.key'), 'key and all, so it is still reused');
  restore();
}
{
  // Zero has to mean off rather than "expire everything", which is what a
  // plain cutoff comparison would make of it
  const { Q, fs, restore } = cacheHarness({
    prefValues: { 'extensions.zotlook.previewKeepDays': 0 },
    entries: [{ name: 'ancient', used: 0, images: 1 }] });
  const result = await Q._expireKept();
  eq(result.count, 0, 'zero switches the clearing off');
  ok(fs.has('/tmp/zt-cache/ancient/ancient.html'), 'and keeps even an ancient sheet');
  restore();
}
{
  // Nonsense in the pref must not empty the cache
  for (const bad of [-5, 'x']) {
    const { Q, fs, restore } = cacheHarness({
      prefValues: { 'extensions.zotlook.previewKeepDays': bad },
      entries: [{ name: 'a', used: 99 * DAY, images: 1 }] });
    await Q._expireKept();
    ok(fs.has('/tmp/zt-cache/a/a.html'),
       'a nonsensical keep-days (' + bad + ') falls back to the default');
    restore();
  }
}
{
  // A sheet without its key is a half-written one. It must not be counted as
  // kept, since the key is what _cachedSheet goes by.
  const { Q, restore } = cacheHarness({ entries: [{ name: 'a', used: 99 * DAY }] });
  const fsEntry = await Q._keptEntries();
  eq(fsEntry.length, 1, 'a key marks a kept sheet');
  restore();
}

// ── a hit records that the sheet is still wanted ──────────────────────
// Without this the clearing measures age since the sheet was built, and a
// book opened every week would vanish a month after it was first drawn.
{
  const { Q, made, attachment, textWrites } = harness();
  await Q._buildContactSheet([attachment]);
  const key = textWrites.find(p => p.endsWith('.key'));
  const drawn = made.length;
  ok(key, 'the first run leaves a key');

  textWrites.length = 0;
  await Q._buildContactSheet([attachment]);
  eq(made.length, drawn, 'the second call is served from the kept sheet');
  ok(textWrites.includes(key), 'and still rewrites the key, so its date says '
     + '"last used" rather than "first built"');
}

// ── the two corner menus ──────────────────────────────────────────────
// What the EPUB preview had, the sheet now has: the document's contents and
// its annotations, each entry a jump to a tile. No script anywhere — a
// preview panel runs none — so the jump is a fragment link, the landing a
// :target rule, and the centring a scroll margin.
const OUTLINE = [
  { title: 'Introduction', page: 1, level: 0 },
  { title: 'Method', page: 2, level: 1 },
  { title: 'Beyond the limit', page: 9, level: 0 },
];
const ANNOTATIONS = [
  { key: 'ANN00001', annotationType: 'highlight', annotationText: 'A quoted passage',
    annotationComment: 'why it matters', annotationColor: '#ff6666',
    annotationPosition: JSON.stringify({ pageIndex: 1, rects: [] }),
    annotationSortIndex: '00001|000100|00010', annotationPageLabel: '2' },
  { annotationType: 'note', annotationComment: 'a note on the first page',
    annotationPosition: '{"pageIndex":0}',
    annotationSortIndex: '00000|000010|00000' },
  { annotationType: 'highlight', annotationIsExternal: true,
    annotationText: 'already in the file', annotationPosition: '{"pageIndex":0}',
    annotationSortIndex: '00000|000000|00000' },
  { annotationType: 'image', annotationPosition: '{"pageIndex":2}',
    annotationSortIndex: '00002|000000|00000' },
];
{
  const { Q, made, attachment, written } = harness({
    outline: OUTLINE, annotations: ANNOTATIONS });
  const out = await Q._buildContactSheet([attachment]);
  const html = written.get(out);

  eq(made.map(w => w.posted[0].outline), [true, false, false, false],
     'one renderer is asked for the outline, and only one');
  ok(html.includes('<div class="page" id="p1" data-zl-tile="1">'),
     'every tile carries an id, and says which page it is');
  ok(/<details class="zl-toc"><summary>Contents<\/summary>/.test(html),
     'the contents menu is there');
  ok(/<li class="zl-toc-level0"><a href="#p1">Introduction<\/a>/.test(html)
     && /<li class="zl-toc-level1"><a href="#p2">Method<\/a>/.test(html),
     'its entries jump to the tiles, at the nesting the outline gives');
  ok(!html.includes('Beyond the limit'),
     'an entry whose page was not drawn is left out rather than left dangling');

  ok(/<details class="zl-annotations"><summary>Annotations \(3\)<\/summary>/.test(html),
     'the annotations menu counts the ones that are Zotero’s own');
  ok(!html.includes('already in the file'),
     'an external annotation is not among them: it is drawn in the file already');
  ok(html.indexOf('a note on the first page') < html.indexOf('A quoted passage'),
     'listed in reading order, by the sort index rather than by arrival');
  ok(/<q style="background-color: #ff666680;">A quoted passage<\/q>/.test(html),
     'a quotation is marked as it is marked on the page, at half opacity');
  ok(/<span class="zl-annotation-comment">why it matters<\/span>/.test(html),
     'with its comment');
  ok(/<a class="zl-annotation-goto" href="#p2">Page 2<\/a>/.test(html),
     'and a link to its page, named by the printed label');
  ok(/<a class="zl-annotation-open" target="_blank" href="zotero:\/\/open-pdf\/library\/items\/[A-Z0-9]+\?annotation=ANN00001">Open in the reader<\/a>/.test(html),
     'and a link that opens the reader at the annotation itself — as a new-window request, like the tiles, or the window asks which application should open it');
  ok(html.includes('@media (prefers-color-scheme: dark)'),
     'the sheet has a dark side, for a system that is dark');
  ok(/href="#p1">Page 1<\/a>/.test(html), 'a note has no passage, only its page');
  ok(/<span class="zl-annotation-comment">Image<\/span>[^<]*<a class="zl-annotation-goto" href="#p3">Page 3<\/a>/.test(html),
     'an area with nothing said is named by its kind');

  ok(/\.page:target, \.page\.zl-current \{[^}]*outline: 3px solid/s.test(html),
     'the tile jumped to is framed, whichever route jumped to it');
  ok(/\.page \{[^}]*scroll-margin-top: max\(0px, calc\(50vh - \(\(100vw - 48px\) \/ 3 \* 1\.33\d* \+ 21px\) \/ 2\)\)/s.test(html),
     'and lands in the middle of the window: half the height less half a tile, '
     + 'written as an expression of the window width the grid is divided into');
}
{
  // Both menus can be switched off, and a sheet built with one is not the
  // sheet built without it
  const { Q, made, attachment, written } = harness({
    outline: OUTLINE, annotations: ANNOTATIONS, prefValues: {
      'extensions.zotlook.contactSheetContents': false,
      'extensions.zotlook.contactSheetAnnotations': false,
    }});
  const out = await Q._buildContactSheet([attachment]);
  const html = written.get(out);
  ok(!html.includes('<details class="zl-toc"')
     && !html.includes('<details class="zl-annotations"'),
     'with both off the sheet is the grid alone');
  ok(html.includes('id="p1"'), 'the ids stay, since they cost nothing');

  const afterFirst = made.length;
  const orig = Q._pref.bind(Q);
  Q._pref = (name, dflt) => name === 'contactSheetContents' ? true : orig(name, dflt);
  await Q._buildContactSheet([attachment]);
  ok(made.length > afterFirst, 'switching a menu on draws the sheet again');
}
{
  // The list names the annotations whether or not they are drawn in, so a
  // new annotation must reach it even with the drawing switched off
  const notes = [ANNOTATIONS[1]];
  const { Q, made, attachment } = harness({
    annotations: notes, prefValues: {
      'extensions.zotlook.previewAnnotations': false }});
  await Q._buildContactSheet([attachment]);
  const afterFirst = made.length;
  notes.push({ ...ANNOTATIONS[0], dateModified: '2026-09-02 10:00:00' });
  await Q._buildContactSheet([attachment]);
  ok(made.length > afterFirst,
     'an added annotation invalidates a kept sheet even when none is drawn in');
}
{
  // No outline, no annotations: nothing pretends to be a menu
  const { Q, attachment, written } = harness();
  const html = written.get(await Q._buildContactSheet([attachment]));
  ok(!html.includes('<details'), 'a document with neither shows neither button');
}

// ── a menu jump is answered, not navigated to ─────────────────────────
// The menus jump by fragment, and in Zotero's own window that navigation
// comes back out through the browser shim as a file load for something to
// open — a dialog asking which application handles file links. The script
// answers the click instead. Where scripts do not run, as in macOS Quick
// Look, the anchors stay ordinary anchors.
{
  const { zotLookSheet: S } = loadPlugin();
  const html = S.html({
    pages: [{ page: 1, height: 10 }, { page: 22, height: 10 }],
    columns: 2, width: 100, imageDir: 'pages', pageCount: 2,
    linkBase: 'zotero://open-pdf/library/items/ABCD1234',
    toc: [{ title: 'Chapter', target: 'p22', page: 22, level: 0 }],
  });
  ok(/href="#p22"/.test(html), 'the menu still carries a plain anchor');
  ok(/id="p22"/.test(html), 'and the tile it names is there to be found');
  ok(/addEventListener\('click'/.test(html), 'a click handler comes with the sheet');
  ok(/preventDefault\(\)/.test(html), 'which takes the navigation out of the way');
  ok(/zl-current/.test(html), 'and marks the tile as :target would have');
  ok(/\.page:target, \.page\.zl-current/.test(html),
     'both routes to the same outline');
  // The page tiles must keep navigating: that is what opens the reader
  ok(/<a target="_blank" href="zotero:\/\/open-pdf/.test(html),
     'a page link is left a real navigation');
  ok(/a\[href\^="#"\]/.test(html),
     'only same-page fragments are intercepted');
}

// ── several items: the collection sheet ───────────────────────────────
// One tile per item, the first page of its PDF, title and creators under
// it, a click into the reader; an item without a PDF still has its tile
{
  const { FakeWorker, made } = fakeWorkerFactory({ pageCount: 3 });
  const written = new Map(); const files = new Set(); const dirs = [];
  const IOUtils = {
    exists: async (p) => files.has(p), makeDirectory: async (p) => { dirs.push(p); },
    read: async () => new Uint8Array(1024),
    write: async (p, data) => { files.add(p); written.set(p, data.length); },
    writeUTF8: async (p, text) => { files.add(p); written.set(p, text); },
    setPermissions: async () => {}, remove: async () => {},
    readUTF8: async (p) => { if (!files.has(p)) throw new Error('no ' + p); return written.get(p); },
    stat: async () => ({ size: 4096, lastModified: 1000 }),
  };
  const att = (id, key, pdf) => ({ id, key, libraryID: 1, isNote: () => false, isAttachment: () => true,
    isPDFAttachment: () => pdf, attachmentFilename: pdf ? key + '.pdf' : key + '.html', getAnnotations: () => [] });
  const atts = { 11: att(11, 'ATT00011', true), 12: att(12, 'ATT00012', true), 13: att(13, 'ATT00013', false) };
  const item = (id, key, title, creator, year, attIDs) => ({ id, key, libraryID: 1,
    isNote: () => false, isAttachment: () => false, isRegularItem: () => true,
    getAttachments: () => attIDs, getDisplayTitle: () => title, firstCreator: creator,
    getField: (f) => (f === 'year' ? year : f === 'title' ? title : '') });
  const items = [item(1, 'ITEM0001', 'First paper', 'Adams', '2019', [11]),
                 item(2, 'ITEM0002', 'Second paper', 'Baker', '2021', [12]),
                 item(3, 'ITEM0003', 'A web page', 'Clark', '', [13])];
  const { zotLook: Q, zotLookSheet } = loadPlugin({
    IOUtils, ChromeWorker: FakeWorker, Services: { sysinfo: { getProperty: () => 4 } },
    zotero: { Libraries: { get: () => ({ isGroup: false }) }, Items: { get: (id) => atts[id] }, openInViewer: () => {} },
  });
  Q.version = '1.1.0'; Q.rootURI = 'file:///plugin/'; Q._getTempDirPath = () => '/tmp/zt';
  Q._getAttachmentPath = async (a) => '/lib/' + a.attachmentFilename;
  Q._showProgress = () => ({}); Q._closeProgress = () => {}; Q._resourceAlias = () => 'resource://zotlook/';
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });

  const out = await Q._buildContactSheet(items);
  ok(out && /collectionsheet_[0-9a-f]{8}\.html$/.test(out), 'several items make a collection sheet, named by their keys');
  const html = written.get(out);
  ok(html.includes('<title>Collection Sheet</title>'), 'with its own title');
  ok(html.includes('data-zl-tile="1"') && html.includes('data-zl-tile="3"'), 'one tile per item, the third included');
  ok(/collectionsheet_[0-9a-f]{8}_pages\/1\/p1\.jpg/.test(html), 'the first page of the first PDF is its picture');
  ok(html.includes('First paper') && html.includes('Adams, 2019'), 'the title and the creator and year under it');
  ok(html.includes('zotero://open-pdf/library/items/ATT00011"'), 'a click opens the reader on that PDF');
  ok(html.includes('No PDF') && html.includes('zotero://select/library/items/ITEM0003'),
     'an item without a PDF has a tile that says so and selects the item');
  eq(made.length, 2, 'each PDF rendered by a renderer of its own, one page each');
  const want = zotLookSheet.widthFor(3, 5);
  ok(made.every((w) => w.posted.find((m) => m.type === 'render').width === want),
     `rendered at the width three tiles across need (${want} px), not at one page's`);
  eq(Q._lastSheetItemIDs, [11, 12], 'the reader opening for either PDF is this sheet\'s handoff');
  ok(html.includes('zl-texts'), 'and the search has the titles and first pages to go by');
}

// ── the printed page numbers reach the tiles and the page field ───────
{
  const { FakeWorker, made } = fakeWorkerFactory({ pageCount: 3, labels: ['i', 'ii', '1'] });
  const written = new Map(); const files = new Set();
  const IOUtils = {
    exists: async (p) => files.has(p), makeDirectory: async () => {}, read: async () => new Uint8Array(1024),
    write: async (p, data) => { files.add(p); written.set(p, data.length); },
    writeUTF8: async (p, text) => { files.add(p); written.set(p, text); },
    setPermissions: async () => {}, remove: async () => {},
    readUTF8: async (p) => { if (!files.has(p)) throw new Error('no ' + p); return written.get(p); },
    stat: async () => ({ size: 4096, lastModified: 1000 }),
  };
  const attachment = { id: 1, key: 'ABCD1234', libraryID: 1, isNote: () => false, isAttachment: () => true,
    isPDFAttachment: () => true, attachmentFilename: 'book.pdf', getAnnotations: () => [] };
  const { zotLook: Q } = loadPlugin({ IOUtils, ChromeWorker: FakeWorker, Services: { sysinfo: { getProperty: () => 4 } },
    zotero: { Libraries: { get: () => ({ isGroup: false }) }, openInViewer: () => {} } });
  Q.version = '1.1.0'; Q.rootURI = 'file:///plugin/'; Q._getTempDirPath = () => '/tmp/zt';
  Q._getAttachmentPath = async () => '/lib/book.pdf'; Q._showProgress = () => ({}); Q._closeProgress = () => {};
  Q._resourceAlias = () => 'resource://zotlook/'; globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });
  const out = await Q._buildContactSheet([attachment]);
  const html = written.get(out);
  ok(made.length >= 1, 'rendered');
  ok(html.includes('data-zl-tile="1" data-zl-label="i"'), 'a tile carries its printed number beside its own');
  ok(/<div class="label">ii<\/div>/.test(html), 'and shows the printed one');
  ok(html.includes('placeholder="Page i–1"'), 'the page field names the range by the printed numbers');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
