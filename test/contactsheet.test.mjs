// Exercises the real _buildContactSheet rather than stubbing it. The stub was
// how a lost function parameter — an identifier that still parses but throws
// at runtime — survived every previous run of this suite.
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

function harness({ prefValues = {}, pdf = true, exitCode = 0 } = {}) {
  const calls = [];
  const viewed = [];
  const files = new Set(['/plugin/contactsheet']);
  const IOUtils = {
    exists: async (p) => files.has(p),
    makeDirectory: async () => {},
    write: async (p) => { files.add(p); },
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
  Q._runProcess = async (cmd, args) => { calls.push({ cmd, args }); return { exitCode }; };
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });
  return { Q, calls, attachment, viewed };
}

// ── the plain sheet, as QuickLook gets it ─────────────────────────────
{
  const { Q, calls, attachment } = harness();
  const out = await Q._buildContactSheet([attachment]);
  ok(out, 'a sheet is produced');
  eq(calls.length, 1, 'the renderer ran once');
  const [pdfPath, outputPath, columns, maxPages, linkBase] = calls[0].args;
  eq(pdfPath, '/lib/paper.pdf', 'the PDF path is passed');
  eq(outputPath, out, 'the output path is what the caller gets back');
  eq(columns, '5', 'the default column count');
  eq(maxPages, '0', 'no page limit by default');
  eq(linkBase, 'zotero://open-pdf/library/items/ABCD1234',
     'and the reader links, which work once the sheet is opened in a browser');
}

// ── one sheet serves both routes ──────────────────────────────────────
{
  const { Q, calls, attachment } = harness();
  const a = await Q._buildContactSheet([attachment]);
  const b = await Q._buildContactSheet([attachment]);
  eq(a, b, 'the same file, whichever route asked for it');
  eq(calls[0].args[4], calls[1].args[4], 'built the same way both times');
}

// ── settings reach the renderer ───────────────────────────────────────
{
  const { Q, calls, attachment } = harness({ prefValues: {
    'extensions.zotlook.contactSheetColumns': 3,
    'extensions.zotlook.contactSheetMaxPages': 250,
  }});
  await Q._buildContactSheet([attachment]);
  eq(calls[0].args[2], '3', 'the configured column count is used');
  eq(calls[0].args[3], '250', 'the configured page limit is used');
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
  const { Q, calls, attachment } = harness();
  let launched = null;
  Q._launchPreview = async (p) => { launched = p; };
  eq(await Q._openContactSheet([attachment]), true, 'the QuickLook route succeeds');
  eq(calls[0].args[4], 'zotero://open-pdf/library/items/ABCD1234',
     'with reader links, useful once opened in a browser');
  ok(launched && launched[0], 'and previewed the file it got back');
}
{
  const { Q, calls, attachment, viewed } = harness();
  eq(await Q._openContactSheetInViewer([attachment]), true, 'the window route succeeds');
  eq(calls[0].args[4], 'zotero://open-pdf/library/items/ABCD1234',
     'and asked for a sheet with links');
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
    IOUtils: { exists: async () => true, makeDirectory: async () => {},
               write: async () => {}, setPermissions: async () => {}, remove: async () => {} },
  });
  R.version = '1.1.0'; R.rootURI = 'file:///plugin/';
  R._getTempDirPath = () => '/tmp/zt';
  R._showProgress = () => ({}); R._closeProgress = () => {};
  R._runProcess = async () => ({ exitCode: 0 });
  R._ensureContactSheetBinary = async () => '/tmp/zt/contactsheet-1.1.0';
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

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
