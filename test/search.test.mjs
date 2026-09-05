// The search field of a sheet in its own window: a script, because a
// preview panel runs none, so the field is hidden until the script reveals
// it. The runtime is a plain function, run here against linkedom's DOM
// exactly as the page runs it against the browser's.
import { createRequire } from 'node:module';
import { loadPlugin } from './load.mjs';
import { openZip, openBook, extractEntry, plugin as bookPlugin, makeBook } from './book.mjs';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { DOMParser, Event } = require('linkedom');

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const { zotLookSheet: S } = loadPlugin({});
const LABELS = { pages: 'pages', none: 'No matches', gotoNone: 'No such page', commandDelay: 5 };
const later = () => new Promise((r) => setTimeout(r, 25));
const type = (doc, value) => {
  const input = doc.querySelector('.zl-search input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  return input;
};

// ── the PDF sheet: texts in a block, the field hidden until scripted ──
const html = S.html({
  pages: [
    { page: 1, height: 700, text: 'Introduction to reading' },
    { page: 2, height: 700, text: 'Methods: reading and more reading' },
    { page: 3, height: 700, text: 'A page that says </script> and carries on' },
    { page: 4, height: 700, text: '' },
  ],
  columns: 2, width: 500, imageDir: 'pages', pageCount: 4,
});
ok(/<div class="zl-search"><input type="search"/.test(html), 'the sheet carries a search field');
ok(/html\.zl-scripted \.zl-search \{ display: flex; \}/.test(html)
   && /\.zl-search \{\s*display: none;/.test(html),
   'hidden by default, shown only once a script has run');
ok(/<script type="application\/json" id="zl-texts">/.test(html), 'the pages\' text travels in a JSON block');
ok(html.includes('<\\/script>') && !/says <\/script>/.test(html),
   'and a page that says </script> cannot close that block early');
ok(!/"4":/.test(html), 'a page without text is not in it');
ok(/data-zl-tile="2"/.test(html), 'every tile says which page it is');
ok(html.includes('(document, {"pages":"pages","none":"No matches","gotoNone":"No such page"})'),
   'the runtime is the function itself, handed the labels');
{
  // The page gets source text, not the function: it has to parse as a
  // script on its own — a method's source does not, until `function` is
  // put in front of it, and that is the mistake this caught once.
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  eq(scripts.length, 2, 'the sheet carries two scripts, the jump and the search');
  let parses = true;
  for (const src of scripts) {
    try { new Function(src); } catch (e) { parses = false; console.log('      ' + e.message); }
  }
  ok(parses, 'and both parse as scripts, so the page can run them');
}

{
  const doc = new DOMParser().parseFromString(html, 'text/html');
  ok(!doc.documentElement.classList.contains('zl-scripted'), 'nothing is revealed before the script runs');
  S.sheetRuntime(doc, LABELS);
  ok(doc.documentElement.classList.contains('zl-scripted'), 'the runtime reveals the field');

  type(doc, 'reading');
  const tiles = [...doc.querySelectorAll('.page')];
  eq(tiles.map((t) => t.classList.contains('zl-miss')), [false, false, true, true],
     'pages without the word are dimmed');
  eq(tiles.map((t) => (t.querySelector('.zl-hit-count') || {}).textContent || ''), ['1', '2', '', ''],
     'pages with it carry their count');
  ok(tiles[0].classList.contains('zl-current'), 'the first match is the current one');
  eq(doc.querySelector('.zl-search-status').textContent, '1 / 2', 'and the status says where we are');

  const input = doc.querySelector('.zl-search input');
  const press = (target, key, extra = {}) =>
    target.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));
  press(input, 'Enter');
  ok(tiles[1].classList.contains('zl-current') && !tiles[0].classList.contains('zl-current'),
     'Enter walks to the next match');
  eq(doc.querySelector('.zl-search-status').textContent, '2 / 2', 'the status follows');
  press(input, 'Enter');
  ok(tiles[0].classList.contains('zl-current'), 'and wraps around');

  type(doc, 'METHODS:  reading');
  eq(tiles.map((t) => t.classList.contains('zl-miss')), [true, false, true, true],
     'case and runs of spaces do not matter');

  type(doc, 'nowhere');
  eq(doc.querySelector('.zl-search-status').textContent, 'No matches', 'no match says so');
  eq(tiles.filter((t) => t.classList.contains('zl-current')).length, 0, 'and nothing is current');

  type(doc, '');
  eq(tiles.filter((t) => t.classList.contains('zl-miss')).length, 0, 'an empty field shows every page again');
  eq(doc.querySelector('.zl-search-status').textContent, '', 'with nothing beside it');
}

// ── the keyboard: the frame is a cursor, with or without a search ─────
{
  const html2 = S.html({
    pages: [1, 2, 3, 4, 5, 6].map((n) => ({ page: n, height: 700, text: 'page ' + n })),
    columns: 3, width: 500, imageDir: 'pages', pageCount: 6,
    linkBase: 'zotero://open-pdf/library/items/ABCD1234',
    toc: [{ title: 'One', page: 1, level: 0 }, { title: 'Four', page: 4, level: 0 }],
    annotations: [{ page: 5, key: 'K5', type: 'highlight', text: 'quoted words', comment: 'why' }],
  });
  ok(/<div class="grid" data-zl-columns="3">/.test(html2), 'the grid says how many columns it has');
  const doc = new DOMParser().parseFromString(html2, 'text/html');
  S.sheetRuntime(doc, LABELS);
  const press = (key, extra = {}) =>
    doc.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));
  const framed = () => [...doc.querySelectorAll('.page')].findIndex((t) => t.classList.contains('zl-current')) + 1;

  eq(framed(), 0, 'nothing is framed to begin with');
  press('Enter');           eq(framed(), 1, 'Enter frames the first page');
  press('Enter');           eq(framed(), 2, 'and then the next');
  press('Enter', { shiftKey: true }); eq(framed(), 1, 'Shift+Enter goes back');
  press('ArrowRight');      eq(framed(), 2, 'the right arrow moves on');
  press('ArrowDown');       eq(framed(), 5, 'the down arrow moves a row, three columns here');
  press('ArrowLeft');       eq(framed(), 4, 'the left arrow moves back');
  press('ArrowUp');         eq(framed(), 1, 'the up arrow moves a row up');
  press('ArrowUp');         eq(framed(), 4, 'and wraps around the end');
  eq(doc.querySelector('.zl-search-status').textContent, '', 'no count is shown without a search');

  let opened = [];
  doc.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (a) opened.push(a.getAttribute('href')); });
  press('o'); await later();
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?page=4'], 'o clicks the framed page\'s link, which is the way to the reader');
  press('Enter', { ctrlKey: true });
  eq(opened.length, 2, 'so does Ctrl+Enter');

  // The jump script frames a tile on its own when a menu entry is followed;
  // the keys must take the frame from the page, not from what they last did
  for (const t of doc.querySelectorAll('.page')) t.classList.remove('zl-current');
  doc.querySelectorAll('.page')[5].classList.add('zl-current');
  opened = [];
  press('o'); await later();
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?page=6'],
     'o opens the page that is framed, wherever the frame came from');
  press('Enter');
  eq(framed(), 1, 'and Enter walks on from there, wrapping round');

  press('c'); await later();
  const toc = doc.querySelector('details.zl-toc');
  ok(toc.hasAttribute('open'), 'c opens the contents');
  eq(toc.querySelector('a.zl-menu-current').textContent, 'One', 'with the first entry highlighted');
  press('ArrowDown');
  eq(toc.querySelector('a.zl-menu-current').textContent, 'Four', 'the arrows walk the entries');
  eq(framed(), 1, 'and leave the frame where it was');
  opened = [];
  press('Enter');
  eq(opened, ['#p4'], 'Enter follows the highlighted entry');
  ok(toc.hasAttribute('open'), 'and the menu stays open, the next entry an arrow away');
  eq(toc.querySelector('a.zl-menu-current').textContent, 'Four', 'with the entry still highlighted');

  press('a'); await later();
  const ann = doc.querySelector('details.zl-annotations');
  ok(ann.hasAttribute('open'), 'a opens the annotations');
  ok(ann.querySelector('details.zl-annotation-entry').hasAttribute('open'),
     'the highlighted entry\'s fold opens so its link can be seen');
  press('c'); await later();
  ok(!ann.hasAttribute('open') && toc.hasAttribute('open'), 'c swaps to the contents, closing the other');
  press('c'); await later();
  ok(!toc.hasAttribute('open'), 'and c again closes it');

  // the field: letters are typing, Enter and the arrows still walk
  const input = doc.querySelector('.zl-search input');
  const inField = (key, extra = {}) =>
    input.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));
  opened = [];
  inField('o'); eq(opened, [], 'o in the field opens nothing');
  inField('c'); ok(!toc.hasAttribute('open'), 'nor does c open a menu there');
  inField('ArrowDown'); eq(framed(), 4, 'the down arrow in the field still moves the frame, a row down');

  // an annotation entry: Enter goes to its page, o into the reader at it
  press('a'); await later();
  opened = [];
  press('Enter');
  eq(opened, ['#p5'], 'Enter on an annotation goes to its page');
  opened = [];
  press('o'); await later();
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?annotation=K5'],
     'o on an annotation opens the reader at the annotation itself');
  ok(!ann.hasAttribute('open'), 'and the menu closes behind it');

  // a page by its number: a digit typed lands in the page field, Enter there frames the page
  const gotoField = doc.querySelector('.zl-goto input');
  const enterInGoto = () => gotoField.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Enter' }));
  press('5');
  eq(gotoField.value, '5', 'a digit typed on the sheet lands in the page field');
  enterInGoto();
  eq(framed(), 5, 'Enter frames the page of that number');
  eq(gotoField.value, '5', 'and the number stays in the field');
  input.value = 'page'; input.dispatchEvent(new Event('input'));
  gotoField.value = ''; press('3'); enterInGoto();
  eq(framed(), 3, 'under a search too');
  eq(doc.querySelector('.zl-search-status').textContent, '3 / 6', 'and the status says where among the hits that is');
  gotoField.value = ''; input.value = ''; input.dispatchEvent(new Event('input'));

  // the columns, live
  const grid = doc.querySelector('[data-zl-columns]');
  press('+');
  eq(grid.getAttribute('data-zl-columns'), '4', 'plus adds a column');
  eq(grid.style.gridTemplateColumns, 'repeat(4, 1fr)', 'and the grid follows on the spot');
  press('-'); press('-');
  eq(grid.getAttribute('data-zl-columns'), '2', 'minus takes them away');
  press('ArrowDown');
  eq(framed(), 7 > 6 ? 1 : 7, 'the arrows take the new count: a row of two from page 5 wraps to the first');
}

// ── what the window brings along, and what it hands on ────────────────
{
  const html3 = S.html({
    pages: [1, 2, 3].map((n) => ({ page: n, height: 700, text: n === 2 ? 'the word' : 'other' })),
    columns: 3, width: 500, imageDir: 'pages', pageCount: 3,
    linkBase: 'zotero://open-pdf/library/items/ABCD1234',
  });
  const doc = new DOMParser().parseFromString(html3, 'text/html');
  const printed = [];
  Object.defineProperty(doc, 'defaultView', {
    value: { location: { hash: '#zl-q=the%20word' }, print: () => printed.push(1) }, configurable: true });
  S.sheetRuntime(doc, LABELS);
  eq(doc.querySelector('.zl-search input').value, 'the word', 'a query in the fragment fills the field');
  eq(doc.querySelector('.zl-search-status').textContent, '1 / 1', 'and is searched at once');
  ok(doc.querySelectorAll('.page')[1].classList.contains('zl-current'), 'with the hit framed');
  doc.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'p' }));
  await later();
  eq(printed.length, 1, 'p prints, which is where a sheet becomes a PDF');
}

// ── under a search the arrows keep their directions ───────────────────
// Walking the hits in reading order on every arrow made up and down feel
// like sideways, which is what was reported from Windows. Left and right go
// hit by hit; up and down go to the nearest row in that direction that has
// a hit, closest column first, and round the end.
{
  const texts = ['alpha', 'alpha', 'beta', 'beta', 'alpha', 'beta'];
  const html3 = S.html({
    pages: texts.map((text, i) => ({ page: i + 1, height: 700, text })),
    columns: 3, width: 500, imageDir: 'pages', pageCount: 6,
    linkBase: 'zotero://open-pdf/library/items/ABCD1234',
  });
  const doc = new DOMParser().parseFromString(html3, 'text/html');
  S.sheetRuntime(doc, LABELS);
  const framed = () => [...doc.querySelectorAll('.page')].findIndex((t) => t.classList.contains('zl-current')) + 1;
  const input = doc.querySelector('.zl-search input');
  let blurred = 0;
  input.blur = () => { blurred++; };
  const press = (target, key, extra = {}) =>
    target.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));

  type(doc, 'alpha');
  eq(framed(), 1, 'the search frames the first hit: pages 1, 2 and 5 match');

  press(doc.body, 'ArrowDown');  eq(framed(), 5, 'down goes to the row below, to the hit nearest the column');
  press(doc.body, 'ArrowUp');    eq(framed(), 2, 'up goes back to the row above, nearest column first');
  press(doc.body, 'ArrowRight'); eq(framed(), 5, 'right goes hit by hit');
  press(doc.body, 'ArrowLeft');  eq(framed(), 2, 'and left back');
  press(doc.body, 'ArrowDown');  eq(framed(), 5, 'down again');
  press(doc.body, 'ArrowDown');  eq(framed(), 2, 'and round the end to the first row with a hit');
  press(doc.body, 'ArrowUp');    eq(framed(), 5, 'up round the end to the last');

  // Enter in the field walks on and hands the keyboard back to the page
  press(input, 'Enter');
  eq(framed(), 1, 'Enter in the field walks to the next hit');
  eq(blurred, 1, 'and leaves the field, so the next key is navigation');
  let opened = [];
  doc.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (a) opened.push(a.getAttribute('href')); });
  press(doc.body, 'o'); await later();
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?page=1'], 'so that o opens the framed page');
}

// ── the EPUB sheet: the tiles are the text, and the hits are marked ───
{
  const { zotLookEpub: E, zotLookUtil: U } = bookPlugin;
  const TMP = fs.mkdtempSync(os.tmpdir() + '/zotlook-search-');
  const mark = (id, n) => `<span epub:type="pagebreak" role="doc-pagebreak" id="${id}" title="${n}"/>`;
  const epub = makeBook(TMP + '/book', { chapters: [
    `<h1>Front</h1>${mark('PB1', '1')}<p>The reading begins here.</p>` +
    `${mark('PB2', '2')}<p>Nothing of note.</p>${mark('PB3', '3')}<p>Reading, and reading again.</p>`,
  ]});
  const out = await E.convert(epub, {
    outDir: fs.mkdtempSync(TMP + '/out-'), openZip, openBook, extractEntry, mode: 'sheet',
  });
  const page = fs.readFileSync(out, 'utf8');
  ok(/<div class="zl-search">/.test(page), 'the page overview carries the field');
  ok((page.match(/<script>/g) || []).length === 2, 'and both scripts, the jump and the search');
  ok(!/id="zl-texts"/.test(page), 'but no JSON block: its tiles are the text');

  const doc = U.parseStrict(page, 'text/html');
  S.sheetRuntime(doc, LABELS);
  type(doc, 'reading');
  const tiles = [...doc.querySelectorAll('div.epub-page')];
  eq(tiles.map((t) => t.classList.contains('zl-miss')), [true, false, true, false],
     'the front matter and page two are dimmed, pages one and three are not');
  eq(tiles[3].querySelectorAll('mark.zl-hit').length, 2, 'the hits are marked in the tile');
  eq(tiles[3].querySelector('mark.zl-hit').textContent, 'Reading', 'in the case the book wrote them');
  type(doc, 'begins');
  eq(tiles[3].querySelectorAll('mark.zl-hit').length, 0, 'a new query takes the old marks away');
  eq(tiles[3].querySelector('div.epub-paper-inner').textContent.includes('Reading, and reading again.'), true,
     'and leaves the text as it was');

  // a range on the overview grows the tiles instead of setting columns:
  // two pages in a 1400 by 860 window, side by side, are 2.65 times the
  // thumbnail — the window's height, less the padding and the labels,
  // over one row of paper
  type(doc, '');
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 1400, configurable: true });
  Object.defineProperty(doc.documentElement, 'clientHeight', { value: 860, configurable: true });
  const grid = doc.querySelector('div.epub-sheet');
  eq(grid.getAttribute('data-zl-scale'), '1', 'the overview says it scales rather than recolumns');
  const goto = doc.querySelector('.zl-goto input');
  const inGoto = (key) =>
    goto.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key }));
  goto.value = '1–2'; inGoto('Enter');
  eq(grid.getAttribute('data-zl-scale'), '2.65', 'two pages grow to fill the window side by side');
  eq(grid.style.getPropertyValue('--zl-scale'), '2.65', 'through the variable every length of a tile hangs off');
  eq(tiles.map((t) => t.classList.contains('zl-out')), [true, false, false, true], 'the other tiles are out');
  goto.value = '1–3'; inGoto('Enter');
  eq(grid.getAttribute('data-zl-scale'), '2.08', 'three pages a little less, still in one row: the width now binds');
  goto.value = ''; inGoto('Enter');
  eq(grid.getAttribute('data-zl-scale'), '1', 'an empty field brings the thumbnails back');
  eq(grid.style.getPropertyValue('--zl-scale'), '1', 'in the variable too');
  // a number no page is marked with is no page here — not the tile in
  // that position, which on a book's overview is somewhere in the front
  // matter; the PDF sheet keeps its fall-back to the tile's own number
  const framedBefore = tiles.findIndex((t) => t.classList.contains('zl-current'));
  goto.value = '0'; inGoto('Enter');
  eq(doc.querySelector('.zl-goto-status').textContent, LABELS.gotoNone, 'a number not printed on any page is refused on the overview');
  eq(tiles.findIndex((t) => t.classList.contains('zl-current')), framedBefore, 'and the frame stays where it was, not on the tile in that position');
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ── a real click on a reader link is sent again as a synthetic one ────
// Zotero's viewer window runs an actor that takes a trusted click whose
// target is an anchor and hands the address to the system — a dialogue,
// for a zotero: link. The jump script stops the trusted click and clicks
// the link itself; the synthetic click passes the actor and reaches Zotero
{
  const html4 = S.html({
    pages: [{ page: 1, height: 700 }], columns: 1, width: 500, imageDir: 'pages', pageCount: 1,
    linkBase: 'zotero://open-pdf/library/items/ABCD1234',
    annotations: [{ page: 1, key: 'K1', type: 'highlight', text: 'words' }],
  });
  const doc = new DOMParser().parseFromString(html4, 'text/html');
  const script = S.JUMP_SCRIPT.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');
  new Function('document', script)(doc);
  const link = doc.querySelector('a.zl-annotation-open');
  const seen = [];
  link.addEventListener('click', (e) => seen.push(e.isTrusted ? 'trusted' : 'synthetic'));
  const real = new Event('click', { bubbles: true, cancelable: true });
  Object.defineProperty(real, 'isTrusted', { value: true });
  Object.assign(real, { button: 0, metaKey: false, ctrlKey: false, shiftKey: false });
  link.dispatchEvent(real);
  eq(real.defaultPrevented, true, 'the trusted click on a reader link is stopped');
  eq(seen, ['trusted', 'synthetic'], 'and the link is clicked again, synthetically, for the road past the actor');
  const tile = doc.querySelector('.page a');
  const seenTile = [];
  tile.addEventListener('click', (e) => seenTile.push(e.isTrusted ? 'trusted' : 'synthetic'));
  const onImage = new Event('click', { bubbles: true, cancelable: true });
  Object.defineProperty(onImage, 'isTrusted', { value: true });
  Object.assign(onImage, { button: 0, metaKey: false, ctrlKey: false, shiftKey: false });
  tile.querySelector('img').dispatchEvent(onImage);
  eq(onImage.defaultPrevented, false, 'a click on a tile\'s picture is left alone: it passes the actor as it is');
  eq(seenTile, ['trusted'], 'and is not sent twice');
}

// ── the columns that fit a range into the window ──────────────────────
// Seven A4 pages in a 1400 by 860 window: five columns and two rows fit,
// four columns and two rows are too tall
{
  const html6 = S.html({
    pages: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ page: n, height: 707 })),
    columns: 4, width: 500, imageDir: 'pages', pageCount: 8,
  });
  const doc = new DOMParser().parseFromString(html6, 'text/html');
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 1400, configurable: true });
  Object.defineProperty(doc.documentElement, 'clientHeight', { value: 860, configurable: true });
  S.sheetRuntime(doc, LABELS);
  const goto = doc.querySelector('.zl-goto input');
  goto.value = '1–7';
  goto.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Enter' }));
  eq(doc.querySelector('[data-zl-columns]').getAttribute('data-zl-columns'), '5', 'seven pages take five columns, the fewest whose two rows fit');
  goto.value = '1–2';
  goto.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Enter' }));
  eq(doc.querySelector('[data-zl-columns]').getAttribute('data-zl-columns'), '3', 'two pages take three: at two a page would be taller than the window');
  eq(doc.querySelectorAll('.page.zl-out').length, 6, 'the other six are out');
}

// ── the page field: a number typed, Enter frames the page ─────────────
{
  const html5 = S.html({
    pages: [{ page: 1, height: 700, label: 'i' }, { page: 2, height: 700, label: 'ii' }, { page: 3, height: 700, label: '1' }, { page: 4, height: 700, label: '2' }],
    columns: 2, width: 500, imageDir: 'pages', pageCount: 4,
  });
  ok(html5.includes('class="zl-goto"'), 'the sheet has a page field');
  ok(html5.includes('placeholder="Page i–2"'), 'whose placeholder names the printed range');
  const doc = new DOMParser().parseFromString(html5, 'text/html');
  S.sheetRuntime(doc, LABELS);
  const goto = doc.querySelector('.zl-goto input');
  const inGoto = (key, extra = {}) =>
    goto.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));
  const framed = () => [...doc.querySelectorAll('.page')].findIndex((t) => t.classList.contains('zl-current')) + 1;
  goto.value = '1'; inGoto('Enter');
  eq(framed(), 3, 'the printed number wins: page 1 is the third tile');
  goto.value = '4'; inGoto('Enter');
  eq(framed(), 4, 'a number no tile is printed with falls back to the tile\'s own');
  goto.value = 'ii'; inGoto('Enter');
  eq(framed(), 2, 'roman front matter is found by its label');
  goto.value = '99'; inGoto('Enter');
  eq(doc.querySelector('.zl-goto-status').textContent, LABELS.gotoNone, 'a page not there is said beside the field');
  eq(framed(), 2, 'and the frame stays');
  doc.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'g', ctrlKey: true }));
  inGoto('3'); eq(doc.querySelector('.zl-search-status').textContent, '', 'a digit in the field is typing, not a jump');

  // a range: the tiles outside go out of the grid, and the columns are set
  // so that the range fits the window
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 1400, configurable: true });
  Object.defineProperty(doc.documentElement, 'clientHeight', { value: 860, configurable: true });
  const grid = doc.querySelector('[data-zl-columns]');
  const out = () => [...doc.querySelectorAll('.page')].map((t) => (t.classList.contains('zl-out') ? 'out' : 'in')).join(' ');
  goto.value = 'ii–1'; inGoto('Enter');
  eq(out(), 'out in in out', 'a range by printed numbers keeps its tiles and takes the others out');
  eq(framed(), 2, 'and frames its first page');
  eq(grid.getAttribute('data-zl-columns'), '3', 'two pages 700 tall at 500 wide need three columns of a 1400 by 860 window to fit its height');
  goto.value = '1-4'; inGoto('Enter');
  eq(out(), 'out out in in', 'a range by tile numbers too, with a plain hyphen');
  goto.value = ''; inGoto('Enter');
  eq(out(), 'in in in in', 'an empty field and Enter show every page again');
  eq(grid.getAttribute('data-zl-columns'), '2', 'at the column count from before the range');
  goto.value = '3–99'; inGoto('Enter');
  eq(doc.querySelector('.zl-goto-status').textContent, LABELS.gotoNone, 'a range with an end that is not there is refused');
  eq(out(), 'in in in in', 'and changes nothing');

  // Backspace on the sheet takes back the page, then the search
  const press = (key) =>
    doc.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key }));
  const search = doc.querySelector('.zl-search input');
  goto.value = 'ii–1'; inGoto('Enter');
  search.value = 'page'; search.dispatchEvent(new Event('input'));
  eq(out(), 'out in in out', 'a range and a search are set');
  press('Backspace');
  eq(out(), 'in in in in', 'Backspace ends the range');
  eq(goto.value, '', 'and empties the page field');
  eq(framed(), 0, 'and takes the frame off');
  eq(search.value, 'page', 'the search stays for now');
  press('Backspace');
  eq(search.value, '', 'the next Backspace empties the search');
  eq(doc.querySelector('.zl-search-status').textContent, '', 'and the status with it');
  goto.value = '2'; inGoto('Enter');
  eq(framed(), 4, 'a page framed by its printed number, the fourth tile');
  press('Delete');
  eq(framed(), 0, 'Delete takes it back like Backspace');
}

// ── typing on the sheet goes into the fields ──────────────────────────
// Digits go to the page field, a word to the search field; a command
// letter waits a moment, and a second letter on its heels makes a word
{
  const html7 = S.html({
    pages: [1, 2, 3].map((n) => ({ page: n, height: 700, text: n === 2 ? 'cat' : 'dog' })),
    columns: 3, width: 500, imageDir: 'pages', pageCount: 3,
    toc: [{ title: 'One', page: 1, level: 0 }],
  });
  const doc = new DOMParser().parseFromString(html7, 'text/html');
  S.sheetRuntime(doc, LABELS);
  const press = (key, extra = {}) =>
    doc.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));
  const goto = doc.querySelector('.zl-goto input');
  const search = doc.querySelector('.zl-search input');
  const framed = () => [...doc.querySelectorAll('.page')].findIndex((t) => t.classList.contains('zl-current')) + 1;
  press('2');
  eq(goto.value, '2', 'a digit typed on the sheet lands in the page field');
  goto.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Enter' }));
  eq(framed(), 2, 'and Enter there frames the page');
  press('d');
  eq(search.value, 'd', 'a letter that is no command lands in the search field');
  eq(doc.querySelector('.zl-search-status').textContent, '1 / 2', 'and is searched at once');
  search.value = ''; search.dispatchEvent(new Event('input'));
  press('c'); press('a');
  eq(search.value, 'ca', 'a command letter followed by another letter is a word for the search, not a command');
  ok(!doc.querySelector('details.zl-toc').hasAttribute('open'), 'so no menu opened');
  eq(doc.querySelector('.zl-search-status').textContent, '1 / 1', 'and the word is searched');
  search.value = ''; search.dispatchEvent(new Event('input'));
  press('c'); await later();
  ok(doc.querySelector('details.zl-toc').hasAttribute('open'), 'a command letter on its own runs the command after its moment');
  press('c'); await later();
  let focused = 0; search.focus = () => { focused++; };
  press('/');
  eq(focused, 1, 'a slash is the way into the search field');
  search.value = ''; search.dispatchEvent(new Event('input'));
  press('ä');
  eq(search.value, 'ä', 'an umlaut is a letter too');
}

// ── the menus fold on the jump where the preferences say so ───────────
{
  const html8 = S.html({
    pages: [1, 2, 3].map((n) => ({ page: n, height: 700 })),
    columns: 3, width: 500, imageDir: 'pages', pageCount: 3,
    toc: [{ title: 'One', page: 1, level: 0 }, { title: 'Two', page: 2, level: 0 }],
    menuMouse: false, menuKeyboard: false,
  });
  ok(html8.includes('<html data-zl-menu-mouse="close" data-zl-menu-keyboard="close">'), 'the root says what the menus do');
  const doc = new DOMParser().parseFromString(html8, 'text/html');
  const script = S.JUMP_SCRIPT.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');
  new Function('document', script)(doc);
  S.sheetRuntime(doc, LABELS);
  const press = (key, extra = {}) =>
    doc.body.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...extra }));
  const toc = doc.querySelector('details.zl-toc');
  press('c'); await later();
  ok(toc.hasAttribute('open'), 'c opens the contents');
  press('Enter');
  ok(!toc.hasAttribute('open'), 'Enter follows and, so set, folds the menu');
  toc.setAttribute('open', '');
  const link = toc.querySelectorAll('a')[1];
  const real = new Event('click', { bubbles: true, cancelable: true });
  Object.assign(real, { button: 0, metaKey: false, ctrlKey: false, shiftKey: false });
  link.dispatchEvent(real);
  ok(doc.querySelectorAll('.page')[1].classList.contains('zl-current'), 'a click jumps to the page');
  ok(!toc.hasAttribute('open'), 'and, so set, folds the menu too');
  const html9 = S.html({ pages: [{ page: 1, height: 700 }], columns: 1, width: 500, imageDir: 'pages', pageCount: 1 });
  ok(html9.includes('<html data-zl-menu-mouse="stay" data-zl-menu-keyboard="stay">'), 'unsaid, both stay');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
