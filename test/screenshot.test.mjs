// The images the README and the documentation point at.
//
// A renamed or forgotten screenshot breaks nothing that any other test would
// notice: the build succeeds, the page renders, and only a reader sees the
// missing picture. These are cheap checks against exactly that.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const PLATFORMS = ['macos', 'linux', 'windows'];
const VIEWS = ['preview', 'contact-sheet', 'contact-sheet-window'];

// ── one screenshot per platform and per keystroke ─────────────────────
for (const platform of PLATFORMS) {
  for (const view of VIEWS) {
    const rel = `asset/screenshot/${platform}-${view}.png`;
    ok(fs.existsSync(ROOT + rel), `${rel} exists`);
  }
}

// ── and every one of them a resized copy ──────────────────────────────
// The originals are 1–3 MB each and live in a subdirectory git never sees.
// Checked over whatever is actually there rather than over the names above,
// so a picture added later is held to the same limit.
{
  const dir = ROOT + 'asset/screenshot';
  const shots = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  ok(shots.length >= 9, `the repository carries ${shots.length} screenshots`);
  for (const shot of shots) {
    const kb = Math.round(fs.statSync(path.join(dir, shot)).size / 1024);
    ok(kb < 500, `${shot} is a web-sized copy (${kb} KB)`);
  }
}

// ── the social preview points at something that is there ──────────────
// It is named once per language in a place nothing else touches, so a
// renamed picture leaves a broken og:image and no other symptom.
for (const lang of ['de', 'en']) {
  const cfg = fs.readFileSync(`${ROOT}doc/${lang}/_quarto.yml`, 'utf8');
  const named = cfg.match(/^\s{2}image:\s*(\S+)/m);
  ok(named, `${lang}: a preview image is configured`);
  if (named) ok(fs.existsSync(ROOT + named[1]),
                `${lang}: ${named[1]} exists`);
}

/** Every local image a markdown or Quarto source points at. */
function imagesIn(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [
    ...[...src.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]),
    ...[...src.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]),
    ...[...src.matchAll(/<a[^>]*\shref="([^"]+\.(?:png|jpe?g|svg))"/g)].map(m => m[1]),
  ].filter(u => !/^(https?:|data:|\/)/.test(u));
}

// ── nothing points at a picture that is not there ─────────────────────
{
  const readme = imagesIn(ROOT + 'README.md');
  ok(readme.length >= 9, `the README carries the gallery (${readme.length} images)`);
  for (const rel of new Set(readme)) {
    ok(fs.existsSync(ROOT + rel), `README: ${rel} exists`);
  }
}
{
  // Documentation pages resolve against their own language directory, into
  // which build.sh mirrors ../asset
  for (const lang of ['de', 'en']) {
    const dir = ROOT + 'doc/' + lang;
    const pages = fs.readdirSync(dir, { recursive: true })
      .filter(f => f.endsWith('.qmd'));
    let checked = 0;
    for (const page of pages) {
      for (const rel of new Set(imagesIn(path.join(dir, page)))) {
        const source = ROOT + rel; // asset/… comes from the repository root
        if (!fs.existsSync(source)) {
          fail++;
          console.log(`FAIL  ${lang}/${page}: ${rel} exists in asset/`);
        }
        checked++;
      }
    }
    ok(checked > 0, `${lang}: pages reference ${checked} images, all present`);
  }
}

// ── both languages show the same pictures ─────────────────────────────
// The site is bilingual to the same depth everywhere else; a gallery in one
// language only would be the kind of drift nothing else reports.
{
  const setFor = (lang) => {
    const dir = ROOT + 'doc/' + lang;
    const out = new Set();
    for (const page of fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.qmd'))) {
      for (const rel of imagesIn(path.join(dir, page))) out.add(rel);
    }
    return [...out].sort();
  };
  eq(setFor('de'), setFor('en'), 'de and en illustrate the same things');
}

// ── the originals stay out of what is published ───────────────────────
// They are 15 MB, they are excluded from git, and the language mirror would
// otherwise carry them into the site twice over.
{
  // Continuations joined first: the check used to read one line and find
  // the exclusion on it, which stopped being true the moment the command
  // was wrapped — and a guard that a line break can switch off is not one.
  const build = fs.readFileSync(ROOT + 'doc/build.sh', 'utf8')
    .replace(/\\\n\s*/g, ' ');
  const mirror = build.split('\n').find(l => l.includes('../asset/'));
  ok(mirror, 'build.sh mirrors asset/ into the language projects');
  ok(/--exclude\s+"screenshot\/original\/"/.test(mirror),
     'and keeps screenshot/original out of it');
  // macOS leaves undeletable tombstones beside files deleted in the Finder;
  // rsync stops on one, so every mirror here has to skip them or a build
  // fails over a file nobody wanted
  for (const line of build.split('\n').filter(l => l.startsWith('  rsync'))) {
    ok(/--exclude\s+"\*\.gitFinderDeleted"/.test(line),
       'each mirror skips the macOS tombstones: ' + line.trim().slice(0, 58));
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
