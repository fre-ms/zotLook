import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  openZip, openBook, extractEntry, plugin, counts, makeBook,
} from './book.mjs';

const { zotLookEpub: E, zotLookUtil: U } = plugin;

let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      got:  ${JSON.stringify(g)}\n      want: ${JSON.stringify(w)}`)); };
const ok = (c, l) => eq(!!c, true, l);

const TMP = fs.mkdtempSync(os.tmpdir() + '/zotlook-epub-');
const BOOK = fileURLToPath(new URL('./fixtures/book.epub', import.meta.url));
const env = { outDir: TMP, openZip, openBook, extractEntry };

// ── the table of contents ─────────────────────────────────────────────
// The one thing a bundled EPUB viewer offers that this conversion did not.
// Both navigation formats are read, because a library holds both: EPUB 3
// keeps it in a navigation document, EPUB 2 in an NCX the spine points at.
// Their own extract directory: the reuse test further down counts what is
// unpacked under TMP, and these books would be counted with it.
const TOC_TMP = fs.mkdtempSync(os.tmpdir() + '/zotlook-toc-');
const tocEnv = { outDir: TOC_TMP, openZip, openBook };


{
  // EPUB 3, with a nested entry and one pointing at an id inside a chapter
  const dir = TMP + '/nav3';
  const epub = makeBook(dir, { nav:
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" '
    + 'xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc">'
    + '<ol><li><a href="ch1.xhtml">First chapter</a>'
    + '<ol><li><a href="ch1.xhtml#intro">Introduction</a></li></ol></li>'
    + '<li><a href="ch2.xhtml">Second chapter</a></li></ol></nav></body></html>' });
  const out = await E.convert(epub, tocEnv);
  ok(out, 'a book with a navigation document converts');
  const html = fs.readFileSync(out, 'utf8');

  ok(html.includes('<details') && html.includes('zl-toc'),
     'the contents are a details block, which folds without JavaScript');
  ok(/<summary[^>]*>Contents</.test(html), 'under a heading');
  ok(html.includes('First chapter') && html.includes('Second chapter'),
     'carrying the titles the book gives, not ones derived from headings');
  ok(html.includes('zl-toc-level1'), 'and the nesting the book gives');

  ok(html.includes('href="#zotlook-ch0"') && html.includes('href="#zotlook-ch1"'),
     'each chapter is linked by an anchor placed for it');
  ok(html.includes('id="zotlook-ch0"'), 'and that anchor exists in the document');
  ok(html.includes('href="#intro"'),
     "a fragment is followed where the chapter really carries that id");
}
{
  // EPUB 2 keeps the same information in an NCX
  const dir = TMP + '/nav2';
  const epub = makeBook(dir, { ncx:
    '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" '
    + 'version="2005-1"><navMap>'
    + '<navPoint id="n1"><navLabel><text>Erstes Kapitel</text></navLabel>'
    + '<content src="ch1.xhtml"/></navPoint>'
    + '<navPoint id="n2"><navLabel><text>Zweites Kapitel</text></navLabel>'
    + '<content src="ch2.xhtml"/></navPoint>'
    + '</navMap></ncx>' });
  const html = fs.readFileSync(await E.convert(epub, tocEnv), 'utf8');
  ok(html.includes('Erstes Kapitel') && html.includes('Zweites Kapitel'),
     'an NCX is read as well, so older books get a contents too');
  ok(html.includes('href="#zotlook-ch0"'), 'with the same anchors');
}
{
  // A book with no navigation at all must look like a book, not like a
  // feature that failed
  const dir = TMP + '/nonav';
  const html = fs.readFileSync(await E.convert(makeBook(dir), tocEnv), 'utf8');
  ok(!html.includes('<details'),
     'no navigation, no empty contents box (the stylesheet is always there,'
     + ' so the element is what has to be looked for)');
  ok(html.includes('Body of chapter 1'), 'while the book itself still converts');
  ok(html.includes('id="zotlook-ch0"'),
     'the chapter anchors are placed regardless, costing nothing');
}

// ── nothing is spawned and nothing is spread on disk ──────────────────
// There used to be a per-platform extractor here — /usr/bin/unzip, and
// bsdtar on Windows, since unzip is not a Windows tool — with a subprocess,
// a timeout and a directory of loose files to clean up afterwards. The
// platform's own zip reader does the same work in-process, identically
// everywhere, which is why none of that is left.
{
  // Comments recall the old way on purpose; what matters is the code
  const source = fs.readFileSync(new URL('../addon/epub.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/runProcess|tar\.exe|bsdtar/.test(source),
     'the module names no external extractor');
  ok(!/extractDir/.test(source), 'and no extraction directory');
  for (const gone of ['_unpackCommand', '_unpack', '_readChapter', '_resolveSpine']) {
    eq(typeof E[gone], 'undefined', gone + ' is gone');
  }
}

const out = await E.convert(BOOK, env);
ok(out, 'convert returns a path');
const html = fs.readFileSync(out, 'utf8');

// ── structure
// Gecko's serialiser escapes & in text; the test double does not, so match either
ok(/<title>Über den Fluß (&amp;|&) ins Grüne<\/title>/.test(html), 'dc:title used, entity decoded');
ok(/Kapitel Eins/.test(html) && /Kapitel Zwei/.test(html), 'both spine chapters present');
ok(!/nope|Kapitel Drei/.test(html), 'manifest item not in the spine is skipped');
ok(/<hr class="epub-chapter-break">/.test(html), 'chapter separator inserted');
eq((html.match(/epub-chapter-break">/g) || []).length, 1, 'exactly one separator for two chapters');

// ── sanitising
ok(!/alert\('evil'\)/.test(html), 'chapter script removed');
ok(!/onclick/i.test(html), 'inline handler removed');
ok(!/javascript:/i.test(html), 'javascript: href removed');
ok(/böse/.test(html), 'link text survives href removal');

// ── assets are written out beside the page
// Not carried into it: base64 costs a third more and would have to be capped,
// and a preview that leaves out part of a book is not a preview of that book.
ok(/<img[^>]+src="asset\/OEBPS_img_pic%20one\.png"/.test(html),
   'image points at the copy beside the page, its name kept and encoded');
ok(/url\((&quot;|")asset\/OEBPS_img_bg\.png(&quot;|")\)/.test(html),
   'and so does a url() in a style attribute');
ok(!/data:image/.test(html), 'nothing is inlined');
ok(!/file:\/\//.test(html), 'and nothing is an absolute path, so the entry can move');
{
  const asset = TMP + '/asset/OEBPS_img_pic one.png';
  ok(fs.existsSync(asset), 'the file is really there');
  eq(fs.readFileSync(asset).length, 1, 'with the bytes from the archive');
}

// ── stylesheets
// Linked as text rather than as a link, for the same reason
eq((html.match(/rel="stylesheet"/g) || []).length, 0,
   'no stylesheet is left as a link');
ok(/Palatino/.test(html), "and the book's own rules are in the page");
eq((html.match(/font-variant: small-caps/g) || []).length, 1, 'identical inline style deduplicated');
ok(html.indexOf('Palatino') > html.indexOf('rel="stylesheet"'), 'base stylesheet comes after the book\'s own');

// ── XML self-closing must not leak into HTML
ok(!/<div\/>/.test(html), 'no self-closed div survives into the output');
ok(/<div><\/div>/.test(html), 'XHTML empty element stays empty, does not swallow siblings');
ok(/Mit Hintergrund/.test(html), 'content after an empty element survives');

// ── not answering the same question twice
// The module used to keep a Map of what it had converted. It does not any
// more: the host keeps one store for every derived file, so the answer
// survives a restart instead of only the session. What is left here is that
// converting twice lands in the same place, which is what lets the store
// recognise it.
const before = counts.opened;
const out2 = await E.convert(BOOK, env);
eq(out2, out, 'second convert returns the same file');
eq(counts.opened, before + 1, 'and does the work again, since nothing here remembers');
ok(!('_cache' in E), 'the module keeps no cache of its own any more');

// ── the host says where the page goes
{
  const given = TMP + '/given';
  fs.mkdirSync(given, { recursive: true });
  const out3 = await E.convert(BOOK, { ...env, outDir: given });
  eq(out3, given + '/preview.html', 'the page is written where it was told');
}

// ── the archive is let go of again
// An open handle keeps the file, which on Windows would stop Zotero from
// replacing an attachment the user re-downloads.
{
  let closes = 0;
  const counting = (archive) => {
    const zip = openZip(archive);
    return { ...zip, close() { closes++; zip.close(); } };
  };
  await E.convert(BOOK, { ...env, openZip: counting });
  eq(closes, 1, 'the zip is closed when the conversion is done');

  closes = 0;
  await E.convert(BOOK, {
    ...env, openZip: counting,
    openBook: () => ({ close() {}, async* getSectionDocuments() { throw new Error('bang'); } }),
  });
  eq(closes, 1, 'and closed just as surely when the spine throws');
}

// ── what lands on disk is the page and the assets it names
// Not the archive spread out: an epub carries files no chapter refers to, and
// those have no business in a preview directory.
{
  const clean = fs.mkdtempSync(os.tmpdir() + '/zotlook-out-');
  await E.convert(BOOK, { ...env, outDir: clean });
  eq(fs.readdirSync(clean).sort(), ['asset', 'preview.html'],
     'the page, and one directory beside it');
  eq(fs.readdirSync(clean + '/asset').sort(),
     ['OEBPS_img_bg.png', 'OEBPS_img_f.otf', 'OEBPS_img_pic one.png'],
     'holding exactly what the book refers to');
  fs.rmSync(clean, { recursive: true, force: true });
}

// ── annotations ───────────────────────────────────────────────────────
// A PDF gets them from Zotero: PDFWorker.export bakes them into a copy. For
// an epub there is no such export, so the CFI Zotero stored is resolved
// against the very document it was written against — the section document,
// before the page is assembled.
//
// The fixture's first chapter: <h1>, <p class="lead">, <img>, <div>,
// <p style>, <script>, <a>, <a>, <p>. Element four is the lead paragraph,
// so /4/4 is it and /1 its text. The spine is the third child of <package>,
// hence /6, and the first itemref is /2.
{
  const cfi = (value) => JSON.stringify({
    type: 'FragmentSelector',
    conformsTo: 'http://www.idpf.org/epub/linking/cfi/epub-cfi.html',
    value,
  });
  let lastPage = '';
  const withNotes = async (annotations, outName) => {
    const out = TMP + '/' + outName;
    fs.mkdirSync(out, { recursive: true });
    lastPage = fs.readFileSync(
      await E.convert(BOOK, { ...env, outDir: out, annotations }), 'utf8');
    // Only the body: the stylesheet names every one of these classes, so a
    // search over the whole file would find them whether anything was marked
    // or not. What is about the stylesheet asks lastPage instead.
    return lastPage.slice(lastPage.indexOf('<body'));
  };

  const html = await withNotes([
    { type: 'highlight', text: 'Erster Absatz.', color: '#ffd400',
      comment: 'wichtig', sortIndex: '00000|00000000',
      position: cfi('epubcfi(/6/2!/4/4,/1:0,/1:14)') },
    { type: 'underline', text: 'Mit Hintergrund.', color: '#a28ae5',
      comment: '', sortIndex: '00000|00000100',
      position: cfi('epubcfi(/6/2!/4/10,/1:0,/1:16)') },
  ], 'annot');

  // Drawn as Zotero draws it: its reader styles an annotation in flowing
  // text as backgroundColor: color + "80" for a highlight — half opacity,
  // the same alpha its PDF canvas fills with — and as a real underline in
  // the annotation's colour otherwise. A solid fill was what this did
  // before, which made a purple passage hard to read and looked unlike the
  // document it came from.
  ok(/<span [^>]*background-color: #ffd40080;[^>]*>Erster Absatz\.<\/span>/.test(html),
     'a highlight carries its colour at half opacity, exactly as Zotero does');
  ok(/<span [^>]*text-decoration: underline[^>]*>Mit Hintergrund\.</.test(html)
     && /text-decoration-color: #a28ae5/.test(html),
     "an underline is a real underline, in the annotation's colour");
  ok(/text-decoration-thickness: 2px; text-underline-offset: 2px/.test(html),
     "with the thickness and offset from the reader's own stylesheet");
  // The swatch in the list is filled in that colour too, so the question has
  // to be put to the marked passage itself
  {
    const mark = html.match(/<span [^>]*>Mit Hintergrund\./);
    ok(mark && !/background-color/.test(mark[0]),
       'and nothing is filled in behind the words');
  }
  ok(/<details class="zl-annotations">/.test(html), 'and both are listed');
  ok(/wichtig/.test(html), 'with the comment');
  ok(!/zl-annotation-unplaced/.test(html), 'nothing reported as unplaceable');

  // The list takes the reader to the passage: the marked place carries an
  // anchor, the entry points at it. Same mechanism as the contents, which is
  // measured to work in a panel that runs no scripts.
  ok(/<span [^>]*id="zotlook-annot0"[^>]*>Erster Absatz\.<\/span>/.test(html),
     'the first marked passage carries an anchor');
  ok(/<a [^>]*class="zl-annotation-goto"[^>]*>/.test(html)
     && /<a [^>]*href="#zotlook-annot0"[^>]*>/.test(html),
     'and its entry in the list offers a way there');
  ok(/id="zotlook-annot1"/.test(html) && /href="#zotlook-annot1"/.test(html),
     'the second likewise, by its own name');

  // Each entry folds: two lines of the passage on arrival, the rest and the
  // link to it on demand. A list of long passages that showed all of them
  // would be the book again rather than an index to it.
  ok(/<details class="zl-annotation-entry"><summary>/.test(html),
     'the entries fold');

  // The quotation in the list is marked as the passage is marked — which is
  // also what Zotero does in its own annotation list, the same span with the
  // same style. A swatch alone says which colour was used; this says what
  // was done with it, and that is what makes an entry recognisable.
  {
    const quoted = [...html.matchAll(/<q [^>]*style="([^"]*)"/g)].map(m => m[1]);
    eq(quoted.length, 2, 'both quotations carry a style of their own');
    ok(quoted.some(v => v.includes('background-color: #ffd40080')),
       'the highlighted one is highlighted, at the same half opacity');
    ok(quoted.some(v => v.includes('text-decoration-color: #a28ae5')),
       'and the underlined one underlined, in its own colour');
  }
  ok(/zl-annotation-entry:not\(\[open\]\) q \{[^}]*line-clamp: 2/s.test(lastPage),
     'closed, the quotation is cut to two lines');
  ok(/max-height: 3\.1em/.test(lastPage),
     'with a height to fall back on where the clamp is not understood');
  ok(!/<details class="zl-annotation-entry" open/.test(html),
     'and none of them starts open');

  // A flex summary drops the native disclosure marker, so one is drawn.
  // Without it the fold gives no sign that there is anything to unfold.
  ok(/details\.zl-annotation-entry > summary \{[^}]*display: flex/s.test(lastPage),
     'the summary is a row, so swatch and first line sit together');
  ok(/details\.zl-annotation-entry > summary::before \{[^}]*content:/s.test(lastPage),
     'and a marker is drawn, since flex takes the native one away');
  ok(/details\.zl-annotation-entry\[open\] > summary::before \{ content:/.test(lastPage),
     'which turns when it opens');

  {
    // A range across elements becomes several wrappers, and an id may occur
    // once in a document — so the anchor goes on the first piece alone.
    // Two of them would make the jump ambiguous and the markup invalid.
    const across = await withNotes([
      { type: 'highlight', text: '', color: '#ffd400', sortIndex: '00000|0',
        position: cfi('epubcfi(/6/2!/4,/2/1:7,/4/1:6)') },
    ], 'across');
    ok((across.match(/class="zotlook-annotation"/g) || []).length >= 2,
       'the range is marked in more than one piece');
    eq((across.match(/id="zotlook-annot0"/g) || []).length, 1,
       'and carries its anchor exactly once');
    ok(/id="zotlook-annot0"[^>]*>Eins</.test(across)
       || /id="zotlook-annot0"[^>]*>[^<]*Eins/.test(across),
       'on the piece the reader arrives at first');
  }
  {
    // Part of a paragraph, not the whole of it: the offsets are the point of
    // the format, and a search for the text could never express this
    const part = await withNotes([
      { type: 'highlight', text: 'Erster', color: '#ffd400',
        sortIndex: '00000|00000000',
        position: cfi('epubcfi(/6/2!/4/4,/1:0,/1:6)') },
    ], 'part');
    ok(/<span [^>]*>Erster<\/span> Absatz\./.test(part),
       'exactly the characters the offsets name');
  }
  {
    // The second chapter is a different spine item, and an annotation in it
    // must not be looked for in the first
    const second = await withNotes([
      { type: 'highlight', text: 'Ende.', color: '#5fb236',
        sortIndex: '00001|00000000',
        position: cfi('epubcfi(/6/4!/4/4,/1:0,/1:5)') },
    ], 'second');
    ok(/<span [^>]*>Ende\.<\/span>/.test(second),
       'an annotation in the second chapter is marked there');
    eq((second.match(/class="zotlook-annotation"/g) || []).length, 1,
       'and nowhere else');
  }
  {
    // A note has no position of its own, and a CFI can point at an element a
    // later edition no longer has
    const html2 = await withNotes([
      { type: 'note', text: '', comment: 'Ein Gedanke', color: '#5fb236',
        sortIndex: '00000|00000000', position: '' },
      { type: 'highlight', text: 'nicht mehr da', color: '#ffd400',
        sortIndex: '00000|00000100',
        position: cfi('epubcfi(/6/2!/4/98,/1:0,/1:5)') },
    ], 'unplaced');
    ok(/Ein Gedanke/.test(html2), 'a note without a position still appears');
    // Its own entry, not the neighbour's: the other annotation quotes text
    // and is folded, so a search over the whole list would prove nothing
    const noteEntry = html2.slice(html2.indexOf('Ein Gedanke') - 200,
                                  html2.indexOf('Ein Gedanke'));
    ok(!/<details/.test(noteEntry),
       'and is not folded: it quotes nothing, so there is nothing to unfold');
    ok(/zl-annotation-unplaced/.test(html2),
       'and a CFI that no longer resolves is marked as such rather than dropped');
    ok(!/<a href="#zotlook-annot/.test(html2),
       'what is nowhere in the page is not offered as a link to it');
    ok(!/class="zotlook-annotation"/.test(html2), 'nothing is marked wrongly');
  }
  {
    const bare = await withNotes(undefined, 'noannot');
    ok(!/zl-annotations|zotlook-annotation/.test(bare),
       'without annotations the page carries no trace of them');
  }
}

// ── the colour is taken as Zotero stores it ───────────────────────────
{
  const { zotLookEpub: E2 } = await import('./load.mjs').then(m => m.loadPlugin());
  eq(E2._annotationStyle({ type: 'highlight', color: '#5fb236' }),
     'background-color: #5fb23680;', 'a six-digit colour gains the alpha');
  eq(E2._annotationStyle({ type: 'highlight', color: '#fd0' }),
     'background-color: #ffdd0080;',
     'a three-digit one is expanded first, or the alpha would land inside it');
  eq(E2._annotationStyle({ type: 'highlight', color: '#5fb23640' }),
     'background-color: #5fb23640;',
     'and one that already carries an alpha keeps its own');
  eq(E2._annotationStyle({ type: 'highlight', color: 'rgb(1,2,3)' }),
     'background-color: rgb(1,2,3);',
     'an unfamiliar notation is used as given, without an alpha it cannot '
     + 'take — the wrong opacity is better than the wrong colour');
  eq(E2._annotationStyle({ type: 'highlight', color: '' }),
     'background-color: #ffd40080;',
     'and only nothing at all falls back to the yellow Zotero starts with');

  // Zotero's palette is eight colours; the field is a string, and plugins
  // put their own in it. These three are zotQDA's, read out of a real
  // library: 232 of 500 annotations there carry a colour Zotero never offers.
  for (const colour of ['#ef5350', '#32bd59', '#008c7c']) {
    eq(E2._annotationStyle({ type: 'highlight', color: colour }),
       'background-color: ' + colour + '80;',
       `${colour} from another palette is painted like any other`);
    ok(E2._annotationStyle({ type: 'underline', color: colour })
         .includes('text-decoration-color: ' + colour),
       `${colour} underlines in its own colour too`);
  }
  ok(/text-decoration-color: #ff6666/.test(
       E2._annotationStyle({ type: 'underline', color: '#ff6666' })),
     'an underline takes the colour undiluted, as the reader does');
}

// ── the contents start closed ─────────────────────────────────────────
// It was open when it stood above the book, where nothing was behind it. As
// a menu over the page, open on arrival means covering the first thing a
// reader looks at.
{
  // A book that has contents at all: the fixture carries no navigation
  const withNav = makeBook(TMP + '/hasnav', { nav:
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" '
    + 'xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc">'
    + '<ol><li><a href="ch1.xhtml">One</a></li>'
    + '<li><a href="ch2.xhtml">Two</a></li></ol></nav></body></html>' });
  const out = TMP + '/closed';
  fs.mkdirSync(out, { recursive: true });
  const page = fs.readFileSync(await E.convert(withNav, { ...env, outDir: out }), 'utf8');
  const body = page.slice(page.indexOf('<body'));
  ok(/<details class="zl-toc">/.test(body), 'the contents are there');
  ok(!/<details[^>]*\bopen\b[^>]*class="zl-toc"/.test(body)
     && !/<details class="zl-toc"[^>]*\bopen\b/.test(body),
     'and closed, so the book is what one sees first');
}

// ── the two menus float ───────────────────────────────────────────────
// A book wants the page to itself. The contents and the annotations are
// reachable from a button in the corner instead of sitting in a block above
// the text — and all of it is <details> and CSS, because a preview panel
// runs no scripts: a menu that needed one would never open.
{
  const out = TMP + '/floating';
  fs.mkdirSync(out, { recursive: true });
  const page = fs.readFileSync(await E.convert(BOOK, { ...env, outDir: out }), 'utf8');

  ok(!/<script/i.test(page), 'the page carries no script at all');
  ok(/details\.zl-toc > summary[^}]*position: fixed/s.test(page)
     || /details\.zl-toc > summary, details\.zl-annotations > summary \{[^}]*position: fixed/s.test(page),
     'the summaries are floated out of the flow');
  ok(/ol\.zl-toc-list, ol\.zl-annotation-list \{[^}]*position: fixed/s.test(page),
     'and the lists appear over the text rather than pushing it down');
  ok(/ol\.zl-toc-list \{ right/.test(page) && /ol\.zl-annotation-list \{ left/.test(page),
     'the two sit in opposite corners, so neither label\'s width crowds the other');

  // The triangle is hidden two ways: the three viewers are not one engine
  ok(/list-style: none/.test(page), 'the marker is hidden by the standard property');
  ok(/::-webkit-details-marker/.test(page), 'and by the WebKit one');

  ok(/@media \(max-width: 420px\)/.test(page),
     'a narrow panel gets the menus back in the flow, where they cover nothing');
  ok(!/inset: 0/.test(page), 'nothing dims the page behind an open menu');
}

// ── an asset the book keeps referring to is written once ──────────────
// A stylesheet's background, a chapter ornament: a book can name the same
// file on every page, and each of those must not be a copy.
{
  // A book whose two chapters carry the same picture — the fixture names
  // each of its files once, so it could never show this
  const shared = makeBook(TMP + '/shared', { sharedImage: true });
  let writes = 0;
  const counting = (zip, entry, destPath) => {
    writes++;
    return extractEntry(zip, entry, destPath);
  };
  const out = TMP + '/once';
  fs.mkdirSync(out, { recursive: true });
  const page = fs.readFileSync(
    await E.convert(shared, { ...env, outDir: out, extractEntry: counting }),
    'utf8');
  eq((page.match(/src="asset\/OEBPS_shared\.png"/g) || []).length, 2,
     'both chapters point at it');
  eq(writes, 1, 'and it was written out once');
  eq(fs.readdirSync(out + '/asset'), ['OEBPS_shared.png'], 'one file');
}

// ── however big the book, all of it ───────────────────────────────────
// There was a cap here once, on each asset and on the book as a whole. It
// existed only because the assets were being carried into the page; written
// out beside it there is nothing to cap, and a limit that silently dropped
// half a volume has no business in a preview.
{
  const source = fs.readFileSync(new URL('../addon/epub.js', import.meta.url), 'utf8');
  ok(!/MAX_ASSET_BYTES|MAX_TOTAL_ASSET_BYTES|budget/.test(source),
     'no size limit is left in the module');
  const huge = (archive) => {
    const zip = openZip(archive);
    return { ...zip, getEntry: () => ({ realSize: 900 * 1024 * 1024 }) };
  };
  const out = TMP + '/huge';
  fs.mkdirSync(out, { recursive: true });
  const big = fs.readFileSync(
    await E.convert(BOOK, { ...env, outDir: out, openZip: huge }), 'utf8');
  ok(/src="asset\//.test(big), 'a book claiming 900 MB assets is still written out whole');
  eq(fs.readdirSync(out + '/asset').length, 3,
     'every asset it refers to, none skipped');
}

// ── the cover, taken out for the collection sheet ─────────────────────
{
  const out = TMP + '/covers';
  fs.mkdirSync(out, { recursive: true });
  for (const [how, label] of [['epub3', 'marked cover-image in the manifest'],
                              ['epub2', 'named by id in a meta'],
                              ['href', 'named by file in a meta']]) {
    const dir = TMP + '/cover-' + how;
    fs.mkdirSync(out + '/' + how, { recursive: true });
    const name = await E.cover(makeBook(dir, { cover: how }), env, out + '/' + how);
    eq(name, 'cover.png', 'a cover ' + label + ' is found, and keeps its kind');
    eq(fs.readFileSync(out + '/' + how + '/cover.png', 'utf8'), 'PNG-bytes', 'and its bytes');
  }
  fs.mkdirSync(out + '/none', { recursive: true });
  eq(await E.cover(makeBook(TMP + '/cover-none'), env, out + '/none'), null,
     'a book without a cover gives null');
  eq(fs.readdirSync(out + '/none'), [], 'and writes nothing');
}

fs.rmSync(TMP, { recursive: true, force: true });

// ── the overview in the dark ──────────────────────────────────────────
{
  const { zotLookEpub: E } = await import('./load.mjs').then(m => m.loadPlugin());
  ok(E.SHEET_CSS.includes('@media (prefers-color-scheme: dark)'),
     'the page overview has a dark side, for a system that is dark');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
