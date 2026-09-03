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
  S.searchRuntime(doc, LABELS);
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
  input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }));
  ok(tiles[1].classList.contains('zl-current') && !tiles[0].classList.contains('zl-current'),
     'Enter walks to the next match');
  eq(doc.querySelector('.zl-search-status').textContent, '2 / 2', 'the status follows');
  input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }));
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
  S.searchRuntime(doc, LABELS);
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
