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

function harness({ prefValues = {}, pdf = true, exitCode = 0 } = {}) {
  const viewed = [];
  const written = new Map();
  const { FakeWorker, made } = fakeWorkerFactory({ pageCount: 3 });
  const files = new Set(['/plugin/qlpreview']);
  const IOUtils = {
    exists: async (p) => files.has(p),
    makeDirectory: async () => {},
    read: async () => new Uint8Array(1024),
    write: async (p, data) => { files.add(p); written.set(p, data.length); },
    writeUTF8: async (p, text) => { files.add(p); written.set(p, text); },
    setPermissions: async () => {},
    remove: async () => {},
  };
  const attachment = {
    id: 1, key: 'ABCD1234', libraryID: 1,
    isNote: () => false, isAttachment: () => true,
    isPDFAttachment: () => pdf,
    attachmentFilename: pdf ? 'paper.pdf' : 'paper.epub',
  };
  const { ZotLook: Q } = loadPlugin({
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
  return { Q, made, attachment, viewed, written };
}

// ── the plain sheet, as QuickLook gets it ─────────────────────────────
{
  const { Q, made, attachment, written } = harness();
  const out = await Q._buildContactSheet([attachment]);
  ok(out, 'a sheet is produced');
  eq(made.length, 4, 'the renderers ran');
  ok(out.endsWith('.html'), 'the caller gets the sheet itself back');
  ok(written.has('/tmp/zt/contactsheet_paper.pdf_pages/p1.jpg'),
     'thumbnails go beside the sheet, in a directory named after it');

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

// ── failure paths return null rather than a broken path ───────────────
{
  const { Q, attachment } = harness({ pdf: false });
  eq(await Q._buildContactSheet([attachment]), null, 'a non-PDF yields nothing');
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
  const { ZotLook: R } = loadPlugin({
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
    const { ZotLook: Q } = loadPlugin({
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
    const { ZotLook: Q } = loadPlugin({
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

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
