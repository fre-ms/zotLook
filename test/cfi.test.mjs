// EPUB Canonical Fragment Identifiers, read against real trees.
//
// This is the piece that replaced a text search. A CFI addresses structure —
// spine item, element path, text node, character offset — and structure is
// what an annotation in a reflowable book actually has; its wording is only
// what that structure happens to contain.
//
// The semantics here follow epub.js, the implementation Zotero vendors and
// therefore the one that wrote every CFI this will ever read. Where epub.js
// and a strict reading of the specification differ — epub.js counts text
// nodes among text nodes rather than interleaving them with elements — the
// writer decides, and that is checked below.
import { loadPlugin } from './load.mjs';

const { zotLookCfi: C, zotLookUtil: U } = loadPlugin();

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const xml = (text) => U.parseStrict(text, 'application/xml');

// ── reading the notation ──────────────────────────────────────────────
{
  // The one from the library, which is what started this
  const parsed = C.parse('epubcfi(/6/14!/4/2/6,/1:0,/1:671)');
  ok(parsed, 'a range CFI is read');
  eq(parsed.spine.map(s => [s.type, s.index]), [['element', 2], ['element', 6]],
     'the package path: the spine among the package children, then an itemref');
  eq(C.spineIndex(parsed), 6, 'so the seventh spine item — and Zotero\'s '
     + 'sortIndex for it begins 00006');
  eq(parsed.path.map(s => [s.type, s.index]),
     [['element', 1], ['element', 0], ['element', 2]],
     'the document path, rooted at the document element');
  eq(parsed.start.map(s => [s.type, s.index, s.offset]), [['text', 0, 0]],
     'the start: first text child, offset 0');
  eq(parsed.end.map(s => [s.type, s.index, s.offset]), [['text', 0, 671]],
     'and the end');
}
{
  eq(C.parse('/6/4!/4/2'), C.parse('epubcfi(/6/4!/4/2)'),
     'the wrapper is optional');
  const point = C.parse('epubcfi(/6/4!/4/2/1:17)');
  ok(point && !point.start, 'a CFI without a comma is a point, not a range');
  eq(point.path[point.path.length - 1].offset, 17, 'carrying its offset');
  eq(C.parse('epubcfi(/6/4)'), null, 'nothing inside a document, nothing to do');
  eq(C.parse(''), null, 'and an empty value is not a CFI');
  eq(C.parse('nonsense'), null, 'nor is anything else');
}
{
  const parsed = C.parse('epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:10)');
  eq(parsed.spine[1].id, 'chap01ref', 'an assertion on a package step is kept');
  eq(parsed.path[0].id, 'body01', 'and on a document step');
  eq(parsed.path.map(s => s.type), ['element', 'element', 'text'],
     'the example from the specification reads as element, element, text');
  eq(parsed.path[2].offset, 10, 'with its offset');
}
{
  // More than one indirection: what matters is the first hop, which names
  // the spine item, and the last, which is inside the document
  const parsed = C.parse('epubcfi(/6/4!/4/2!/2/2,/1:0,/1:5)');
  eq(C.spineIndex(parsed), 1, 'the spine still comes from the first hop');
  eq(parsed.path.map(s => s.index), [0, 0], 'and the path from the last');
}

// ── walking a tree ────────────────────────────────────────────────────
const SECTION = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body>
<h1 id="intro">Überschrift</h1><p id="one">Erster Absatz.</p><p>Zweiter.</p>
</body></html>`;

{
  const doc = xml(SECTION);
  const range = C.resolve(doc, C.parse('epubcfi(/6/2!/4/4,/1:0,/1:6)'));
  ok(range, 'a range resolves');
  eq(range.startNode.data.slice(range.startOffset, range.endOffset), 'Erster',
     'onto exactly the characters it names');
  eq(range.startNode.parentNode.getAttribute('id'), 'one',
     'in the element the path walks to');
}
{
  const doc = xml(SECTION);
  eq(C.resolve(doc, C.parse('epubcfi(/6/2!/4/99,/1:0,/1:2)')), null,
     'a step past the end of the children resolves to nothing');
  eq(C.resolve(doc, C.parse('epubcfi(/6/2!/4/4,/5:0,/5:2)')), null,
     'and so does a text step past the end');
}
{
  // The assertion is what survives an edit: an element added before the one
  // meant shifts every index after it, and the id does not move.
  const shifted = xml(SECTION.replace('<h1 id="intro">', '<div>neu</div><h1 id="intro">'));
  const range = C.resolve(shifted, C.parse('epubcfi(/6/2!/4/4[one],/1:0,/1:6)'));
  ok(range && range.startNode.parentNode.getAttribute('id') === 'one',
     'the id in the assertion wins over the index that no longer fits');
}
{
  // Moved rather than shifted: the element the assertion names is no longer
  // among the siblings the index points into, so looking along the row
  // cannot find it and only the document can
  const moved = xml(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body>
<h1>Überschrift</h1><div><p id="one">Erster Absatz.</p></div>
</body></html>`);
  const range = C.resolve(moved, C.parse('epubcfi(/6/2!/4/4[one],/1:0,/1:6)'));
  ok(range && range.startNode.parentNode.getAttribute('id') === 'one',
     'the document is asked for the id when the row does not hold it');
  eq(range && range.startNode.data.slice(range.startOffset, range.endOffset),
     'Erster', 'and the offsets still apply to what was found');
}

// ── where epub.js and the paper differ ────────────────────────────────
// Strictly, odd steps address the character data *between* elements, so text
// and elements share one numbering. epub.js counts text children among text
// children. Zotero writes with epub.js, so this must read the same way.
{
  const doc = xml('<?xml version="1.0"?><r>vorn<a>x</a>mitte<b>y</b>hinten</r>');
  const root = doc.documentElement;
  eq(Array.prototype.filter.call(root.childNodes, n => n.nodeType === 3)
       .map(n => n.data), ['vorn', 'mitte', 'hinten'],
     'the tree has three text children between two elements');

  const at = (cfi) => {
    const parsed = C.parse('epubcfi(/6/2!' + cfi + ')');
    const range = C.resolve(doc, parsed);
    return range && range.startNode.data;
  };
  // Rooted at the document element, so an empty first step: the paths below
  // start at <r> itself
  eq(at('/3:0'), 'mitte', 'step 3 is the second text child, not the text '
     + 'after the first element');
  eq(at('/5:0'), 'hinten', 'and step 5 the third');
  eq(at('/1:0'), 'vorn', 'step 1 the first');
}

// ── marking what was found ────────────────────────────────────────────
{
  const doc = xml(SECTION);
  const range = C.resolve(doc, C.parse('epubcfi(/6/2!/4/4,/1:0,/1:6)'));
  const wrapped = C.wrapRange(range, () => {
    const el = doc.createElement('mark');
    return el;
  });
  eq(wrapped, 1, 'one piece for a range inside one text node');
  ok(/<mark>Erster<\/mark> Absatz\./.test(doc.documentElement.outerHTML),
     'and exactly those characters are wrapped');
}
{
  // Across elements: one wrapper per text node, which is what a browser does
  // with a selection and what keeps the markup valid
  const doc = xml(SECTION);
  const range = C.resolve(doc, C.parse('epubcfi(/6/2!/4,/2/1:7,/6/1:7)'));
  ok(range, 'a range from the heading into the last paragraph resolves');
  eq([range.startNode.data, range.startOffset], ['Überschrift', 7],
     'starting seven characters into the heading');
  eq([range.endNode.data, range.endOffset], ['Zweiter.', 7],
     'and ending seven into the last paragraph');

  const wrapped = C.wrapRange(range, () => doc.createElement('mark'));
  eq(wrapped, 3, 'three pieces: the tail of one, a whole one, the head of the last');
  const html = doc.documentElement.outerHTML;
  eq((html.match(/<mark>/g) || []).length, 3, 'each piece its own element');
  ok(/Übersch<mark>rift<\/mark>/.test(html), 'the heading from the offset on');
  ok(/<mark>Erster Absatz\.<\/mark>/.test(html), 'the paragraph between, whole');
  ok(/<mark>Zweiter<\/mark>\./.test(html), 'and the last up to its offset');
}
{
  // Ends the wrong way round, or in different trees: marking part of it
  // would be worse than reporting that it could not be placed
  const doc = xml(SECTION);
  const other = xml(SECTION);
  const a = C.resolve(doc, C.parse('epubcfi(/6/2!/4/4,/1:0,/1:6)'));
  const b = C.resolve(other, C.parse('epubcfi(/6/2!/4/4,/1:0,/1:6)'));
  eq(C.wrapRange({ startNode: a.startNode, startOffset: 0,
                   endNode: b.endNode, endOffset: 6 }, () => doc.createElement('mark')),
     0, 'two points in different documents mark nothing');
  eq(C.wrapRange(null, () => doc.createElement('mark')), 0,
     'and neither does nothing at all');
}

// ── the pieces are numbered as they are read ──────────────────────────
// Wrapping runs backwards, because splitting a text node moves every offset
// after it. What the caller is told must not run backwards with it: marking
// "the first piece" has to mean the one the reader meets first.
{
  const doc = xml(SECTION);
  const range = C.resolve(doc, C.parse('epubcfi(/6/2!/4,/2/1:7,/6/1:7)'));
  const seen = [];
  C.wrapRange(range, (at, total) => {
    const el = doc.createElement('mark');
    el.setAttribute('data-at', String(at));
    seen.push([at, total]);
    return el;
  });
  eq(seen.map(s => s[0]).sort((a, b) => a - b), [0, 1, 2],
     'every piece is numbered once');
  eq(seen.every(s => s[1] === 3), true, 'and told how many there are');

  const html = doc.documentElement.outerHTML;
  const order = [...html.matchAll(/data-at="(\d)"/g)].map(m => m[1]);
  eq(order, ['0', '1', '2'],
     'and the numbers run with the text, not against it');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
