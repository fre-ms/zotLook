// The site is bilingual, and nothing held the two halves level. A section
// written in one language only does not break a build, does not show up in a
// diff anyone reads, and is invisible from either language on its own — you
// have to be looking at both at once to see it missing. This suite looks at
// both at once.
//
// What it compares is structure, never text. Headings, callout titles and the
// comments inside examples are translated, and must be.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.mjs';

let fail = 0;
const eq = (g, w, l) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`\n      en: ${JSON.stringify(g)}\n      de: ${JSON.stringify(w)}`)); };
const ok = (c, l) => eq(!!c, true, l);

const LANGS = ['en', 'de'];
const dirFor = (lang) => path.join(ROOT, 'doc', lang);
const pagesIn = (lang) => fs.readdirSync(dirFor(lang), { recursive: true })
  .filter((f) => f.endsWith('.qmd'))
  .map((f) => f.split(path.sep).join('/'))
  .sort();

/**
 * A page reduced to the shape of it.
 *
 * Fenced blocks are tracked because a heading inside one is a line of an
 * example, not a section: the shell prompts in the build page would otherwise
 * count as chapters.
 */
function shapeOf(file) {
  const headings = [];
  const fences = [];
  let fence = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const rule = /^(`{3,})(.*)$/.exec(line);
    if (rule) {
      if (fence) fence = null;                    // closing
      else { fence = rule[1]; fences.push(rule[2].trim()); }
      continue;
    }
    if (fence) continue;
    const head = /^(#{1,6})\s+\S/.exec(line);
    if (head) headings.push(head[1].length);
  }
  return { headings, fences };
}

/** title and description, which every page carries for the site index. */
function frontmatter(file) {
  const src = fs.readFileSync(file, 'utf8');
  const block = src.startsWith('---\n') ? src.slice(4).split('\n---')[0] : '';
  return {
    title: /^title:\s*\S/m.test(block),
    description: /^description:\s*\S/m.test(block),
  };
}

// ── the same pages exist in both languages ────────────────────────────
const pages = pagesIn('en');
eq(pages, pagesIn('de'), 'both languages hold the same set of pages');
ok(pages.length > 5, `${pages.length} pages are compared`);

// ── and each page is built the same way ───────────────────────────────
// Heading levels in document order, which is what "the same depth" means when
// the headings themselves are in two languages. A section added on one side
// only shows up here as a length or a level that does not line up.
for (const page of pages) {
  const en = shapeOf(path.join(dirFor('en'), page));
  const de = shapeOf(path.join(dirFor('de'), page));
  eq(en.headings, de.headings, `${page}: same headings, at the same levels`);

  // Info strings, not bodies: an example belongs on both pages, but its
  // comments and placeholders are translated — /path against /pfad, and
  // "# archives" against "# Archive".
  eq(en.fences, de.fences, `${page}: same examples, in the same order`);
}

// ── both carry what the site index reads off them ─────────────────────
for (const page of pages) {
  for (const lang of LANGS) {
    const front = frontmatter(path.join(dirFor(lang), page));
    ok(front.title && front.description,
       `${lang}/${page}: has a title and a description`);
  }
}

// Callouts and links look like candidates for this and are deliberately left
// out. impressum.qmd and privacy.qmd carry a note in English that they do not
// in German — that a German version exists, and that it is the authoritative
// one — which is a consequence of the site being bilingual rather than a lapse
// in it. A rule that called those a fault would be a rule people learn to work
// around, and the exemption list it needed would go stale unwatched.

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
