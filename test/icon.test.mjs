// Guards the two ways a plugin icon silently disappears: a manifest that names
// a file the XPI does not carry, and an SVG that paints itself with
// context-fill, which Gecko only resolves for images from chrome: and
// resource: URIs — never for one loaded out of a plugin's XPI.
import fs from 'node:fs';
import { ADDON } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const man = JSON.parse(fs.readFileSync(ADDON+'manifest.json','utf8'));
const zotlook = fs.readFileSync(ADDON+'zotlook.js','utf8');

// ── the add-ons window reads these straight out of the manifest ───────
const sizes = Object.keys(man.icons);
ok(sizes.length > 0, 'the manifest declares icons');
ok(sizes.includes('32'), 'including 32, the size the add-ons list draws');
ok(sizes.includes('96'), 'and 96, which covers that list at 2x');

// ── the preference pane names one too ─────────────────────────────────
const image = zotlook.match(/image:\s*this\.rootURI\s*\+\s*"([^"]+)"/);
ok(image, 'the preference pane registers an image');

const declared = [...Object.values(man.icons), ...(image ? [image[1]] : [])];
for (const rel of declared) {
  const path = ADDON + rel;
  if (!fs.existsSync(path)) { eq(false, true, `${rel} ships`); continue; }
  ok(true, `${rel} ships`);
  const svg = fs.readFileSync(path, 'utf8');

  // context-fill would leave the icon blank outside chrome:. Matching the
  // paint rather than the word keeps a comment that explains why from
  // tripping the check.
  eq(/fill\s*[:=]\s*"?context-fill/.test(svg), false,
     `${rel} paints itself, not by context`);

  // a viewBox that disagrees with the file's name is the usual cause of a
  // blurry icon: the renderer scales a grid that was drawn for another size
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  ok(box, `${rel} declares a viewBox from the origin`);
  if (box) {
    const named = rel.match(/-(\d+)\.svg$/);
    eq(box[1], box[2], `${rel} is square`);
    if (named) eq(box[1], named[1], `${rel} is drawn on its own pixel grid`);
  }

  // opacity over nothing goes translucent wherever a background is dark;
  // every tile has to carry its own colour
  eq(/<svg[^>]*opacity/.test(svg), false, `${rel} sets no opacity on the root`);
}

// ── the mark itself: four rows of four, ten of them marked ────────────
// A stroked tile is drawn half a stroke inside its cell, so that the contour
// lands within the grid rather than across the gap. Comparing outer edges is
// therefore what tells a well-aligned grid from a crooked one.
for (const rel of declared) {
  const svg = fs.readFileSync(ADDON + rel, 'utf8');
  const box = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
  const tiles = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*?(?:stroke-width="([\d.]+)")?\/>/g)]
    .map(m => {
      const half = (+m[4] || 0) / 2;
      return { x: +m[1] - half, y: +m[2] - half, w: +m[3] + half * 2 };
    });
  const cell = Math.max(...tiles.map(t => t.w));
  const grid = tiles.filter(t => t.w === cell);
  eq(grid.length, 16, `${rel}: sixteen page tiles`);
  eq(new Set(grid.map(t => t.x)).size, 4, `${rel}: four columns`);
  eq(new Set(grid.map(t => t.y)).size, 4, `${rel}: four rows`);
  const rows = [...new Set(grid.map(t => t.y))].sort((a, b) => a - b);
  const cols = [...new Set(grid.map(t => t.x))].sort((a, b) => a - b);
  eq(cols, rows, `${rel}: rows and columns sit on the same measure`);
  eq(box - (cols[3] + cell), cols[0], `${rel}: the grid is centred in the viewBox`);
  const step = cols[1] - cols[0];
  eq([cols[2] - cols[1], cols[3] - cols[2]], [step, step], `${rel}: even gaps`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
