import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from './load.mjs';

// Real filesystem + real unzip, so this exercises the whole pipeline
const IOUtils = {
  exists: async p => fs.existsSync(p),
  stat: async p => { const s = fs.statSync(p); return { size: s.size, lastModified: Math.floor(s.mtimeMs) }; },
  readUTF8: async p => fs.readFileSync(p, 'utf8'),
  writeUTF8: async (p, d) => fs.writeFileSync(p, d),
  makeDirectory: async (p) => fs.mkdirSync(p, { recursive: true }),
  remove: async (p, o = {}) => { try { fs.rmSync(p, { recursive: !!o.recursive, force: !!o.ignoreAbsent }); } catch (e) { if (!o.ignoreAbsent) throw e; } },
};
let unzipRuns = 0;
const runProcess = async (cmd, args) => {
  if (cmd.endsWith('unzip') || cmd.endsWith('tar.exe')) unzipRuns++;
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return { exitCode: 0 }; }
  catch (e) { return { exitCode: e.status ?? 1 }; }
};

// The extractor is the host's own, so the plugin has to be told the truth
// about which platform the suite is running on.
const host = { isMac: process.platform === 'darwin',
               isLinux: process.platform === 'linux',
               isWin: process.platform === 'win32' };
const { ZotLookEpub: E } = loadPlugin({ IOUtils, zotero: host });
let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      got:  ${JSON.stringify(g)}\n      want: ${JSON.stringify(w)}`)); };
const ok = (c, l) => eq(!!c, true, l);

const TMP = fs.mkdtempSync(os.tmpdir() + '/zotlook-epub-');
const BOOK = fileURLToPath(new URL('./fixtures/book.epub', import.meta.url));
const env = { tempDir: TMP, runProcess };

// ── the table of contents ─────────────────────────────────────────────
// The one thing a bundled EPUB viewer offers that this conversion did not.
// Both navigation formats are read, because a library holds both: EPUB 3
// keeps it in a navigation document, EPUB 2 in an NCX the spine points at.
// Their own extract directory: the reuse test further down counts what is
// unpacked under TMP, and these books would be counted with it.
const TOC_TMP = fs.mkdtempSync(os.tmpdir() + '/zotlook-toc-');
const tocEnv = { tempDir: TOC_TMP, runProcess };

function makeBook(dir, { nav = null, ncx = null } = {}) {
  fs.mkdirSync(dir + '/META-INF', { recursive: true });
  fs.mkdirSync(dir + '/OEBPS', { recursive: true });
  fs.writeFileSync(dir + '/mimetype', 'application/epub+zip');
  fs.writeFileSync(dir + '/META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" '
    + 'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
    + '<rootfile full-path="OEBPS/content.opf" '
    + 'media-type="application/oebps-package+xml"/></rootfiles></container>');
  for (const [n, extra] of [[1, '<h1 id="intro">First</h1>'], [2, '<h1>Second</h1>']]) {
    fs.writeFileSync(`${dir}/OEBPS/ch${n}.xhtml`,
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>'
      + `<title>Chapter ${n}</title></head><body>${extra}`
      + `<p>Body of chapter ${n}.</p></body></html>`);
  }
  let items = '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'
    + '<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>';
  let spineAttr = '';
  if (nav) {
    fs.writeFileSync(dir + '/OEBPS/nav.xhtml', nav);
    items += '<item id="nav" href="nav.xhtml" properties="nav" '
      + 'media-type="application/xhtml+xml"/>';
  }
  if (ncx) {
    fs.writeFileSync(dir + '/OEBPS/toc.ncx', ncx);
    items += '<item id="ncx" href="toc.ncx" '
      + 'media-type="application/x-dtbncx+xml"/>';
    spineAttr = ' toc="ncx"';
  }
  fs.writeFileSync(dir + '/OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" '
    + 'version="3.0" unique-identifier="i"><metadata '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Book</dc:title>'
    + '</metadata><manifest>' + items + '</manifest>'
    + `<spine${spineAttr}><itemref idref="c1"/><itemref idref="c2"/></spine>`
    + '</package>');
  const epub = dir + '.epub';
  execFileSync('zip', ['-qr', epub, '.'], { cwd: dir });
  return epub;
}

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

  ok(html.includes('<details') && html.includes('epub-toc'),
     'the contents are a details block, which folds without JavaScript');
  ok(/<summary[^>]*>Contents</.test(html), 'under a heading');
  ok(html.includes('First chapter') && html.includes('Second chapter'),
     'carrying the titles the book gives, not ones derived from headings');
  ok(html.includes('epub-toc-level1'), 'and the nesting the book gives');

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

// ── the extractor differs per platform ────────────────────────────────
// /usr/bin/unzip is not a Windows tool; bsdtar ships with the system there
// and reads the epub as the zip archive it is.
{
  const { ZotLookEpub: W } = loadPlugin({
    zotero: { isMac: false, isLinux: false, isWin: true } });
  const plan = W._unpackCommand('b.epub', 'd');
  ok(plan.command.toLowerCase().endsWith('\\system32\\tar.exe'),
     'Windows extracts with the bsdtar the system ships');
  eq(plan.args, ['-xf', 'b.epub', '-C', 'd'], 'format detection is left to it');
  const { ZotLookEpub: M } = loadPlugin({ zotero: { isMac: true } });
  eq(M._unpackCommand('b.epub', 'd').command, '/usr/bin/unzip',
     'everywhere else unzip stays');
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

// ── URL rewriting
ok(/file:\/\/.*OEBPS\/img\/pic%20one\.png/.test(html), 'image src rewritten and re-encoded');
ok(/url\((&quot;|")file:\/\/.*OEBPS\/img\/bg\.png(&quot;|")\)/.test(html), 'style attribute url() rewritten');
// url() inside a *linked* stylesheet needs no rewriting: WebKit resolves it
// against the stylesheet's own file:// URL.
ok(/book\.css/.test(html), 'linked stylesheet kept as a file:// link');

// ── stylesheets
eq((html.match(/rel="stylesheet"/g) || []).length, 1, 'shared stylesheet linked once, not per chapter');
eq((html.match(/font-variant: small-caps/g) || []).length, 1, 'identical inline style deduplicated');
ok(html.indexOf('Palatino') > html.indexOf('rel="stylesheet"'), 'base stylesheet comes after the book\'s own');

// ── XML self-closing must not leak into HTML
ok(!/<div\/>/.test(html), 'no self-closed div survives into the output');
ok(/<div><\/div>/.test(html), 'XHTML empty element stays empty, does not swallow siblings');
ok(/Mit Hintergrund/.test(html), 'content after an empty element survives');

// ── caching
const before = unzipRuns;
const out2 = await E.convert(BOOK, env);
eq(out2, out, 'second convert returns the same file');
eq(unzipRuns, before, 'second convert does not unzip again');

// Copy the fixture aside before touching it: the original is version-controlled
const COPY = TMP + '/touched.epub';
fs.copyFileSync(BOOK, COPY);
await E.convert(COPY, env);
const beforeTouch = unzipRuns;
fs.utimesSync(COPY, new Date(), new Date(Date.now() + 5000));
const out3 = await E.convert(COPY, env);
eq(unzipRuns, beforeTouch + 1, 'changed source invalidates the cache');
ok(out3, 'reconversion succeeds');

// ── deterministic extract dir: no accumulation
const dirs = fs.readdirSync(TMP).filter(d => d.startsWith('epub_'));
eq(dirs.length, 2, 'each source gets exactly one extract directory, reused');

fs.rmSync(TMP, { recursive: true, force: true });

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
