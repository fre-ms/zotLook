// The one store behind everything zotLook derives from an attachment.
//
// There used to be three answers to the same two questions — is this file
// still right, and when does it go away. The contact sheet answered on disk;
// the EPUB preview and the annotated PDF copy answered in a Map, which a
// restart forgets, so the work came back on the first press of every session.
//
// What is checked here is the store itself and the two policies on top of it:
// what is kept across a restart, and what is deliberately not.
import { loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

/** An in-memory file tree shared between "sessions", so a restart is just a
 *  second plugin loaded over the same files. */
function makeDisk() {
  const files = new Map();   // path -> {text, size, lastModified}
  let clock = 1000;
  const isDir = (p) => [...files.keys()].some(k => k.startsWith(p + '/'));
  return {
    files,
    tick: () => { clock += 1000; },
    IOUtils: {
      makeDirectory: async () => {},
      writeUTF8: async (p, text) => {
        files.set(p, { text, size: text.length, lastModified: (clock += 1) });
      },
      readUTF8: async (p) => {
        if (!files.has(p)) throw new Error('no such file: ' + p);
        return files.get(p).text;
      },
      write: async (p, data) => {
        files.set(p, { size: data.length, lastModified: (clock += 1) });
      },
      exists: async (p) => files.has(p) || isDir(p),
      stat: async (p) => {
        if (files.has(p)) return { type: 'regular', ...files.get(p) };
        if (isDir(p)) return { type: 'directory', size: 0 };
        throw new Error('no such file: ' + p);
      },
      getChildren: async (dir) => {
        const prefix = dir.endsWith('/') ? dir : dir + '/';
        const out = new Set();
        for (const p of files.keys()) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          const cut = rest.indexOf('/');
          out.add(prefix + (cut === -1 ? rest : rest.slice(0, cut)));
        }
        if (!out.size) throw new Error('no such directory: ' + dir);
        return [...out];
      },
      remove: async (p, opts = {}) => {
        if (files.delete(p)) return;
        let hit = false;
        for (const k of [...files.keys()]) {
          if (k.startsWith(p + '/')) { files.delete(k); hit = true; }
        }
        if (!hit && !opts.ignoreAbsent) throw new Error('no such file: ' + p);
      },
    },
  };
}

/** One "session": a plugin loaded over the given disk. */
function session(disk, prefValues = {}, source = { size: 10, mtime: 5 }) {
  const { zotLook: Q, zotLookEpub } = loadPlugin({ IOUtils: disk.IOUtils, prefValues });
  Q.version = '1.2.0';
  Q._getTempDirPath = () => '/tmp/zt';
  Q._derivedRoot = (keep) => (keep ? '/tmp/zt-cache' : '/tmp/zt');
  // The source file, as the store recognises it
  const realStat = disk.IOUtils.stat;
  Q._fileIdentity = async (p) =>
    p === '/lib/book.epub' ? source.size + '@' + source.mtime : null;
  void realStat;
  let conversions = 0;
  zotLookEpub.convert = async (path, env) => {
    conversions++;
    await disk.IOUtils.writeUTF8(env.outDir + '/preview.html', '<html>');
    return env.outDir + '/preview.html';
  };
  return { Q, conversions: () => conversions };
}

// ── an EPUB preview outlives the session ──────────────────────────────
// This is the change: unpacking and reassembling a book takes seconds, and
// until now every restart paid for it again.
{
  const disk = makeDisk();
  const first = session(disk);
  const out1 = await first.Q._normalizeForPreview('/lib/book.epub');
  ok(out1 && out1.endsWith('/preview.html'), 'the book is converted');
  ok(out1.includes('zt-cache'), 'into the kept area: ' + out1);
  eq(first.conversions(), 1, 'once');

  // A restart: nothing in memory carries over, only the files
  const second = session(disk);
  const out2 = await second.Q._normalizeForPreview('/lib/book.epub');
  eq(out2, out1, 'the next session is served the same page');
  eq(second.conversions(), 0, 'without converting the book again');
}
{
  // A changed book has to be converted afresh
  const disk = makeDisk();
  await session(disk, {}, { size: 10, mtime: 5 })
    .Q._normalizeForPreview('/lib/book.epub');
  const after = session(disk, {}, { size: 11, mtime: 9 });
  await after.Q._normalizeForPreview('/lib/book.epub');
  eq(after.conversions(), 1, 'a changed book is converted again');
}
{
  // And its leftovers must go: a spine that lost a chapter would otherwise
  // keep serving the file that is no longer in it
  const disk = makeDisk();
  await session(disk, {}, { size: 10, mtime: 5 })
    .Q._normalizeForPreview('/lib/book.epub');
  disk.files.set('/tmp/zt-cache/epub_book.epub/chapter9.xhtml',
                 { text: 'stale', size: 5, lastModified: 1 });
  await session(disk, {}, { size: 11, mtime: 9 })
    .Q._normalizeForPreview('/lib/book.epub');
  eq(disk.files.has('/tmp/zt-cache/epub_book.epub/chapter9.xhtml'), false,
     'the entry is cleared before it is filled again');
}
{
  // Switched off, nothing is kept and nothing is reused
  const disk = makeDisk();
  const prefs = { 'extensions.zotlook.keepPreviews': false };
  const first = session(disk, prefs);
  const out = await first.Q._normalizeForPreview('/lib/book.epub');
  ok(!out.includes('zt-cache'),
     'the page is built where the startup clearing reaches it: ' + out);
  const second = session(disk, prefs);
  await second.Q._normalizeForPreview('/lib/book.epub');
  eq(second.conversions(), 1, 'and it is converted again every session');
  eq([...disk.files.keys()].filter(p => p.endsWith('.key')).length, 0,
     'no key is written for something that is not kept');
}

// ── a changed annotation makes the preview again ──────────────────────
// The page carries the annotations now, so the book being unchanged is no
// longer enough to reuse it.
{
  const annotated = (modified) => ({
    getAnnotations: () => [{
      annotationType: 'highlight', annotationText: 'x', annotationComment: '',
      annotationColor: '#ffd400', annotationSortIndex: '1',
      annotationIsExternal: false, dateModified: modified,
    }],
  });

  const disk = makeDisk();
  const first = session(disk);
  await first.Q._normalizeForPreview('/lib/book.epub', annotated('2026-01-01'));
  eq(first.conversions(), 1, 'converted once');

  const same = session(disk);
  await same.Q._normalizeForPreview('/lib/book.epub', annotated('2026-01-01'));
  eq(same.conversions(), 0, 'unchanged annotations reuse the page');

  const changed = session(disk);
  await changed.Q._normalizeForPreview('/lib/book.epub', annotated('2026-02-02'));
  eq(changed.conversions(), 1, 'a changed one makes it again');
}
{
  // And what is read is handed on: without this the conversion would have
  // nothing to place
  const disk = makeDisk();
  const { Q, zotLookEpub } = (() => {
    const made = session(disk);
    return { Q: made.Q, zotLookEpub: null };
  })();
  let handed = null;
  Q._epubEnv = (dir) => ({ outDir: dir });
  const original = Q._epubAnnotations.bind(Q);
  void original; void zotLookEpub; void handed;
  const marks = Q._epubAnnotations({
    getAnnotations: () => [
      { annotationType: 'underline', annotationText: 'so steht es da',
        annotationComment: 'dazu', annotationColor: '#a28ae5',
        annotationSortIndex: '00007', annotationIsExternal: false,
        annotationPosition: '{"value":"epubcfi(/6/2!/4/4,/1:0,/1:14)"}' },
      { annotationType: 'highlight', annotationText: 'aus der Datei',
        annotationIsExternal: true },
    ],
  });
  eq(marks.length, 1, 'an annotation already in the file is left to the file');
  eq(marks[0], { type: 'underline', text: 'so steht es da', comment: 'dazu',
                 color: '#a28ae5', sortIndex: '00007',
                 position: '{"value":"epubcfi(/6/2!/4/4,/1:0,/1:14)"}' },
     'and the rest is handed on — the position above all, which is what says '
     + 'where it belongs');
}

// ── what an earlier build made is not handed back ─────────────────────
// The key began with the version, which tells one release from another but
// not one build of a release from the next. Two builds of 1.2.0 looked alike
// to it, so a preview made by the first was served by the second and the
// change appeared not to have arrived — measured on a real installation,
// where the kept page had no trace of a stylesheet written hours earlier.
{
  const disk = makeDisk();

  const first = session(disk);
  first.Q._buildTag = '1.2.0+A';
  await first.Q._normalizeForPreview('/lib/book.epub');
  eq(first.conversions(), 1, 'the first build makes the page');

  const same = session(disk);
  same.Q._buildTag = '1.2.0+A';
  await same.Q._normalizeForPreview('/lib/book.epub');
  eq(same.conversions(), 0, 'the same build reuses it');

  const rebuilt = session(disk);
  rebuilt.Q._buildTag = '1.2.0+B';
  await rebuilt.Q._normalizeForPreview('/lib/book.epub');
  eq(rebuilt.conversions(), 1, 'another build of the same version makes it again');
}
{
  // A source tree carries no stamp, and must go on working
  const disk = makeDisk();
  const { Q } = session(disk);
  Q._buildTag = null;
  eq(Q._tag(), '1.2.0', 'without a stamp the version alone is the tag');
}

// ── and it does not lie about until it ages out ───────────────────────
{
  const disk = makeDisk();
  const { Q } = session(disk);
  Q._buildTag = '1.2.0+B';

  // An entry from an earlier build, an entry from this one, and the layout
  // of 1.1.9: files side by side rather than a directory, which nothing here
  // reads any more and nothing would ever remove
  disk.files.set('/tmp/zt-cache/epub_old/.key', { text: '1.2.0+A|x', size: 9, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/epub_old/preview.html', { text: 'h', size: 1, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/epub_new/.key', { text: '1.2.0+B|x', size: 9, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/epub_new/preview.html', { text: 'h', size: 1, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/contactsheet_alt.key', { text: '1.1.9|x', size: 7, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/contactsheet_alt.html', { text: 'h', size: 1, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/contactsheet_alt_pages/p1.jpg', { text: 'j', size: 1, lastModified: 1 });

  const result = await Q._dropStaleEntries();
  ok(result.count >= 3, `${result.count} things removed`);
  eq(disk.files.has('/tmp/zt-cache/epub_new/preview.html'), true,
     'what this build made stays');
  eq(disk.files.has('/tmp/zt-cache/epub_old/preview.html'), false,
     'what an earlier build made goes');
  eq(disk.files.has('/tmp/zt-cache/contactsheet_alt.html'), false,
     'and so does the loose layout of an earlier version');
  eq(disk.files.has('/tmp/zt-cache/contactsheet_alt_pages/p1.jpg'), false,
     'its thumbnails with it, which nothing else would ever have reached');
}
{
  // A directory with no key was never finished; nothing will finish it
  const disk = makeDisk();
  const { Q } = session(disk);
  Q._buildTag = '1.2.0+B';
  disk.files.set('/tmp/zt-cache/epub_half/preview.html', { text: 'h', size: 1, lastModified: 1 });
  await Q._dropStaleEntries();
  eq(disk.files.has('/tmp/zt-cache/epub_half/preview.html'), false,
     'a half-made entry is cleared rather than left for ever');
}

// ── the two formats are switched separately ───────────────────────────
// One switch used to govern both, under a heading that said PDF. The work
// behind them is not the same: a PDF is exported anew with the marks drawn
// in, which costs a copy of the document, while an EPUB preview is being
// assembled anyway and marking it costs nothing worth naming.
{
  const item = {
    getAnnotations: () => [{
      annotationType: 'highlight', annotationText: 'x', annotationColor: '#ffd400',
      annotationSortIndex: '1', annotationIsExternal: false,
      annotationPosition: '{"value":"epubcfi(/6/2!/4/4,/1:0,/1:1)"}',
    }],
  };
  const disk = makeDisk();
  const on = session(disk);
  eq(on.Q._epubAnnotations(item).length, 1, 'on by default');

  const off = session(disk, { 'extensions.zotlook.epubAnnotations': false });
  eq(off.Q._epubAnnotations(item).length, 0, 'and its own switch turns it off');

  const pdfOff = session(disk, { 'extensions.zotlook.previewAnnotations': false });
  eq(pdfOff.Q._epubAnnotations(item).length, 1,
     'while turning the PDF one off leaves the EPUB alone');
}
{
  // A preview made with the switch on is not the answer once it is off
  const disk = makeDisk();
  const item = { getAnnotations: () => [] };
  const first = session(disk);
  await first.Q._normalizeForPreview('/lib/book.epub', item);
  const off = session(disk, { 'extensions.zotlook.epubAnnotations': false });
  await off.Q._normalizeForPreview('/lib/book.epub', item);
  eq(off.conversions(), 1, 'so the page is made again when the switch changes');
}
{
  // Splitting a switch must not reverse a decision already made: someone who
  // had turned the old one off meant both formats
  const seen = new Map();
  const userSet = new Set(['extensions.zotlook.previewAnnotations']);
  const { zotLook: Q } = loadPlugin({
    zotero: {
      Prefs: {
        get: (n) => (n === 'extensions.zotlook.previewAnnotations' ? false : undefined),
        set: (n, v) => seen.set(n, v),
        rootBranch: { prefHasUserValue: (n) => userSet.has(n) },
      },
    },
  });
  Q._carryOverRenamedPrefs();
  eq(seen.get('extensions.zotlook.epubAnnotations'), false,
     'the EPUB half inherits the answer that was given for both');
}

// ── the clearing covers an EPUB as it covers a sheet ──────────────────
// It has to, and it does so without being told: an entry is a directory with
// a key, whatever is inside it.
{
  const disk = makeDisk();
  const first = session(disk);
  await first.Q._normalizeForPreview('/lib/book.epub');
  disk.files.set('/tmp/zt-cache/contactsheet_x.pdf/.key',
                 { text: 'k', size: 1, lastModified: 1 });
  disk.files.set('/tmp/zt-cache/contactsheet_x.pdf/contactsheet_x.pdf.html',
                 { text: 'h', size: 500, lastModified: 1 });

  const entries = await first.Q._keptEntries();
  eq(entries.length, 2, 'both kinds are kept entries');
  ok((await first.Q._keptSize()) > 0, 'and both count towards the figure');

  const result = await first.Q._purgeKept();
  eq(result.count, 2, 'the purge takes the EPUB as well as the sheet');
  eq([...disk.files.keys()].filter(p => p.startsWith('/tmp/zt-cache/')).length, 0,
     'and leaves nothing of either behind');
}
{
  // Age-based, same story
  const disk = makeDisk();
  const { Q } = session(disk, { 'extensions.zotlook.previewKeepDays': 30 });
  await Q._normalizeForPreview('/lib/book.epub');
  const realNow = Date.now;
  Date.now = () => 1e12;   // long after the key was written
  const result = await Q._expireKept();
  Date.now = realNow;
  eq(result.count, 1, 'an unused EPUB preview is aged out like a sheet');
}

// ── the annotated copy is on the same store and deliberately not kept ──
// It is a whole copy of the PDF: the largest thing here for the smallest
// saving, since an export takes a moment where a sheet takes seconds.
{
  const disk = makeDisk();
  let exports = 0;
  const { zotLook: Q } = loadPlugin({
    IOUtils: disk.IOUtils,
    zotero: {
      PDFWorker: {
        export: async (id, out) => {
          exports++;
          await disk.IOUtils.writeUTF8(out, '%PDF');
        },
      },
    },
  });
  Q.version = '1.2.0';
  Q._getTempDirPath = () => '/tmp/zt';
  Q._derivedRoot = (keep) => (keep ? '/tmp/zt-cache' : '/tmp/zt');
  Q._isPDFAttachment = () => true;
  Q._annotationSignature = () => 'sig-1';
  const attachment = { id: 7, key: 'ABCD1234' };

  const out = await Q._annotatedCopy(attachment);
  ok(out && out.includes('/tmp/zt/'), 'exported into the working directory');
  ok(!out.includes('zt-cache'), 'not into the kept area: ' + out);
  eq(exports, 1, 'exported once');

  eq(await Q._annotatedCopy(attachment), out, 'the same copy comes back');
  eq(exports, 1, 'without exporting again within the session');

  Q._annotationSignature = () => 'sig-2';
  await Q._annotatedCopy(attachment);
  eq(exports, 2, 'a changed annotation exports afresh');

  eq((await Q._keptEntries()).length, 0,
     'and none of it is a kept entry, so the purge never sees it');
}

// ── settings carried across the rename ────────────────────────────────
// The old names spoke of the contact sheet while governing the EPUB preview
// too. Renaming them without this would have reset both for everyone who had
// ever changed them.
{
  const seen = new Map();
  const userSet = new Set(['extensions.zotlook.cacheContactSheet',
                           'extensions.zotlook.contactSheetKeepDays']);
  const { zotLook: Q } = loadPlugin({
    prefValues: {
      'extensions.zotlook.cacheContactSheet': false,
      'extensions.zotlook.contactSheetKeepDays': 7,
    },
    zotero: {
      Prefs: {
        get: (n) => ({
          'extensions.zotlook.cacheContactSheet': false,
          'extensions.zotlook.contactSheetKeepDays': 7,
        })[n],
        set: (n, v) => seen.set(n, v),
        rootBranch: { prefHasUserValue: (n) => userSet.has(n) },
      },
    },
  });
  Q._carryOverRenamedPrefs();
  eq(seen.get('extensions.zotlook.keepPreviews'), false,
     'a setting the user had turned off stays off under the new name');
  eq(seen.get('extensions.zotlook.previewKeepDays'), 7,
     'and a chosen number of days comes across');
}
{
  // Untouched settings are left alone: copying a default across would pin it,
  // so a later change of the default would not reach the user
  const seen = new Map();
  const { zotLook: Q } = loadPlugin({
    zotero: {
      Prefs: {
        get: () => true,
        set: (n, v) => seen.set(n, v),
        rootBranch: { prefHasUserValue: () => false },
      },
    },
  });
  Q._carryOverRenamedPrefs();
  eq(seen.size, 0, 'nothing is written for settings the user never touched');
}
{
  // A new name already chosen wins over the old one
  const seen = new Map();
  const { zotLook: Q } = loadPlugin({
    zotero: {
      Prefs: {
        get: () => 3,
        set: (n, v) => seen.set(n, v),
        rootBranch: { prefHasUserValue: () => true },
      },
    },
  });
  Q._carryOverRenamedPrefs();
  eq(seen.size, 0, 'a setting already made under the new name is not overwritten');
}

// ── an entry with read-only files in it can still be dropped ──────────
// Zotero's zip reader keeps the archive's permission bits, and EPUB assets
// are commonly stored read-only; on Windows IOUtils.remove then fails with
// "directory not empty" and the entry stays for good, its key already gone.
{
  const files = new Map([
    ['/c/entry/.key', { ro: false }],
    ['/c/entry/preview.html', { ro: false }],
    ['/c/entry/asset/cover.jpg', { ro: true }],
    ['/c/entry/asset/deep/font.ttf', { ro: true }],
  ]);
  const under = (dir) => [...files.keys()].filter(k => k.startsWith(dir + '/'));
  const permissions = [];
  const IOUtils = {
    remove: async (p, opts = {}) => {
      if (files.delete(p)) return;
      const inside = under(p);
      if (!inside.length) { if (!opts.ignoreAbsent) throw new Error('absent'); return; }
      if (inside.some(k => files.get(k).ro)) {
        throw new Error("Could not remove `" + p + "': the directory is not empty (NS_ERROR_FILE_DIR_NOT_EMPTY)");
      }
      for (const k of inside) files.delete(k);
    },
    getChildren: async (dir) => {
      const out = new Set();
      for (const k of under(dir)) {
        const rest = k.slice(dir.length + 1);
        const cut = rest.indexOf('/');
        out.add(dir + '/' + (cut === -1 ? rest : rest.slice(0, cut)));
      }
      return [...out];
    },
    stat: async (p) => files.has(p) ? { type: 'regular' } : { type: 'directory' },
    setPermissions: async (p, mode) => { permissions.push([p, mode]); files.get(p).ro = false; },
  };
  const { zotLook: Q, logs } = loadPlugin({ IOUtils });
  eq(await Q._dropEntry({ dir: '/c/entry', keyPath: '/c/entry/.key' }), true,
     'the entry goes even though half of it was read-only');
  eq(files.size, 0, 'and nothing of it is left behind');
  const touched = permissions.map(([p]) => p);
  ok(touched.includes('/c/entry/asset/cover.jpg') && touched.includes('/c/entry/asset/deep/font.ttf'),
     'the read-only files had their write bit put back, however deep they sat');
  ok(permissions.every(([, mode]) => mode === 0o666), 'as plain writable files');
  ok(!logs.some(l => /Could not remove/.test(l)), 'with nothing to complain about');
}

// ── where the kept store lives ────────────────────────────────────────
// Zotero deletes its whole temp directory at every shutdown — an
// AsyncShutdown blocker registered inside getTempDirectory — so a kept
// store under it was wiped at every restart, on every platform. First
// noticed on Windows as a size display that never left 0 B. The store
// therefore builds on the local profile directory, and goes back to temp
// only when there is none to build on.
{
  const { zotLook: Q } = loadPlugin({
    Services: { dirsvc: { get: (key) => {
      if (key !== 'ProfLD') throw new Error('unexpected dirsvc key ' + key);
      return { path: '/home/u/.cache/zotero/profile' };
    } } },
    Components: { interfaces: { nsIFile: {} } },
  });
  eq(Q._derivedRoot(true), '/home/u/.cache/zotero/profile/zotLook-cache',
     'the kept store builds on the local profile directory');
  ok(!Q._derivedRoot(true).startsWith(Q._getTempDirPath()),
     'nowhere under the temp directory Zotero deletes at shutdown');
  eq(Q._derivedRoot(false), Q._getTempDirPath(),
     'while the working directory stays in temp, where a session file belongs');
}
{
  const { zotLook: Q, logs } = loadPlugin({});
  eq(Q._derivedRoot(true), '/tmp/zt/zotLook-cache',
     'without a profile directory the store still works, back in temp');
  ok(logs.some(l => /will not survive a restart/.test(l)),
     'and says out loud what that fallback costs');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
