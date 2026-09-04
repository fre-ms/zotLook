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
  Q._pipeShown = false; Q._sushiShown = true;
  eq(press({ key:'Escape' }), true, 'Escape while Sushi shows something is consumed');
  eq(closed, 2, 'and closes it');
  Q._sushiShown = false;
  eq(press({ key:'Escape' }), false, 'Escape with nothing up is left to Zotero');
  eq(closed, 2, 'and closes nothing');

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

  // The chord itself stays a live toggle on Linux: pressed again in Zotero
  // it re-sends ShowFile, whose close-if-already-shown does the closing — a
  // flag the user may have invalidated from inside Sushi never decides, so
  // the toggle cannot go stale.
  Q._viewer = null; Q._sushiShown = true;
  let sheets = 0; Q._openContactSheet = () => { sheets++; };
  const sheetKey = U.parseShortcut(U.defaultShortcut('key.contactSheet'));
  press({ code: sheetKey.code, ctrlKey: !!sheetKey.ctrl, shiftKey: !!sheetKey.shift,
          altKey: !!sheetKey.alt, metaKey: !!sheetKey.meta });
  eq(sheets, 1, 'the sheet chord re-opens rather than trusting the flag');
  eq(closed, 2, 'and does not go through the close path');
}

// ── the sheet's window answers its own shortcut and Escape ────────────
// It has the keyboard from the moment it opens, so the closing press lands
// there, not in the item list. A plain listener catches it in-process; the
// injected <key>s catch it even when the file loads in a process of its own.
{
  const readerOpens = [];
  const readerOpen = async (...args) => { readerOpens.push(args); return 'reader'; };
  const Reader = { open: readerOpen };
  const { zotLook: Q, zotLookUtil: U, prefs } = loadPlugin({ zotero: { Reader } });
  // A window with just enough of a XUL document for the key injection
  const makeWin = () => {
    const byId = {};
    const listeners = {};
    const win = { closed: false, closedBy: null, listeners };
    // close() on the plugin's reference is a silent no-op in the real window,
    // so the window's own cmd_close is what must be used; both are provided
    // here, and closedBy records which path ran.
    const shut = (how) => { win.closed = true; win.closedBy = how; if (listeners.unload) listeners.unload(); };
    byId['cmd_close'] = { doCommand: () => shut('command') };
    const docEl = { appendChild(n) { if (n.id) byId[n.id] = n; } };
    win.browser = { focused: 0, focus() { this.focused++; } };
    win.active = false;
    win.document = {
      hasFocus: () => win.active,
      documentElement: docEl,
      getElementById: (id) => byId[id] || null,
      querySelector: (sel) => (sel === 'browser' ? win.browser : null),
      createXULElement: (tag) => ({
        tag, id: '', attrs: {}, children: [],
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(c) { this.children.push(c); },
        remove() { if (this.id) delete byId[this.id]; },
      }),
    };
    let keydowns = 0;
    win.keydowns = () => keydowns;
    win.addEventListener = (type, fn) => { if (type === 'keydown') keydowns++; listeners[type] = fn; };
    win.removeEventListener = (type) => { delete listeners[type]; };
    win.close = () => shut('close');
    return win;
  };
  const ev = (o) => ({ code:'', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
    prevented:false, preventDefault(){ this.prevented = true; }, stopPropagation(){}, ...o });
  const key = U.parseShortcut(U.defaultShortcut('key.contactSheetWindow'));
  const own = { code: key.code, ctrlKey: !!key.ctrl, shiftKey: !!key.shift,
                altKey: !!key.alt, metaKey: !!key.meta };

  const w = makeWin();
  Q._adoptViewer(w);
  ok(w.listeners.keydown, 'the window is listened to');
  eq(Q._viewer, w, 'and remembered');

  // Scrolling needs the keyboard, and the keyboard needs a focused content:
  // arrows and the Page keys did nothing while only the wheel worked.
  ok(w.browser.focused >= 1, 'the sheet content is given the keyboard');
  if (w.listeners.load) w.listeners.load();
  ok(w.browser.focused >= 2, 'and again when the load lands, whichever came first');

  // the chrome-level keys, for when the listener above cannot hear the press
  const keyset = w.document.getElementById('zotlook-viewer-keys');
  ok(keyset, 'a keyset is installed in the window');
  eq(keyset.children.length, 4,
     'Escape, the sheet’s own shortcut, and the system preview’s Space and q');
  eq(keyset.children[0].attrs.keycode, 'VK_ESCAPE', 'the first is Escape');
  eq(keyset.children[0].attrs.command, 'cmd_close', 'firing the window’s own close');
  eq(keyset.children[1].attrs.keycode, 'VK_SPACE', 'the second is the shortcut’s Space');
  eq(keyset.children[1].attrs.modifiers, 'control,alt', 'with its modifiers');
  eq(keyset.children[1].attrs.command, 'cmd_close', 'also closing the window');
  eq(keyset.children[2].attrs.keycode, 'VK_SPACE', 'the third is a bare Space');
  eq(keyset.children[2].attrs.modifiers, undefined, 'bare: no modifiers attribute');
  eq(keyset.children[3].attrs.key, 'q', 'the fourth is a bare q');
  eq(keyset.children[3].attrs.modifiers, undefined, 'bare as well');

  // Space and q close, the way they close Sushi and QuickLook — but only
  // bare, and never out of a field that takes typing
  const shiftSpace = ev({ code:'Space', shiftKey:true }); w.listeners.keydown(shiftSpace);
  eq(w.closed, false, 'Shift+Space is someone else’s press');
  const ctrlQ = ev({ key:'q', ctrlKey:true }); w.listeners.keydown(ctrlQ);
  eq(w.closed, false, 'Ctrl+q likewise');
  const typedQ = ev({ key:'q', target: { tagName: 'INPUT' } }); w.listeners.keydown(typedQ);
  eq(w.closed, false, 'a q typed into a field stays a letter');
  const space = ev({ code:'Space' }); w.listeners.keydown(space);
  eq(w.closed, true, 'a bare Space closes it, as it closes the system preview');
  eq(space.prevented, true, 'and is consumed');

  eq(w.closedBy, 'command', 'through the window’s own cmd_close, not the reference’s no-op close()');
  eq(Q._viewer, null, 'the window is forgotten as it goes');
  eq(Q._closeViewer(), false, 'and there is nothing left to close');

  const wEsc = makeWin();
  Q._adoptViewer(wEsc);
  const esc = ev({ key:'Escape' }); wEsc.listeners.keydown(esc);
  eq(wEsc.closed, true, 'Escape closes it');
  eq(esc.prevented, true, 'and is consumed');

  const wQ = makeWin();
  Q._adoptViewer(wQ);
  wQ.listeners.keydown(ev({ key:'q' }));
  eq(wQ.closed, true, 'a bare q closes it too');

  const w2 = makeWin();
  Q._adoptViewer(w2);
  w2.listeners.keydown(ev(own));
  eq(w2.closed, true, 'its own shortcut closes it from inside');

  // An unload while the window is merely swapping its initial document for
  // the file — closed still false — must not forget it, or the key listener
  // is left firing against nothing and the window never closes.
  const w3 = makeWin();
  Q._adoptViewer(w3);
  w3.listeners.unload();
  eq(Q._viewer, w3, 'a spurious unload leaves the window adopted');
  const s = ev({ key:'Escape' }); w3.listeners.keydown(s);
  eq(w3.closed, true, 'so Escape still closes it afterwards');

  // The window the user closes by hand is forgotten, so the next press opens
  // a fresh one rather than being swallowed
  const w3b = makeWin();
  Q._adoptViewer(w3b);
  w3b.close();
  eq(Q._viewer, null, 'a window closed by hand is forgotten');
  eq(Q._closeViewer(), false, 'so the shortcut opens rather than closes next time');

  // The real close by hand — Cmd+W, the red button — sends the unload while
  // closed is still false and only then goes: looked at once, it passes for
  // the swap above. So it is looked at again a moment later.
  const w3c = makeWin();
  Q._adoptViewer(w3c);
  w3c.listeners.unload();
  w3c.closed = true;
  eq(Q._viewer, w3c, 'at the unload itself the window is still held');
  await new Promise((r) => setTimeout(r, 350));
  eq(Q._viewer, null, 'a moment later the closed window is forgotten');
  eq(Q._closeViewer(), false, 'and the next press opens rather than closes');

  // Torn down by Gecko, the reference is a dead wrapper that throws on any
  // read — which is the surest sign of a closed window, not of an open one:
  // taken for open, it swallowed the next shortcut
  const w3d = makeWin();
  Q._adoptViewer(w3d);
  Object.defineProperty(w3d, 'closed', { get() { throw new TypeError("can't access dead object"); } });
  eq(Q._closeViewer(), false, 'a dead reference counts as closed');
  eq(Q._viewer, null, 'and is let go');
  const w3e = makeWin();
  Q._adoptViewer(w3e);
  w3e.listeners.unload();
  Object.defineProperty(w3e, 'closed', { get() { throw new TypeError("can't access dead object"); } });
  await new Promise((r) => setTimeout(r, 350));
  eq(Q._viewer, null, 'a window dead after its unload is forgotten too');

  // ── the loading hint ──
  // The window stands empty until its browser has the file; a line is laid
  // over it, and taken away when the browser reports the sheet's title —
  // not the blank's title, which comes first
  const withBrowser = () => {
    const w = makeWin();
    const appended = [];
    w.document.documentElement.appendChild = (n) => { appended.push(n); if (n.id) w.document._byId(n.id, n); };
    const byId = {};
    w.document._byId = (id, n) => { byId[id] = n; };
    const getById = w.document.getElementById;
    w.document.getElementById = (id) => byId[id] || getById(id);
    w.document.createElementNS = (ns, tag) => ({
      ns, tag, id: '', attrs: {}, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      remove() { delete byId[this.id]; this.removed = true; },
    });
    const handlers = {};
    w.browser.currentURI = { spec: 'about:blank' };
    w.browser.addEventListener = (type, fn) => { handlers[type] = fn; };
    w.browser.removeEventListener = (type) => { delete handlers[type]; };
    w.browser.handlers = handlers;
    return w;
  };
  const wl = withBrowser();
  Q._adoptViewer(wl);
  const hint = wl.document.getElementById('zotlook-viewer-loading');
  ok(hint, 'a loading hint goes over the window as it is adopted');
  ok(hint.textContent.length > 0, 'with a word on it');
  ok(wl.browser.handlers.pagetitlechanged, 'and the browser is listened to for the title');
  wl.browser.handlers.pagetitlechanged();
  eq(hint.removed, undefined, 'the blank’s title does not take it away');
  wl.browser.currentURI = { spec: 'file:///tmp/sheet.html' };
  wl.browser.handlers.pagetitlechanged();
  eq(hint.removed, true, 'the sheet’s title does');
  eq(wl.browser.handlers.pagetitlechanged, undefined, 'and the listener goes with it');
  const wl2 = withBrowser();
  Q._adoptViewer(wl2);
  const hint2 = wl2.document.getElementById('zotlook-viewer-loading');
  Q._releaseViewer();
  eq(hint2.removed, true, 'a released window loses the hint at once');

  // ── the window's size is kept ──
  // The viewer sizes itself to its minimum on every load; the size the
  // reader left it at is put back on the load, and kept as it changes
  const sized = () => {
    const w = makeWin();
    w.sizes = []; w.outerWidth = 1000; w.outerHeight = 728;
    w.resizeTo = (x, y) => { w.sizes.push([x, y]); w.outerWidth = x; w.outerHeight = y; };
    return w;
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const ws = sized();
  Q._adoptViewer(ws);
  eq(ws.sizes.length, 0, 'before the load nothing is sized');
  ws.listeners.load();
  eq(ws.listeners.resize, undefined, 'the viewer’s own sizing, right after the load, is not taken for the reader’s');
  await tick();
  eq(ws.sizes.length, 0, 'with no size kept, the viewer’s own stands');
  ok(ws.listeners.resize, 'and the window is watched for a resize from then on');
  ws.outerWidth = 1400; ws.outerHeight = 860; ws.listeners.resize();
  eq(prefs.get('extensions.zotlook.windowWidth'), 1400, 'a resize keeps the width');
  eq(prefs.get('extensions.zotlook.windowHeight'), 860, 'and the height');
  Q._releaseViewer();
  const ws2 = sized();
  Q._adoptViewer(ws2);
  ws2.listeners.load();
  await tick();
  eq(JSON.stringify(ws2.sizes), '[[1400,860]]', 'the next window is put back to that size on its load');
  ws2.outerWidth = 200; ws2.outerHeight = 100; ws2.listeners.resize();
  eq(prefs.get('extensions.zotlook.windowWidth'), 1400, 'an absurd size is not kept');
  Q._releaseViewer();

  // ── under X11 the size is asked for twice ──
  // Gecko takes a resizeTo for the content until it knows the frame the
  // window manager put on, and for the frame from then on; outerHeight
  // counts the frame throughout. A window whose content took the outer
  // measure whole is asked for the same size again, which the frame now
  // known holds to the outer measure; and that measure is what is kept
  const x11 = () => {
    const w = makeWin();
    const bar = 37;
    w.sizes = []; w.innerWidth = 1000; w.innerHeight = 700;
    w.outerWidth = 1000; w.outerHeight = 700 + bar;
    w.framed = false;
    w.resizeTo = (x, y) => {
      w.sizes.push([x, y]);
      if (w.framed) {
        w.outerWidth = x; w.outerHeight = y; w.innerWidth = x; w.innerHeight = y - bar;
      } else {
        w.innerWidth = x; w.innerHeight = y; w.outerWidth = x; w.outerHeight = y + bar;
        w.framed = true;
      }
    };
    return w;
  };
  const wx = x11();
  Q._adoptViewer(wx);
  wx.listeners.load();
  await tick();
  eq(JSON.stringify(wx.sizes), '[[1400,860]]', 'the kept size is asked for first');
  eq(wx.outerHeight, 897, 'and comes out taller by the bar, as content');
  wx.listeners.resize();
  eq(JSON.stringify(wx.sizes), '[[1400,860],[1400,860]]', 'the content having taken it whole, the same size is asked for again');
  eq(wx.outerHeight, 860, 'which the frame now known holds to the outer measure');
  eq(prefs.get('extensions.zotlook.windowHeight'), 860, 'and the taller figure is not kept');
  wx.listeners.resize();
  eq(wx.sizes.length, 2, 'the next resize asks for nothing');
  eq(prefs.get('extensions.zotlook.windowHeight'), 860, 'and keeps the outer measure, which holds');
  wx.innerHeight = 900; wx.outerHeight = 937; wx.listeners.resize();
  eq(prefs.get('extensions.zotlook.windowHeight'), 937, 'a resize by the reader is kept as before');
  Q._releaseViewer();
  const wx2 = x11();
  Q._adoptViewer(wx2);
  wx2.listeners.load();
  await tick();
  wx2.listeners.resize();
  eq(JSON.stringify(wx2.sizes), '[[1400,937],[1400,937]]', 'and the next window comes back at that outer size the same way');
  eq(wx2.outerHeight, 937, 'outer');
  eq(wx2.innerHeight, 900, 'content less the bar');
  Q._releaseViewer();

  const w4 = makeWin();
  Q._adoptViewer(w4);
  Q._adoptViewer(w4);
  eq(w4.keydowns(), 1, 'adopting the same window twice listens once');
  Q._releaseViewer();
  eq(w4.closed, false, 'released at shutdown, the window stays');
  eq(w4.listeners.keydown, undefined, 'without the listener');
  eq(w4.document.getElementById('zotlook-viewer-keys'), null, 'and without the keys');

  // ── a click hands over to the reader, and the window goes with it ──
  // The click itself may happen in a content process no chrome listener
  // hears, so what is watched is where every click ends: Zotero.Reader.open.
  eq(Reader.open, readerOpen, 'before any window, Reader.open is untouched');
  const w5 = makeWin();
  Q._adoptViewer(w5);
  ok(Reader.open !== readerOpen, 'an adopted window watches Reader.open');

  // The item decides first: a reader opening for the attachment the sheet
  // was drawn from is that sheet's handoff, whoever holds the keyboard.
  // Focus alone was not enough — the window Gecko makes for a target=_blank
  // link takes it before the reader is asked for.
  w5.active = false;
  Q._viewerItemID = 4242;
  eq(await Reader.open(4242, { page: 7 }), 'reader', 'the handoff answers');
  eq(w5.closed, true, 'the sheet closes for its own attachment, unfocused');

  const w5b = makeWin();
  Q._adoptViewer(w5b);
  Q._viewerItemID = 4242;
  w5b.active = false;
  await Reader.open(99, { page: 1 });
  eq(w5b.closed, false, 'another attachment leaves it standing');
  Q._viewerItemID = null;

  // A reader opened from elsewhere leaves the sheet alone
  Q._releaseViewer();
  Q._adoptViewer(w5);
  w5.closed = false; w5.closedBy = null;
  w5.active = false;
  const before = readerOpens.length;
  eq(await Reader.open(1, { page: 3 }), 'reader', 'the wrapped open still answers');
  eq(readerOpens.length, before + 1, 'and still opens the reader');
  eq(w5.closed, false, 'a reader opened elsewhere leaves the window standing');

  // One opened by a click in the window closes it behind the handoff
  w5.active = true;
  eq(await Reader.open(1, { page: 5 }), 'reader', 'the handoff answers too');
  eq(w5.closed, true, 'and the window closes behind it');
  eq(w5.closedBy, 'command', 'through its own close command');
  eq(Reader.open, readerOpen, 'with the window gone, Reader.open is its old self');

  // A wrapper someone else laid on top of ours is not clobbered
  const w6 = makeWin();
  Q._adoptViewer(w6);
  const foreign = async (...a) => Reader.open === foreign && 'foreign';
  const ours = Reader.open;
  Reader.open = foreign;
  Q._releaseViewer();
  eq(Reader.open, foreign, 'releasing under a foreign wrapper leaves it be');
  Reader.open = readerOpen;
  ok(ours !== readerOpen, 'sanity: ours really was a wrapper');
}

// ── the system preview closes on the handoff too ──────────────────────
// QuickLook and Sushi are other applications; a click in them never focuses
// a Zotero window, so focus cannot tell the handoff apart. But each shows one
// file, or a sheet whose only links open the reader — so a reader opening
// while the preview is up is that click, and the preview closes behind it,
// the same as the window. The watch is in place only while a preview is up.
{
  const readerOpens = [];
  const orig = async (...a) => { readerOpens.push(a); return 'r'; };
  const Reader = { open: orig };
  const { zotLook: Q } = loadPlugin({ zotero: { Reader } });
  let pipe = 0, sushi = 0;
  Q._dismissPipePreview = () => { pipe++; Q._pipeShown = false; Q._syncReaderHook(); };
  Q._dismissSushiPreview = () => { sushi++; Q._sushiShown = false; Q._syncReaderHook(); };

  eq(Reader.open, orig, 'with no preview up, Reader.open is untouched');

  Q._pipeShown = true; Q._syncReaderHook();
  ok(Reader.open !== orig, 'a shown system preview watches Reader.open');
  eq(await Reader.open(1, { page: 2 }), 'r', 'the wrapped open still answers');
  eq(readerOpens.length, 1, 'and still opens the reader');
  eq(pipe, 1, 'the QuickLook preview closes behind the handoff');
  eq(Reader.open, orig, 'and with nothing left up, the watch is lifted');

  Q._sushiShown = true; Q._syncReaderHook();
  ok(Reader.open !== orig, 'a Sushi preview watches too');
  await Reader.open(2, {});
  eq(sushi, 1, 'and Sushi closes behind the handoff');
  eq(Reader.open, orig, 'and the watch is lifted again');

  await Reader.open(3, {});
  eq(pipe, 1, 'a reader opened with nothing up dismisses nothing');
  eq(sushi, 1, 'for either preview');
}

// ── closing is caught at the window, not only at the item tree ────────
// Escape after a context-menu command lands wherever the menu left focus,
// so the close handler sits on the window and works from anywhere in it.
{
  const { zotLook: Q, zotLookUtil: U } = loadPlugin();
  const ev = (o) => ({ code:'', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
    prevented:false, preventDefault(){ this.prevented = true; }, stopPropagation(){}, ...o });
  let closedQL = 0; Q._closeQuickLook = () => { closedQL++; };
  let closedViewer = 0; Q._closeViewer = () => { if (!Q._viewer) return false; Q._viewer = null; closedViewer++; return true; };

  // Escape closes the QuickLook preview when one may be showing
  Q._isActive = false; Q._pipeShown = true; Q._viewer = null;
  let e = ev({ key:'Escape' }); Q._onCloseKey(e);
  eq(closedQL, 1, 'Escape closes the system preview from anywhere in the window');
  eq(e.prevented, true, 'and is consumed');

  // Escape closes the window when that is what is open
  Q._pipeShown = false; Q._viewer = {};
  e = ev({ key:'Escape' }); Q._onCloseKey(e);
  eq(closedViewer, 1, 'Escape closes the contact sheet window');
  eq(e.prevented, true, 'and is consumed');

  // Escape with nothing open is left entirely alone
  Q._viewer = null;
  e = ev({ key:'Escape' }); Q._onCloseKey(e);
  eq(e.prevented, false, 'Escape with nothing up is not consumed');

  // the windowed shortcut closes the window from anywhere too
  const key = U.parseShortcut(U.defaultShortcut('key.contactSheetWindow'));
  Q._viewer = {};
  e = ev({ code: key.code, ctrlKey: !!key.ctrl, shiftKey: !!key.shift, altKey: !!key.alt, metaKey: !!key.meta });
  Q._onCloseKey(e);
  eq(closedViewer, 2, 'the windowed shortcut closes it, wherever the focus is');

  // an unrelated key is never touched
  Q._viewer = {};
  e = ev({ code:'Space' }); Q._onCloseKey(e);
  eq(e.prevented, false, 'Space is left for the tree to open a preview with');

  // A window the reader closed by hand may still be remembered for a
  // moment. The press that finds it gone closed nothing, and must go on to
  // the item list, which opens a fresh one — consumed here, it took a
  // second press to do so.
  Q._closeViewer = () => { Q._viewer = null; return false; };
  Q._viewer = { closed: true };
  e = ev({ code: key.code, ctrlKey: !!key.ctrl, shiftKey: !!key.shift, altKey: !!key.alt, metaKey: !!key.meta });
  Q._onCloseKey(e);
  eq(e.prevented, false, 'the shortcut that finds the window gone is not consumed');
  eq(Q._viewer, null, 'and the window is let go');
  Q._viewer = { closed: true };
  e = ev({ key:'Escape' }); Q._onCloseKey(e);
  eq(e.prevented, false, 'Escape likewise');
}

// ── the item pane section: the three actions as buttons ───────────────
{
  let registered = null; const unregistered = [];
  const { zotLook: Q } = loadPlugin({ zotero: { ItemPaneManager: {
    registerSection: (o) => { registered = o; return 'zotlook-actions'; },
    unregisterSection: (id) => { unregistered.push(id); return true; },
  } } });
  Q.rootURI = 'file:///plugin/';
  Q._registerItemPaneSection();
  ok(registered && registered.paneID === 'zotlook-actions', 'a section is registered');
  eq(registered.header.l10nID, 'zotlook-pane-header', 'with a header of its own');
  ok(registered.header.icon.endsWith('icon/zotlook-24.svg'), 'and the plugin\'s icon');
  let enabled = null;
  registered.onItemChange({ item: { isRegularItem: () => true, isAttachment: () => false }, setEnabled: (v) => { enabled = v; } });
  eq(enabled, true, 'shown for a regular item');
  registered.onItemChange({ item: { isRegularItem: () => false, isAttachment: () => false }, setEnabled: (v) => { enabled = v; } });
  eq(enabled, false, 'not for a note or a collection');
  const made = [];
  const el = (tag) => ({ tag, children: [], attrs: {}, listeners: {}, textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }, get firstChild() { return this.children[0] || null; },
    addEventListener(t, fn) { this.listeners[t] = fn; } });
  const body = el('div'); const item = { id: 42 };
  registered.onRender({ doc: { createElement: (t) => { const e = el(t); made.push(e); return e; } }, body, item });
  const buttons = made.filter((e) => e.tag === 'button');
  eq(buttons.map((b) => b.textContent), ['Preview', 'Contact sheet', 'Sheet in a window'], 'three buttons, named');
  const opened = [];
  Q._openQuickLook = async (items) => { opened.push(['preview', items]); };
  Q._openContactSheet = async (items) => { opened.push(['sheet', items]); };
  Q._openContactSheetInViewer = async (items) => { opened.push(['window', items]); };
  for (const b of buttons) b.listeners.click({ preventDefault() {} });
  eq(opened, [['preview', [item]], ['sheet', [item]], ['window', [item]]], 'each does what its key would, for the item shown');
  registered.onRender({ doc: { createElement: (t) => el(t) }, body, item });
  eq(body.children.length, 1, 'rendered again, the body holds one row, not two');
  Q._unregisterItemPaneSection();
  eq(unregistered, ['zotlook-actions'], 'and it goes at shutdown');
}

// ── what a press previews: one item's every attachment, or one per item ──
{
  const att = (id, name) => ({ id, key: 'A' + id, isNote: () => false, isAttachment: () => true,
    attachmentFilename: name, isPDFAttachment: () => name.endsWith('.pdf') });
  const atts = { 1: att(1, 'notes.html'), 2: att(2, 'paper.pdf'), 3: att(3, 'figure.png') };
  const item = (id, ids) => ({ id, key: 'I' + id, isNote: () => false, isAttachment: () => false,
    getAttachments: () => ids });
  const { zotLook: Q } = loadPlugin({ zotero: { Items: { get: (id) => atts[id] } } });
  Q._getAttachmentPath = async (a) => '/lib/' + a.attachmentFilename;
  Q._normalizeForPreview = async (p) => p;
  Q._attachmentType = (a) => (a.attachmentFilename.endsWith('.pdf') ? 'pdf' : a.attachmentFilename.endsWith('.png') ? 'image' : 'html');
  eq(await Q._getPreviewPath([item(10, [1, 2, 3])]), ['/lib/paper.pdf', '/lib/notes.html', '/lib/figure.png'],
     'one item: every attachment it has, in the order the preference puts them');
  eq(Q._previewList.paths.length, 3, 'and the list is kept for the arrows');
  eq(await Q._getPreviewPath([item(10, [1, 2, 3]), item(11, [3])]), ['/lib/paper.pdf', '/lib/figure.png'],
     'several items: the best of each, one file per item');
  const list = Q._previewList; const shown = [];
  Q._switchPreviewTo = async (p) => { shown.push(p); return true; };
  await Q._stepPreviewList(1); await Q._stepPreviewList(1); await Q._stepPreviewList(-1);
  eq(shown, ['/lib/figure.png', '/lib/paper.pdf', '/lib/figure.png'], 'the arrows walk the list and wrap');
  eq(list.index, 1, 'and it knows where it stands');
  Q._previewList = { paths: ['/one'], index: 0 };
  eq(await Q._stepPreviewList(1), false, 'a list of one has nothing to walk');
}

// ── the sheet shortcut on the collection tree ─────────────────────────
{
  const { zotLook: Q, zotLookUtil: U } = loadPlugin();
  const key = U.parseShortcut(U.defaultShortcut('key.contactSheetWindow'));
  const ev = (o) => ({ code:'', key:'', shiftKey:false, altKey:false, metaKey:false, ctrlKey:false,
    prevented:false, preventDefault(){ this.prevented = true; }, stopPropagation(){}, ...o });
  const own = () => ev({ code: key.code, ctrlKey: !!key.ctrl, shiftKey: !!key.shift, altKey: !!key.alt, metaKey: !!key.meta });
  const opened = [];
  Q._openContactSheetInViewer = async (items, options) => { opened.push([items.map((i) => i.id), options]); };
  const item = (id, regular = true) => ({ id, isRegularItem: () => regular });
  let collection = { getChildItems: () => [item(1), item(2, false), item(3)] };
  const win = { ZoteroPane: { getSelectedCollections: () => (collection ? [collection] : []) } };
  let e = own(); Q._onCollectionKeyDown(e, win);
  eq(opened, [[[1, 3], { collection: true }]], 'the shortcut on a collection lays out its regular items as a collection sheet');
  eq(e.prevented, true, 'and takes the key');
  collection = { getChildItems: () => [item(7)] };
  e = own(); Q._onCollectionKeyDown(e, win);
  eq(opened[1], [[7], { collection: true }], 'a collection of one is a collection sheet all the same');
  collection = { getChildItems: () => [item(7), item(8)] };
  const two = { ZoteroPane: { getSelectedCollections: () => [collection, { getChildItems: () => [item(8), item(9)] }] } };
  e = own(); Q._onCollectionKeyDown(e, two);
  eq(opened[2][0], [7, 8, 9], 'several collections selected give their items together, each once');
  const older = { ZoteroPane: { getSelectedCollection: () => ({ getChildItems: () => [item(4)] }) } };
  e = own(); Q._onCollectionKeyDown(e, older);
  eq(opened[3][0], [4], 'a Zotero with the singular still works');
  collection = null;
  e = own(); Q._onCollectionKeyDown(e, win);
  eq(opened.length, 4, 'the library root is left alone');
  eq(e.prevented, false, 'and so is the key');
  e = ev({ code: 'Space' }); Q._onCollectionKeyDown(e, win);
  eq(e.prevented, false, 'Space on the tree is the tree\'s');
}

// ── the tag that keys kept sheets carries the sheet's own code ────────
{
  const { zotLook: Q, zotLookSheet: S } = loadPlugin();
  Q.version = '9.9.9';
  const before = Q._tag();
  ok(/^9\.9\.9\+[0-9a-f]{8}$/.test(before), 'the tag is the version and a fingerprint of the sheet module');
  const css = S.SEARCH_CSS; S.SEARCH_CSS = css + '\n/* changed */';
  ok(Q._tag() !== before, 'a change to what a sheet carries changes the tag, so a kept sheet is remade');
  S.SEARCH_CSS = css;
  eq(Q._tag(), before, 'and the same code gives the same tag');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
