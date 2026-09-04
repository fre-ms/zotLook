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
const LABELS = { pages: 'pages', none: 'No matches' };
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
ok(html.includes('(document, {"pages":"pages","none":"No matches"})'),
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
  press('o');
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?page=4'], 'o clicks the framed page\'s link, which is the way to the reader');
  press('Enter', { ctrlKey: true });
  eq(opened.length, 2, 'so does Ctrl+Enter');

  // The jump script frames a tile on its own when a menu entry is followed;
  // the keys must take the frame from the page, not from what they last did
  for (const t of doc.querySelectorAll('.page')) t.classList.remove('zl-current');
  doc.querySelectorAll('.page')[5].classList.add('zl-current');
  opened = [];
  press('o');
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?page=6'],
     'o opens the page that is framed, wherever the frame came from');
  press('Enter');
  eq(framed(), 1, 'and Enter walks on from there, wrapping round');

  press('c');
  const toc = doc.querySelector('details.zl-toc');
  ok(toc.hasAttribute('open'), 'c opens the contents');
  eq(toc.querySelector('a.zl-menu-current').textContent, 'One', 'with the first entry highlighted');
  press('ArrowDown');
  eq(toc.querySelector('a.zl-menu-current').textContent, 'Four', 'the arrows walk the entries');
  eq(framed(), 1, 'and leave the frame where it was');
  opened = [];
  press('Enter');
  eq(opened, ['#p4'], 'Enter follows the highlighted entry');
  ok(!toc.hasAttribute('open'), 'and the menu closes behind it');

  press('a');
  const ann = doc.querySelector('details.zl-annotations');
  ok(ann.hasAttribute('open'), 'a opens the annotations');
  ok(ann.querySelector('details.zl-annotation-entry').hasAttribute('open'),
     'the highlighted entry\'s fold opens so its link can be seen');
  press('c');
  ok(!ann.hasAttribute('open') && toc.hasAttribute('open'), 'c swaps to the contents, closing the other');
  press('c');
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
  press('a');
  opened = [];
  press('Enter');
  eq(opened, ['#p5'], 'Enter on an annotation goes to its page');
  press('a');
  opened = [];
  press('o');
  eq(opened, ['zotero://open-pdf/library/items/ABCD1234?annotation=K5'],
     'o on an annotation opens the reader at the annotation itself');
  ok(!ann.hasAttribute('open'), 'and the menu closes behind it');

  // a page by its number: digits gather, Enter frames that page
  press('5');
  eq(doc.querySelector('.zl-search-status').textContent, '→ 5', 'a digit shows in the status as it is typed');
  press('Enter');
  eq(framed(), 5, 'Enter frames the page of that number');
  eq(doc.querySelector('.zl-search-status').textContent, '', 'and the status clears');

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
  press(doc.body, 'o');
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
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
