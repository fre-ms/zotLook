import { loadPlugin } from './load.mjs';

let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      got:  ${JSON.stringify(g)}\n      want: ${JSON.stringify(w)}`)); };
const ok = (c,l)=>eq(!!c,true,l);

// ── keyboard binding table ────────────────────────────────────────────
{
  const { zotLook: Q, zotLookUtil: U } = loadPlugin();
  const opened = [];
  for (const m of ['_openQuickLook','_openNotePreview','_openContactSheet',
                   '_openContactSheetInViewer']) Q[m] = () => opened.push(m);
  const win = { ZoteroPane: { getSelectedItems: () => [{}] } };
  const press = (o) => {
    opened.length = 0;
    let prevented = false, stopped = false;
    Q._onKeyDown({ code:'', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
      preventDefault(){prevented=true}, stopPropagation(){stopped=true}, ...o }, win);
    return { opened: opened[0] ?? null, prevented, stopped };
  };

  eq(press({code:'Space'}).opened, '_openQuickLook', 'Space previews');
  eq(press({code:'Space', shiftKey:true}).opened, '_openNotePreview', 'Shift+Space previews notes');
  // Pressed as shipped rather than as a literal, so changing the default
  // cannot leave this asserting a combination nothing is bound to any more
  const sheetKey = U.parseShortcut(U.defaultShortcut('key.contactSheet'));
  eq(press({ code: sheetKey.code, ctrlKey: !!sheetKey.ctrl, shiftKey: !!sheetKey.shift,
             altKey: !!sheetKey.alt, metaKey: !!sheetKey.meta }).opened,
     '_openContactSheet',
     `${U.defaultShortcut('key.contactSheet')} builds a contact sheet`);
  eq(press({code:'Space'}).prevented, true, 'a matched key is consumed');

  // exact modifier matching: no combination reaches two entries or the wrong one
  eq(press({code:'Space', ctrlKey:true}).opened, null,
     'Ctrl+Space ignored: it toggles the input method on Linux');
  eq(press({code:'Space', metaKey:true}).opened, null, 'Cmd+Space ignored (Spotlight)');
  eq(press({code:'Space', shiftKey:true, altKey:true}).opened, '_openContactSheetInViewer',
     'Shift+Option+Space opens the sheet in a window');
  eq(press({code:'Space', ctrlKey:true}).prevented, false, 'an unmatched key is not consumed');
  eq(press({key:'y', metaKey:true}).opened, null,
     'Cmd+Y does nothing: the second preview shortcut was removed');
  eq(press({code:'Space', altKey:true, ctrlKey:true}).opened, null,
     'Ctrl+Option+Space is left alone: macOS uses it for input sources');

  // toggle + escape
  Q._isActive = true;
  let closed = 0; Q._closeQuickLook = () => { closed++; };
  eq(press({code:'Space'}).opened, null, 'Space while active does not open again');
  eq(closed, 1, 'Space while active closes');
  eq(press({key:'Escape'}).prevented, true, 'Escape while active is consumed');
  eq(closed, 2, 'Escape while active closes');
  Q._isActive = false;
  eq(press({key:'Escape'}).prevented, false, 'Escape while idle is left to Zotero');
  eq(closed, 2, 'Escape while idle does nothing');

  // missing pane must not throw
  Q._isActive = false;
  let threw = false;
  try { Q._onKeyDown({code:'Space', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
    preventDefault(){}, stopPropagation(){}}, {}); } catch (e) { threw = true; }
  eq(threw, false, 'no ZoteroPane yet is survivable');
}

// ── _pickBestAttachment ───────────────────────────────────────────────
{
  const items = new Map();
  let nextId = 1;
  // Classified the way Zotero does it, by content type rather than by filename
  const att = (type, path) => {
    const id = nextId++;
    items.set(id, {
      id, isNote: () => false, isAttachment: () => true, _path: path,
      isPDFAttachment: () => type === 'pdf',
      isEPUBAttachment: () => type === 'epub',
      isSnapshotAttachment: () => type === 'html',
      isImageAttachment: () => type === 'image',
      isVideoAttachment: () => type === 'video',
      attachmentFilename: path.split('/').pop(),
    });
    return id;
  };
  const Items = { get: (id) => items.get(id) };
  const parent = (ids) => ({ getAttachments: () => ids });
  const make = (prefValues) => {
    const { zotLook: Q } = loadPlugin({ Items, prefValues });
    Q._getAttachmentPath = async (a) => a._path;
    return Q;
  };

  // ── the shipped default: PDF, then EPUB, then the rest
  {
    const Q = make();
    const pick = async (ids) => (await Q._pickBestAttachment(parent(ids)))?.path ?? null;
    eq(await pick([att('epub','/a/x.epub'), att('pdf','/a/y.pdf'), att('other','/a/z.txt')]),
       '/a/y.pdf', 'PDF wins over epub and other');
    eq(await pick([att('other','/a/z.txt'), att('epub','/a/x.epub')]),
       '/a/x.epub', 'epub wins over other');
    eq(await pick([att('other','/a/z.txt'), att('image','/a/w.png')]),
       '/a/w.png', 'image outranks other');
    eq(await pick([att('epub','/a/b.epub'), att('epub','/a/c.epub')]),
       '/a/b.epub', 'within a type the item order decides');
    eq(await pick([]), null, 'no attachments yields null');
    items.set(900, { id:900, isNote:()=>true, isAttachment:()=>true, _path:'/a/n.html' });
    eq(await pick([900, att('pdf','/a/y2.pdf')]), '/a/y2.pdf', 'child notes are skipped');
  }

  // ── a configured order is followed
  {
    const Q = make({ 'extensions.zotlook.attachmentOrder': 'epub,pdf,other' });
    eq((await Q._pickBestAttachment(parent([att('pdf','/a/p.pdf'), att('epub','/a/e.epub')])))?.path ?? null,
       '/a/e.epub', 'EPUB first when configured that way');
  }

  // ── the setting is a ranking, not a filter
  {
    const Q = make({ 'extensions.zotlook.attachmentOrder': 'pdf' });
    eq((await Q._pickBestAttachment(parent([att('epub','/a/e2.epub')])))?.path ?? null,
       '/a/e2.epub', 'a type the stored order omits is still used when it is all there is');
    eq((await Q._pickBestAttachment(parent([att('epub','/a/e3.epub'), att('pdf','/a/p2.pdf')])))?.path ?? null,
       '/a/p2.pdf', 'while the ranked type still wins');
  }

  // ── "first" mode ignores types
  {
    const Q = make({ 'extensions.zotlook.attachmentMode': 'first' });
    eq((await Q._pickBestAttachment(parent([att('other','/a/z2.txt'), att('pdf','/a/p3.pdf')])))?.path ?? null,
       '/a/z2.txt', 'the item order decides, whatever the type');
  }

  // ── an unusable order falls back rather than previewing nothing
  {
    const Q = make({ 'extensions.zotlook.attachmentOrder': 'nonsense,,' });
    eq((await Q._pickBestAttachment(parent([att('pdf','/a/p4.pdf')])))?.path ?? null,
       '/a/p4.pdf', 'an unparseable order falls back to the built-in one');
  }

  // ── resolution stops at the first candidate that works
  {
    const Q = make();
    const seen = [];
    Q._getAttachmentPath = async (a) => { seen.push(a.id); return a._path; };
    const a1 = att('pdf','/a/one.pdf'), a2 = att('pdf','/a/two.pdf');
    (await Q._pickBestAttachment(parent([a1, a2])))?.path ?? null;
    eq(seen.length, 1, 'only the winner is resolved');

    seen.length = 0;
    Q._getAttachmentPath = async (a) => (a.id === a1 ? null : a._path);
    eq((await Q._pickBestAttachment(parent([a1, a2])))?.path ?? null, '/a/two.pdf',
       'an unresolvable winner falls through to the next');
  }

  {
    const Q = make();
    Q._getAttachmentPath = async () => null;
    eq((await Q._pickBestAttachment(parent([att('pdf','/a/gone.pdf')])))?.path ?? null,
       null, 'nothing resolvable yields null');
  }
}

// ── EPUB: own renderer or Quick Look's ────────────────────────────────
// macOS shows no EPUB preview by itself, so the plugin builds one — but a
// Quick Look extension for EPUB does it better, and the plugin cannot detect
// whether one is installed.
{
  {
    const { zotLook: Q } = loadPlugin();
    eq(Q._pref('epubOwnRenderer', 'missing'), true, 'the shipped default renders EPUB itself');
  }

  // With the setting on, the path is replaced by the generated page
  {
    const { zotLook: Q, zotLookEpub } = loadPlugin();
    let asked = null;
    zotLookEpub.convert = async (p) => { asked = p; return '/tmp/preview.html'; };
    Q._epubEnv = () => ({});
    eq(await Q._normalizeForPreview('/lib/book.epub'), '/tmp/preview.html',
       'the generated page is previewed');
    eq(asked, '/lib/book.epub', 'and the book was converted');
  }

  // With it off, the file goes to Quick Look untouched
  {
    const { zotLook: Q, zotLookEpub } = loadPlugin({
      prefValues: { 'extensions.zotlook.epubOwnRenderer': false } });
    let asked = null;
    zotLookEpub.convert = async (p) => { asked = p; return '/tmp/preview.html'; };
    Q._epubEnv = () => ({});
    eq(await Q._normalizeForPreview('/lib/book.epub'), '/lib/book.epub',
       'the EPUB itself is handed to Quick Look');
    eq(asked, null, 'and no conversion happens at all');
  }

  // Other formats are never touched either way
  {
    const { zotLook: Q } = loadPlugin();
    eq(await Q._normalizeForPreview('/lib/book.mobi'), '/lib/book.mobi',
       'other formats pass through untouched');
    eq(await Q._normalizeForPreview('/lib/scan.djvu'), '/lib/scan.djvu',
       'including ones only an extension can show');
  }
}

// ── annotations are drawn into the preview ────────────────────────────
// Zotero keeps annotations in its database rather than in the PDF, so a plain
// preview shows an unmarked document.
{
  const mkPdf = (annotations) => ({
    id: 7, key: 'PDFKEY1', isNote: () => false, isAttachment: () => true,
    isPDFAttachment: () => true, attachmentFilename: 'paper.pdf',
    getAnnotations: () => annotations,
  });
  const ann = (dateModified, external = false) =>
    ({ dateModified, annotationIsExternal: external });

  const make = (prefValues, exported = []) => {
    const { zotLook: Q } = loadPlugin({
      prefValues,
      IOUtils: { exists: async () => false, makeDirectory: async () => {} },
      zotero: { PDFWorker: { export: async (id, path) => { exported.push({ id, path }); } } },
    });
    Q._getTempDirPath = () => '/tmp/zt';
    return Q;
  };

  // No annotations: no export at all
  {
    const exported = [];
    const Q = make({}, exported);
    eq(await Q._normalizeForPreview('/lib/p.pdf', mkPdf([])), '/lib/p.pdf',
       'an unannotated PDF is previewed as it is');
    eq(exported.length, 0, 'and nothing is exported for it');
  }

  // Only external annotations: already in the file, so still nothing to do
  {
    const exported = [];
    const Q = make({}, exported);
    eq(await Q._normalizeForPreview('/lib/p.pdf', mkPdf([ann('2026-01-01', true)])),
       '/lib/p.pdf', 'external annotations are already part of the file');
    eq(exported.length, 0, 'so no export happens');
  }

  // With annotations: the exported copy is previewed
  {
    const exported = [];
    const Q = make({}, exported);
    const out = await Q._normalizeForPreview('/lib/p.pdf', mkPdf([ann('2026-01-01')]));
    ok(out !== '/lib/p.pdf', 'the annotated copy is previewed instead');
    ok(out.endsWith('.pdf'), 'and it is a PDF');
    eq(exported.length, 1, 'exported once');
    eq(exported[0].id, 7, 'for the right attachment');
  }

  // Switched off: never exported
  {
    const exported = [];
    const Q = make({ 'extensions.zotlook.previewAnnotations': false }, exported);
    eq(await Q._normalizeForPreview('/lib/p.pdf', mkPdf([ann('2026-01-01')])),
       '/lib/p.pdf', 'the setting turns it off');
    eq(exported.length, 0, 'and nothing is exported');
  }

  // A failing export must not lose the preview
  {
    const { zotLook: Q } = loadPlugin({
      IOUtils: { exists: async () => false, makeDirectory: async () => {} },
      zotero: { PDFWorker: { export: async () => { throw new Error('broken'); } } },
    });
    Q._getTempDirPath = () => '/tmp/zt';
    eq(await Q._normalizeForPreview('/lib/p.pdf', mkPdf([ann('2026-01-01')])),
       '/lib/p.pdf', 'a failed export falls back to the plain file');
  }

  // An older Zotero without the worker is survivable
  {
    const { zotLook: Q } = loadPlugin({ zotero: { PDFWorker: undefined } });
    eq(await Q._normalizeForPreview('/lib/p.pdf', mkPdf([ann('2026-01-01')])),
       '/lib/p.pdf', 'no PDF worker, no annotated preview');
  }

  // Signature: changes when an annotation is added or edited
  {
    const Q = make({});
    const sig = (a) => Q._annotationSignature(mkPdf(a));
    eq(sig([]), null, 'no annotations, no signature');
    eq(sig([ann('2026-01-01', true)]), null, 'external ones do not count');
    ok(sig([ann('2026-01-01')]) !== sig([ann('2026-01-02')]), 'an edit changes it');
    ok(sig([ann('2026-01-01')]) !== sig([ann('2026-01-01'), ann('2026-01-01')]),
       'adding one changes it');
    eq(sig([ann('2026-01-01')]), sig([ann('2026-01-01')]), 'and it is otherwise stable');
  }

  // Non-PDF attachments are untouched
  {
    const exported = [];
    const Q = make({}, exported);
    const epub = { key: 'E', isNote: () => false, isAttachment: () => true,
                   isPDFAttachment: () => false, attachmentFilename: 'b.epub',
                   getAnnotations: () => [ann('2026-01-01')] };
    eq(await Q._normalizeForPreview('/lib/b.mobi', epub), '/lib/b.mobi',
       'a non-PDF attachment is never exported');
    eq(exported.length, 0, 'nothing exported');
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
