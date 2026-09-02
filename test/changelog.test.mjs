// The history is one text read three ways: the documentation page in two
// languages, CHANGELOG.md on GitHub, and the notes a release goes out with.
// What these check is that the three cannot have drifted apart, and that no
// release is missing from the record.
import fs from 'node:fs';
import { ROOT, ADDON } from './load.mjs';
import { parseHistory, toChangelog, notesFor, plain } from '../tool/changelog.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const en = fs.readFileSync(ROOT + 'doc/en/history.qmd', 'utf8');
const de = fs.readFileSync(ROOT + 'doc/de/history.qmd', 'utf8');
const hist = parseHistory(en);
const histDe = parseHistory(de);
const manifest = JSON.parse(fs.readFileSync(ADDON + 'manifest.json', 'utf8'));
const versions = JSON.parse(fs.readFileSync(ROOT + 'versions.json', 'utf8'));

// ── the record is complete and current ────────────────────────────────
ok(hist.entries.length >= 19, `the history holds ${hist.entries.length} releases`);
eq(hist.entries[0].version, manifest.version,
   'the newest entry is the version the manifest names');
{
  const listed = new Set(hist.entries.map((e) => e.version));
  const missing = versions.versions.map((v) => v.version ?? v).filter((v) => !listed.has(v));
  eq(missing, [], 'every version the switcher offers has an entry');
}
{
  const order = hist.entries.map((e) => e.version.split('.').map(Number));
  const sorted = [...order].sort((a, b) => b[0]-a[0] || b[1]-a[1] || b[2]-a[2]);
  eq(order, sorted, 'newest first, in version order');
  const dates = hist.entries.map((e) => e.date);
  eq([...dates].sort().reverse(), dates, 'and the dates never run backwards');
}
for (const e of hist.entries) {
  ok(e.body.length > 80, `${e.version} says something (${e.body.length} chars)`);
}

// ── the German page tells the same story ──────────────────────────────
eq(histDe.entries.map((e) => [e.version, e.date]),
   hist.entries.map((e) => [e.version, e.date]),
   'the German history lists the same versions with the same dates');
for (const [i, e] of histDe.entries.entries()) {
  ok(e.body.length > 80, `${e.version} is told in German too (${e.body.length} chars)`);
  const enHeads = (hist.entries[i].body.match(/^### /gm) || []).length;
  const deHeads = (e.body.match(/^### /gm) || []).length;
  eq(deHeads, enHeads, `${e.version}: the same sub-headings in both languages`);
}

// ── CHANGELOG.md and the release notes come out of the same text ──────
eq(fs.readFileSync(ROOT + 'CHANGELOG.md', 'utf8'), toChangelog(en),
   'CHANGELOG.md is what the history generates — run tool/changelog.mjs sync');
ok(/^# Changelog/m.test(toChangelog(en)) && !/\{\.unnumbered\}/.test(toChangelog(en)),
   'the generated changelog carries no Quarto attributes');
ok(!/^:::/m.test(toChangelog(en)), 'and no fenced divs');
eq(plain('## Title {.unnumbered}\n\n::: {.callout-note title="Caveat"}\nOne\nline.\n:::'),
   '## Title\n\n**Caveat.** One line.', 'a callout becomes a paragraph led by its title');
ok(notesFor(en, manifest.version).length > 80, 'the notes of the current release can be extracted');
ok(/node tool\/changelog\.mjs notes/.test(fs.readFileSync(ROOT + 'build.sh', 'utf8')),
   'build.sh writes them for the release');

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
