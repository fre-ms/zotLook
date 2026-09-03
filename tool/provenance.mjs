// How much of the upstream code survives in zotLook — the figures the
// Origins page states, measured rather than remembered.
//
//   node tool/provenance.mjs        print the report
//
// A line counts when it is neither blank, a comment, nor punctuation alone
// (braces, brackets, semicolons). A line survives when the same line, trimmed,
// stands somewhere in addon/*.js today. A method is present when a method of
// that name is still defined under its own name. Nothing is normalised beyond
// trimming: a line that was reindented counts, a line that was reworded does
// not, which errs on the side of crediting the original.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIX = ROOT + 'test/fixtures/upstream/';

export function substantiveLines(text) {
  const out = [];
  let block = false;
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (block) { if (t.includes('*/')) block = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) block = true; continue; }
    if (!t || t.startsWith('//') || t.startsWith('*')) continue;
    if (/^[{}()[\];,]*$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

/** Names of the methods a file defines, in order, each once. */
export function methodNames(text) {
  const names = [];
  const skip = new Set(['if', 'for', 'while', 'switch', 'catch', 'function']);
  for (const m of text.matchAll(/^\s*(?:async\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/gm)) {
    if (!skip.has(m[1]) && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export function measure() {
  const files = fs.readdirSync(ROOT + 'addon').filter((f) => f.endsWith('.js'));
  const sources = files.map((f) => fs.readFileSync(ROOT + 'addon/' + f, 'utf8'));
  const today = new Set();
  let todayCount = 0;
  for (const src of sources) {
    const lines = substantiveLines(src);
    todayCount += lines.length;
    for (const l of lines) today.add(l);
  }
  const todayHashes = new Set([...today].map(sha1));
  const all = sources.join('\n');

  const chapron = (name) => {
    const lines = substantiveLines(fs.readFileSync(FIX + name, 'utf8'));
    const survived = lines.filter((l) => today.has(l));
    return { total: lines.length, survived: survived.length,
             percent: Math.round((100 * survived.length) / lines.length) };
  };
  const quicklook = chapron('chapron-quicklook.js');
  const bootstrap = chapron('chapron-bootstrap.js');

  const names = methodNames(fs.readFileSync(FIX + 'chapron-quicklook.js', 'utf8'));
  const present = names.filter((n) =>
    new RegExp('^\\s*(?:async\\s+)?' + n + '\\s*\\([^)]*\\)\\s*\\{', 'm').test(all));

  const ronkko = JSON.parse(fs.readFileSync(FIX + 'ronkko-zoteroquicklook.sha1.json', 'utf8'));
  const ronkkoSurvived = ronkko.sha1.filter((h) => todayHashes.has(h)).length;

  return {
    today: todayCount,
    quicklook, bootstrap,
    methods: { total: names.length, present: present.length,
               missing: names.filter((n) => !present.includes(n)) },
    // one part in N of today's lines are Chapron's surviving ones
    share: Math.round(todayCount / quicklook.survived),
    ronkko: { total: ronkko.substantive, survived: ronkkoSurvived },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = measure();
  console.log(`today: ${m.today} substantive lines in addon/*.js`);
  console.log(`quicklook.js: ${m.quicklook.survived}/${m.quicklook.total} survive (${m.quicklook.percent} %)`);
  console.log(`bootstrap.js: ${m.bootstrap.survived}/${m.bootstrap.total} survive (${m.bootstrap.percent} %)`);
  console.log(`methods: ${m.methods.present}/${m.methods.total} present; missing: ${m.methods.missing.join(', ')}`);
  console.log(`share: the surviving lines are about one in ${m.share} of today's`);
  console.log(`Rönkkö: ${m.ronkko.survived}/${m.ronkko.total} lines also occur here`);
}
