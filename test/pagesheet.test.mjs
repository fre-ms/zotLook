// The page overview of an EPUB.
//
// A reflowable book has no pages — that is the format, and it is why a
// contact sheet of one looked impossible. But a book published beside a print
// edition carries the print edition's pagination anyway: EPUB 3 marks it in
// the text with epub:type="pagebreak" and lists it in a page-list navigation,
// EPUB 2 in the NCX's pageList. A sample of 120 books from the library this
// was written for found it in about one in eight, and those were the academic
// ones — which are exactly the books a reader wants to leaf through.
//
// So the sheet cuts the book at those marks. What that costs is the awkward
// part these tests are mostly about: a page boundary rarely falls between two
// paragraphs. It falls inside one, and the half after it belongs to the next
// page and needs its own <p> around it.
import fs from 'node:fs';
import os from 'node:os';
import { openZip, openBook, extractEntry, plugin, makeBook } from './book.mjs';

const { zotLookEpub: E, zotLookUtil: U, zotLookCfi: C } = plugin;

let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      got:  ${JSON.stringify(g)}\n      want: ${JSON.stringify(w)}`)); };
const ok = (c, l) => eq(!!c, true, l);

const TMP = fs.mkdtempSync(os.tmpdir() + '/zotlook-sheet-');
let seq = 0;

const ITEM = 'zotero://open-pdf/library/items/ABCD1234';
const sheetEnv = (extra = {}) => ({
  outDir: fs.mkdtempSync(TMP + '/out-'),
  openZip, openBook, extractEntry,
  mode: 'sheet',
  readerLink: ITEM,
  ...extra,
});

/** Builds a book, converts it in sheet mode, and parses what came out. */
async function sheetOf(opts, env = sheetEnv()) {
  const epub = makeBook(TMP + '/book' + (++seq), opts);
  const out = await E.convert(epub, env);
  if (!out) return { out: null, doc: null, epub };
  const doc = U.parseStrict(fs.readFileSync(out, 'utf8'), 'text/html');
  return { out, doc, epub };
}

const tiles = (doc) => [...doc.querySelectorAll('div.epub-page')];
const labelOf = (tile) =>
  tile.querySelector('div.epub-page-label').textContent;
const textOf = (tile) =>
  tile.querySelector('div.epub-paper-inner').textContent.replace(/\s+/g, ' ').trim();
const linkOf = (tile) => {
  const a = tile.querySelector('a');
  return a ? a.getAttribute('href') : null;
};

const mark = (id, n) =>
  `<span epub:type="pagebreak" role="doc-pagebreak" id="${id}" title="${n}"/>`;

// A page opens at its mark and runs to the next one — across paragraphs, and
// across the chapter boundary, because print pages do not stop at chapters.
const PAGED = [
  `<h1>Vorspann</h1>${mark('PB1', '1')}`
  + '<p>Anfang von Seite eins.</p>'
  + `<p>Ein Absatz, der${mark('PB2', '2')} mitten drin umbricht.</p>`
  + '<p>Rest von Seite zwei.</p>',
  '<p>Fortsetzung von Seite zwei im zweiten Kapitel.</p>'
  + `${mark('PB3', '3')}<p>Seite drei.</p>`,
];

// ── the sheet itself ──────────────────────────────────────────────────
{
  const { out, doc } = await sheetOf({ chapters: PAGED });
  ok(out && /sheet\.html$/.test(out), 'the sheet is written beside the book');

  const found = tiles(doc);
  eq(found.map(labelOf), ['Before page one', '1', '2', '3'],
     'one tile per printed page, plus what comes before the first mark');

  eq(textOf(found[0]), 'Vorspann',
     'the front matter keeps its own tile rather than being dropped');
  eq(textOf(found[1]), 'Anfang von Seite eins.Ein Absatz, der',
     'a page holds everything from its mark to the next, mid-paragraph and all');
  eq(textOf(found[2]),
     'mitten drin umbricht.Rest von Seite zwei.'
     + 'Fortsetzung von Seite zwei im zweiten Kapitel.',
     'and carries on over the chapter boundary, as a printed page does');
  eq(textOf(found[3]), 'Seite drei.', 'the last page runs to the end of the book');
}
{
  // The half-paragraph is the whole difficulty: cutting the text out is easy,
  // cutting it out *with the elements it sat in* is what keeps the tile a
  // page rather than a heap of words.
  const { doc } = await sheetOf({ chapters: PAGED });
  const [, one, two] = tiles(doc);
  const tail = [...one.querySelectorAll('p')].map(p => p.textContent.trim());
  eq(tail, ['Anfang von Seite eins.', 'Ein Absatz, der'],
     'the first half of the split paragraph is a paragraph of its own');
  const head = [...two.querySelectorAll('p')].map(p => p.textContent.trim());
  eq(head[0], 'mitten drin umbricht.', 'and so is the second');
  ok(!two.querySelector('h1'), 'nothing of the previous page comes with it');
  eq(doc.querySelectorAll('div.epub-page [role="doc-pagebreak"]').length, 0,
     'and the marker spans themselves are gone: they were never content');
}
{
  // Nesting: a mark inside a list item inside a list. Everything above the
  // mark has to be rebuilt in the next tile, or the second half of the list
  // arrives without its <ul> and without its <li>.
  const { doc } = await sheetOf({ chapters: [
    `${mark('PA', '10')}<ul><li>Erstens</li><li>Zwei${mark('PB', '11')}einhalb</li>`
    + '<li>Drittens</li></ul>',
  ] });
  const found = tiles(doc);
  eq(found.map(labelOf), ['10', '11'], 'two pages');
  eq(found[1].querySelector('ul li').textContent.trim(), 'einhalb',
     'the tail of the cut item is back inside a <li> inside a <ul>');
  eq([...found[1].querySelectorAll('li')].map(l => l.textContent.trim()),
     ['einhalb', 'Drittens'], 'and the rest of the list follows it there');
  eq([...found[0].querySelectorAll('li')].map(l => l.textContent.trim()),
     ['Erstens', 'Zwei'], 'while the first page keeps what came before');
}

// ── the way back into the book ────────────────────────────────────────
// The point of a page overview is to be able to jump to the page. Zotero's
// reader takes a CFI on zotero://open-pdf, so each tile is a link carrying
// the CFI of its own mark — which is worth checking by reading it back.
{
  const { doc, epub } = await sheetOf({ chapters: PAGED });
  const found = tiles(doc);
  eq(linkOf(found[0]), null, 'the front matter has no page to jump to');
  ok(linkOf(found[1]).startsWith(ITEM + '?cfi=epubcfi('),
     'a numbered page links into the reader: ' + linkOf(found[1]));

  const cfi = decodeURIComponent(linkOf(found[2]).split('?cfi=')[1]);
  const parsed = C.parse(cfi);
  eq(C.spineIndex(parsed), 0, 'page two begins in the first chapter');
  ok(parsed.start && parsed.end,
     'and is written as a range, which is the only form the reader follows: '
     + cfi);

  // Against the book's own first chapter, untouched by the conversion
  const book = openBook(epub);
  const sections = [];
  for await (const s of book.getSectionDocuments()) sections.push(s);
  book.close();
  const landed = C.resolve(sections[0].doc, parsed);
  ok(landed, 'the CFI resolves in the book as the reader will open it');
  eq(landed.endNode.data, ' mitten drin umbricht.',
     'ending in the first text the page contains');
  eq(landed.endOffset, 1,
     'over its first character, so the range has something to scroll to');
  eq(landed.startNode.nodeType, 1,
     'and anchored at the page mark itself, where the book\'s page-list points, '
     + 'so the reader reads this page rather than the one the mark ends');

  const third = C.parse(decodeURIComponent(linkOf(found[3]).split('?cfi=')[1]));
  eq(C.spineIndex(third), 1, 'page three begins in the second');
  eq(C.resolve(sections[1].doc, third).endNode.data, 'Seite drei.',
     'ending in the text that follows its own mark');
}
{
  // The spine step must be the itemref's own position, not the position of
  // the document among those that could be read. Zotero's reader indexes its
  // sections by the former; getSectionDocuments() skips the unreadable ones
  // and so counts by the latter. One missing file between them and every link
  // afterwards lands a chapter early.
  const dir = TMP + '/gap' + (++seq);
  const epub = makeBook(dir, { chapters: [
    '<p>Erstes Kapitel.</p>',
    `${mark('PB9', '9')}<p>Neun.</p>`,
  ] });
  // Re-pack with a spine that names a document the archive does not hold,
  // between the two that it does
  const fs2 = fs;
  const opf = dir + '/OEBPS/content.opf';
  fs2.writeFileSync(opf, fs2.readFileSync(opf, 'utf8')
    .replace('<manifest>',
      '<manifest><item id="gone" href="gone.xhtml" media-type="application/xhtml+xml"/>')
    .replace('<itemref idref="c2"/>', '<itemref idref="gone"/><itemref idref="c2"/>'));
  fs2.rmSync(epub);
  const { execFileSync } = await import('node:child_process');
  execFileSync('zip', ['-qr', epub, '.'], { cwd: dir });

  const env = sheetEnv();
  const out = await E.convert(epub, env);
  const doc = U.parseStrict(fs2.readFileSync(out, 'utf8'), 'text/html');
  const cfi = C.parse(decodeURIComponent(
    linkOf(tiles(doc)[1]).split('?cfi=')[1]));
  eq(C.spineIndex(cfi), 2,
     'the third itemref, though the chapter is the second document read');
}
{
  // Without somewhere to link to, the tiles are still worth showing
  const { doc } = await sheetOf({ chapters: PAGED }, sheetEnv({ readerLink: null }));
  eq(tiles(doc).map(linkOf), [null, null, null, null],
     'no reader link, no anchors — and no href="null" either');
  eq(tiles(doc).map(labelOf), ['Before page one', '1', '2', '3'], 'but the pages are all there');
}

// ── what was marked in the book is marked on the sheet ────────────────
// The same reason the PDF sheet renders the annotated copy rather than the
// stored file: on a sheet of every page, the marked-up ones are what the
// reader is scanning for.
{
  // "Rest von Seite zwei." sits on page two: /4 is the body, /10 the fifth
  // of its element children — h1, the first marker span, two paragraphs,
  // then this one — and /1 the text inside it
  const annotation = {
    type: 'highlight',
    color: '#ffd400',
    text: 'Rest',
    position: JSON.stringify({ value: 'epubcfi(/6/2!/4/10,/1:0,/1:4)' }),
  };
  const { doc } = await sheetOf({ chapters: PAGED },
                                sheetEnv({ annotations: [annotation] }));
  const found = tiles(doc);
  const marked = found[2].querySelectorAll('span.zotlook-annotation');
  eq(marked.length, 1, 'the annotation is drawn on the page it falls on');
  eq(marked[0].textContent, 'Rest', 'over exactly the words it covers');
  ok(/ffd400/i.test(marked[0].getAttribute('style')),
     'in the colour Zotero stored: ' + marked[0].getAttribute('style'));
  eq(found[1].querySelectorAll('span.zotlook-annotation').length, 0,
     'and on no other page');
}

// ── the CFI describes the book, not this page ─────────────────────────
// A CFI is a path counted through siblings. Drawing an annotation wraps text
// in a <span> and sanitising drops a <script>, and either shifts every index
// after it — in the tree the tiles are cut from, not in the book the reader
// opens. So the marks have to be read and written down before any of that
// happens, or the links point at the wrong place in exactly the books that
// have been annotated.
{
  const chapters = [
    '<p>Ein Satz, der annotiert ist.</p>'
    + `<script>var x = 1;</script>${mark('PB7', '7')}<p>Seite sieben.</p>`,
  ];
  // Covers "Ein Satz" in the first paragraph, before the mark
  const annotation = {
    type: 'highlight', color: '#ffd400', text: 'Ein Satz',
    position: JSON.stringify({ value: 'epubcfi(/6/2!/4/2,/1:0,/1:8)' }),
  };
  const { doc, epub } = await sheetOf({ chapters },
                                      sheetEnv({ annotations: [annotation] }));
  const found = tiles(doc);
  eq(found.map(labelOf), ['Before page one', '7'], 'two pages');
  eq(found[0].querySelectorAll('span.zotlook-annotation').length, 1,
     'the annotation was drawn, so the tree the tiles came from did change');

  const cfi = C.parse(decodeURIComponent(linkOf(found[1]).split('?cfi=')[1]));
  const book = openBook(epub);
  const sections = [];
  for await (const s of book.getSectionDocuments()) sections.push(s);
  book.close();
  const landed = C.resolve(sections[0].doc, cfi);
  ok(landed, 'and the link still resolves in the untouched book');
  eq(landed.endNode.data, 'Seite sieben.',
     'ending in the text the page really begins with');
}

// ── the book's own links must not break the tile's ────────────────────
// A whole tile is one link into the reader, and an <a> inside an <a> is not
// something a browser keeps: the parser closes the outer one on meeting the
// inner, and the rest of the tile stops being clickable. Measured in Quick
// Look with a page whose CSS reveals the parsed tree. In one real 416-page
// book, 198 tiles carried cross-references — which is why some pages linked
// and others seemed not to.
{
  const { doc } = await sheetOf({ chapters: [
    `${mark('PB1', '1')}<p>Siehe <a href="ch2.xhtml#x">Kapitel 2</a> dazu.</p>`
    + `${mark('PB2', '2')}<p>Und <a href="http://example.org/">auswärts</a>.</p>`,
  ] });
  const found = tiles(doc);
  eq(found.map(labelOf), ['1', '2'], 'two pages');

  for (const [at, tile] of found.entries()) {
    const anchors = [...tile.querySelectorAll('a')];
    eq(anchors.length, 1, `page ${at + 1}: exactly one anchor in the tile`);
    ok(anchors[0].getAttribute('href').startsWith('zotero://'),
       'and it is the one into the reader');
    ok(anchors[0].querySelector('div.epub-paper'),
       'with the whole page inside it, not merely the part before a link');
  }
  eq(textOf(found[0]), 'Siehe Kapitel 2 dazu.',
     'the words of the link are still there to read');
  eq(textOf(found[1]), 'Und auswärts.', 'an outward link too');
}
{
  // A page-list may name an <a> as the place a page begins, so flattening
  // must carry the mark over to what replaced it rather than lose the page
  const nav = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" '
    + 'xmlns:epub="http://www.idpf.org/2007/ops"><body>'
    + '<nav epub:type="page-list"><ol>'
    + '<li><a href="ch1.xhtml#p40">40</a></li></ol></nav></body></html>';
  const { doc } = await sheetOf({ nav, chapters: [
    '<p>Vorher.</p><a id="p40" href="ch2.xhtml">Seite vierzig</a><p>Danach.</p>',
  ] });
  eq(tiles(doc).map(labelOf), ['Before page one', '40'],
     'the page whose mark was a link is still a page');
  eq(textOf(tiles(doc)[1]), 'Seite vierzigDanach.',
     'and opens with what that link said');
}

// ── books that only list their pages ──────────────────────────────────
// The marks in the text are what the split cuts at, so a book that lists its
// pages in the navigation but sets none in the text has to be met by looking
// the listed fragments up.
{
  const nav = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" '
    + 'xmlns:epub="http://www.idpf.org/2007/ops"><body>'
    + '<nav epub:type="page-list"><ol>'
    + '<li><a href="ch1.xhtml#h1">5</a></li>'
    + '<li><a href="ch1.xhtml#h2">6</a></li>'
    + '</ol></nav></body></html>';
  const { doc } = await sheetOf({
    nav,
    chapters: ['<h2 id="h1">Fünf</h2><p>Text.</p><h2 id="h2">Sechs</h2><p>Mehr.</p>'],
  });
  eq(tiles(doc).map(labelOf), ['5', '6'],
     'the page-list is resolved by id where the text carries no marks');
  eq(textOf(tiles(doc)[0]), 'FünfText.', 'and cuts at what it named');
}
{
  // EPUB 2 keeps the same information in the NCX
  const ncx = '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">'
    + '<pageList>'
    + '<pageTarget type="normal" value="5"><navLabel><text>5</text></navLabel>'
    + '<content src="ch1.xhtml#h1"/></pageTarget>'
    + '<pageTarget type="normal" value="6"><navLabel><text>6</text></navLabel>'
    + '<content src="ch1.xhtml#h2"/></pageTarget>'
    + '</pageList></ncx>';
  const { doc } = await sheetOf({
    ncx,
    chapters: ['<h2 id="h1">Fünf</h2><p>Text.</p><h2 id="h2">Sechs</h2><p>Mehr.</p>'],
  });
  eq(tiles(doc).map(labelOf), ['5', '6'], 'an NCX pageList is read too');
}
{
  // Both: the text wins, because a position is what the split needs and a
  // list of hrefs is not
  const nav = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" '
    + 'xmlns:epub="http://www.idpf.org/2007/ops"><body>'
    + '<nav epub:type="page-list"><ol>'
    + '<li><a href="ch1.xhtml#PB1">1</a></li></ol></nav></body></html>';
  const { doc } = await sheetOf({ nav, chapters: [
    `<p>vorn</p>${mark('PB1', '1')}<p>eins</p>${mark('PBx', '2')}<p>zwei</p>`,
  ] });
  eq(tiles(doc).map(labelOf), ['Before page one', '1', '2'],
     'a mark the navigation never listed is cut at all the same');
}

// ── books with no printed pages at all ────────────────────────────────
// Which is most of them. Nothing here can invent a pagination, and a sheet of
// arbitrary slices would be worse than none — so the sheet says so.
{
  const { out, doc } = await sheetOf({});
  ok(out, 'a book with no page marks still produces a sheet, not a failure');
  eq(tiles(doc).length, 0, 'with no tiles in it');
  const notice = doc.querySelector('div.epub-sheet-notice');
  ok(notice, 'and a notice instead');
  ok(/no printed page numbers/i.test(notice.textContent),
     'saying what is missing: ' + notice.textContent.trim().slice(0, 60));
  ok(/reflows/i.test(notice.textContent), 'and why it cannot be supplied');
  ok(notice.textContent.includes('A Book'), 'named for the book it is about');
}
{
  // The ordinary preview is untouched by any of this
  const epub = makeBook(TMP + '/plain' + (++seq), { chapters: PAGED });
  const out = await E.convert(epub, { ...sheetEnv(), mode: undefined });
  ok(out && /preview\.html$/.test(out), 'without the sheet mode it is a preview');
  const doc = U.parseStrict(fs.readFileSync(out, 'utf8'), 'text/html');
  eq(doc.querySelectorAll('div.epub-page').length, 0, 'with no tiles');
  ok(/Anfang von Seite eins/.test(doc.body.textContent),
     'and the whole book in one flow, as before');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
