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
