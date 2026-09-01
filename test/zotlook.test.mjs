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
  eq(press({code:'Space', shiftKey:true, altKey:true}).opened, null,
     'Shift+Option+Space is nobody\'s any more');
  // Tab carries nothing of ours. Bare Shift+Tab belongs to Zotero, which
  // moves focus backwards across twenty-two targets with it; Ctrl+Shift+Tab
  // held the windowed sheet for one version and gave it up for a key that
  // says what it does.
  eq(press({code:'Tab', shiftKey:true}).opened, null,
     'Shift+Tab is left to Zotero, which moves focus with it');
  eq(press({code:'Tab', ctrlKey:true, shiftKey:true}).opened, null,
     'and Ctrl+Shift+Tab is nobody\'s again');
  eq(press({code:'Space', ctrlKey:true}).prevented, false, 'an unmatched key is not consumed');
  eq(press({key:'y', metaKey:true}).opened, null,
     'Cmd+Y does nothing: the second preview shortcut was removed');
  eq(press({code:'Space', altKey:true, ctrlKey:true}).opened,
     '_openContactSheetInViewer',
     'Ctrl+Option+Space opens the sheet in a window — one modifier from the '
     + 'sheet itself, since the two do the same thing in different frames');

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

// ── the file has to be there, or be fetched ───────────────────────────
// Under "download as needed" most of a library is a database row until
// something asks for the file. Zotero's getFilePathAsync answers false for one
// that is not on disk — modelled faithfully below, because that is the whole
// bug: asking it first folded "no such attachment" and "not here yet" into one
// answer and left the fetch unreachable, so nothing was ever previewable that
// had not already been opened once.
{
  const PATH = '/store/book.epub';

  /** A library whose files can arrive, the way Zotero presents one. */
  const library = ({ present = false, syncing = true, download } = {}) => {
    const files = new Set(present ? [PATH] : []);
    const state = { files, downloaded: null };
    state.attachment = (over = {}) => ({
      id: 7, key: 'ABCD1234', libraryID: 1,
      isAttachment: () => true,
      attachmentLinkMode: 0,
      isStoredFileAttachment: () => true,
      isImportedAttachment: () => true,
      // The path it should have, whether or not it is there
      getFilePath: () => PATH,
      // Zotero's own: false unless the file is really on disk
      getFilePathAsync: async () => (files.has(PATH) ? PATH : false),
      ...over,
    });
    state.zotero = {
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Sync: {
        Storage: { Local: { getEnabledForLibrary: () => syncing } },
        Runner: {
          downloadFile: download || (async (item) => {
            state.downloaded = item.key;
            files.add(PATH);
          }),
        },
      },
    };
    state.IOUtils = { exists: async (p) => files.has(p) };
    return state;
  };

  {
    const lib = library({ present: true, download: async () => {
      throw new Error('must not download what is already here');
    } });
    const { zotLook: Q } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    eq(await Q._getAttachmentPath(lib.attachment()), PATH,
       'a file that is here is used as it is');
  }

  {
    const lib = library();
    const { zotLook: Q } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    eq(await Q._getAttachmentPath(lib.attachment()), PATH,
       'a file that is missing is fetched and then used');
    eq(lib.downloaded, 'ABCD1234', 'and it is the right attachment that is fetched');
  }

  {
    // Syncing off: nothing to fetch, and no attempt to
    let tried = false;
    const lib = library({ syncing: false, download: async () => { tried = true; } });
    const { zotLook: Q, logs } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    eq(await Q._getAttachmentPath(lib.attachment()), null, 'nothing to hand back');
    eq(tried, false, 'and no download is attempted');
    eq(logs.some(l => /syncing is off/.test(l)), true, 'the reason is logged');
  }

  {
    // A linked file that is gone is gone: there is no server copy of it
    let tried = false;
    const lib = library({ download: async () => { tried = true; } });
    const { zotLook: Q } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    eq(await Q._getAttachmentPath(
      lib.attachment({ isStoredFileAttachment: () => false })), null,
       'a missing linked file yields nothing');
    eq(tried, false, 'and is not looked for on the server');
  }

  {
    // The download failing must not throw into the preview
    const lib = library({ download: async () => { throw new Error('offline'); } });
    const { zotLook: Q, logs } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    eq(await Q._getAttachmentPath(lib.attachment()), null, 'a failed download yields null');
    eq(logs.some(l => /Download failed: .*offline/.test(l)), true, 'and says so');
  }

  {
    // Downloaded, and still not there: say so rather than fall silent
    const reports = [];
    const lib = library({ download: async () => {} });   // arrives with nothing
    const { zotLook: Q } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    Q._writeFailureReport = async (what) => { reports.push(what); };
    eq(await Q._getAttachmentPath(lib.attachment()), null,
       'still missing after the download');
    eq(reports.length, 1, 'and a failure report is left behind');
  }

  {
    // A web link has no file at all
    let tried = false;
    const lib = library({ download: async () => { tried = true; } });
    const { zotLook: Q } = loadPlugin({ zotero: lib.zotero, IOUtils: lib.IOUtils });
    eq(await Q._getAttachmentPath(lib.attachment({ attachmentLinkMode: 3 })), null,
       'a link-only attachment has nothing to preview');
    eq(tried, false, 'and nothing is fetched for it');
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
    const { zotLook: Q, zotLookEpub } = loadPlugin({
      IOUtils: {
        makeDirectory: async () => {},
        readUTF8: async () => { throw new Error('no key yet'); },
        writeUTF8: async () => {},
        remove: async () => {},
        stat: async () => ({ size: 10, lastModified: 5 }),
        exists: async () => false,
      },
    });
    let asked = null;
    let workDir = null;
    zotLookEpub.convert = async (p, env) => {
      asked = p; workDir = env.outDir; return '/tmp/preview.html';
    };
    eq(await Q._normalizeForPreview('/lib/book.epub'), '/tmp/preview.html',
       'the generated page is previewed');
    eq(asked, '/lib/book.epub', 'and the book was converted');
    ok(workDir && workDir.includes('epub_book.epub'),
       'into the entry the store handed out, not a directory of its own');
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

// ── the pane has to be able to find the plugin ────────────────────────
// The preference pane runs in the preferences window and is handed only
// util.js and prefs-pane.js. In 1.1.8 the pane called zotLook directly, and
// in that scope there is no such thing: the ReferenceError landed in the
// catch around the size lookup, so the figure beside the delete button was
// simply never shown and nothing anywhere said why.
{
  const { zotLook: Q, zotero } = loadPlugin({
    PreferencePanes: { register: async () => 'pane', unregister: () => {} },
    IOUtils: { getChildren: async () => { throw new Error('none'); } },
  });
  Q._loadStrings = async () => {};
  Q._watchPreferences = () => {};
  Q._unwatchPreferences = () => {};
  Q._cleanTempDir = async () => {};
  Q._closeQuickLook = () => {};
  Q._dropResourceAlias = () => {};
  Q._unregisterPreferencePane = () => {};

  Q.init({ id: 'zotlook@fre.ms', version: '1.1.8', rootURI: 'file:///p/' });
  ok(zotero.zotLook === Q,
     'init publishes the plugin on Zotero, the one scope the pane shares');

  Q.shutdown();
  eq('zotLook' in zotero, false,
     'and shutdown takes it away again rather than leaving a dead object '
     + 'behind for the next install to find');
}


// ── every shortcut is a switch, and Escape closes on every route ──────
// QuickLook on Windows toggles by itself and leaves no process behind, so
// _isActive never says a preview is up there; _pipeShown does.
{
  const { zotLook: Q, zotLookUtil: U } = loadPlugin();
  const win = { ZoteroPane: { getSelectedItems: () => [{}] } };
  const press = (o) => {
    let prevented = false;
    Q._onKeyDown({ code:'', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
      preventDefault(){prevented=true}, stopPropagation(){}, ...o }, win);
    return prevented;
  };
  let closed = 0; Q._closeQuickLook = () => { closed++; };
  Q._isActive = false; Q._pipeShown = true;
  eq(press({ key:'Escape' }), true, 'Escape while QuickLook shows something is consumed');
  eq(closed, 1, 'and closes it');
  Q._pipeShown = false;
  eq(press({ key:'Escape' }), false, 'Escape with nothing up is left to Zotero');
  eq(closed, 1, 'and closes nothing');

  // The window route: its shortcut closes the window it opened
  const key = U.parseShortcut(U.defaultShortcut('key.contactSheetWindow'));
  const own = { code: key.code, ctrlKey: !!key.ctrl, shiftKey: !!key.shift,
                altKey: !!key.alt, metaKey: !!key.meta };
  let opened = 0; Q._openContactSheetInViewer = () => { opened++; };
  Q._closeViewer = () => false;
  press(own); eq(opened, 1, 'with no window open, the shortcut opens one');
  Q._closeViewer = () => true;
  press(own); eq(opened, 1, 'with one open, it closes that instead');
  // The other shortcuts leave the window alone: it stays beside the reader
  let previews = 0; Q._openQuickLook = () => { previews++; };
  press({ code:'Space' }); eq(previews, 1, 'Space still previews while the window is open');
}

// ── the sheet's window answers its own shortcut and Escape ────────────
// It has the keyboard from the moment it opens, so the closing press lands
// there, not in the item list.
{
  const { zotLook: Q, zotLookUtil: U } = loadPlugin();
  const makeWin = () => {
    const listeners = {};
    return {
      closed: false, listeners,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type) => { delete listeners[type]; },
      close() { this.closed = true; if (listeners.unload) listeners.unload(); },
    };
  };
  const ev = (o) => {
    const e = { code:'', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
      prevented:false, preventDefault(){ this.prevented = true; }, stopPropagation(){}, ...o };
    return e;
  };
  const key = U.parseShortcut(U.defaultShortcut('key.contactSheetWindow'));
  const own = { code: key.code, ctrlKey: !!key.ctrl, shiftKey: !!key.shift,
                altKey: !!key.alt, metaKey: !!key.meta };

  const w = makeWin();
  Q._adoptViewer(w);
  ok(w.listeners.keydown, 'the window is listened to');
  eq(Q._viewer, w, 'and remembered');

  const space = ev({ code:'Space' }); w.listeners.keydown(space);
  eq(w.closed, false, 'Space leaves the window alone: it scrolls the sheet');
  eq(space.prevented, false, 'and is not consumed');

  const esc = ev({ key:'Escape' }); w.listeners.keydown(esc);
  eq(w.closed, true, 'Escape closes it');
  eq(esc.prevented, true, 'and is consumed');
  eq(Q._viewer, null, 'the window is forgotten as it goes');
  eq(Q._closeViewer(), false, 'and there is nothing left to close');

  const w2 = makeWin();
  Q._adoptViewer(w2);
  w2.listeners.keydown(ev(own));
  eq(w2.closed, true, 'its own shortcut closes it from inside');

  const w3 = makeWin();
  Q._adoptViewer(w3);
  w3.listeners.unload();
  eq(Q._viewer, null, 'a window the user closed is forgotten');
  eq(Q._closeViewer(), false, 'so the shortcut opens rather than closes next time');

  const w4 = makeWin();
  Q._adoptViewer(w4);
  Q._adoptViewer(w4);
  eq(Object.keys(w4.listeners).length, 2, 'adopting the same window twice listens once');
  Q._releaseViewer();
  eq(w4.closed, false, 'released at shutdown, the window stays');
  eq(w4.listeners.keydown, undefined, 'without the listener');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
