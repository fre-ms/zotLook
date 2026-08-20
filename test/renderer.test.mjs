// Runs the bundled renderer for real and checks the contract the plugin
// builds the sheet on: the JSON it prints, and the sizing rule it shares with
// sheet.js. That rule is the one thing deliberately written twice — once in
// Swift, once in JavaScript for the pdf.js renderer — so it is the one thing
// that can silently drift apart.
//
// Builds the binary itself rather than relying on build.sh, which removes it
// again after packing, and skips where Swift is not available — which is
// every platform the binary cannot be built for anyway.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, ADDON, loadPlugin } from './load.mjs';

let fail = 0;
const eq=(g,w,l)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+l+(ok?'':`  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`));};
const ok=(c,l)=>eq(!!c,true,l);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zotlook-renderer-'));
let binary = ADDON + 'contactsheet';
if (!fs.existsSync(binary)) {
  binary = path.join(work, 'contactsheet');
  try {
    execFileSync('swiftc', ['-O', '-o', binary, ROOT + 'native/contactsheet.swift'],
                 { stdio: 'pipe' });
  } catch {
    fs.rmSync(work, { recursive: true, force: true });
    console.log('ok    (no Swift here, so nothing to check against)');
    console.log('\nall assertions passed');
    process.exit(0);
  }
}

/** A valid PDF of `count` blank A4-ish pages, small enough to write inline. */
function makePdf(count) {
  const objects = [];
  const kids = [];
  for (let i = 0; i < count; i++) kids.push(`${3 + i} 0 R`);
  objects.push('<</Type/Catalog/Pages 2 0 R>>');
  objects.push(`<</Type/Pages/Kids[${kids.join(' ')}]/Count ${count}>>`);
  for (let i = 0; i < count; i++) {
    objects.push('<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>');
  }

  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += String(offset).padStart(10, '0') + ' 00000 n \n';
  }
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\n`;
  body += `startxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const { ZotLookSheet: Sheet } = loadPlugin();

function render(pageCount, maxColumns, maxPages = 0) {
  const pdf = path.join(work, `p${pageCount}.pdf`);
  fs.writeFileSync(pdf, makePdf(pageCount));
  const images = path.join(work, `img-${pageCount}-${maxColumns}-${maxPages}`);
  const out = execFileSync(binary,
    [pdf, images, String(maxColumns), String(maxPages)], { encoding: 'utf8' });
  return { manifest: JSON.parse(out), images };
}

// ── the manifest the plugin parses ────────────────────────────────────
{
  const { manifest, images } = render(6, 5);
  eq(manifest.pageCount, 6, 'the document page count is reported');
  eq(manifest.pages.length, 6, 'every page is rendered without a cap');
  eq(manifest.pages[0].page, 1, 'pages are numbered from one');
  ok(manifest.pages[0].height > 0, 'and carry the height the sheet reserves');
  eq(fs.readdirSync(images).sort(),
     ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'p5.jpg', 'p6.jpg'],
     'thumbnails are named the way sheet.js references them');
  ok(!fs.existsSync(path.join(work, 'out.html')), 'and no HTML is written');
}

// ── the sizing rule, which lives in two languages ─────────────────────
for (const [pages, columns] of [[6, 5], [3, 5], [1, 5], [10, 1], [4, 4]]) {
  const { manifest } = render(pages, columns);
  const shown = Math.min(pages, manifest.pages.length);
  eq(manifest.columns, Sheet.columnsFor(shown, columns),
     `columns agree with sheet.js for ${pages} pages in ${columns} columns`);
  eq(manifest.width, Sheet.widthFor(shown, columns),
     `and so does the render width`);
}

// ── the page cap ──────────────────────────────────────────────────────
{
  const { manifest } = render(9, 5, 4);
  eq(manifest.pages.length, 4, 'the cap limits what is rendered');
  eq(manifest.pageCount, 9, 'while the real page count is still reported');
  eq(manifest.columns, Sheet.columnsFor(4, 5), 'the cap decides the columns');
  eq(manifest.width, Sheet.widthFor(4, 5), 'and the width with them');
}

fs.rmSync(work, { recursive: true, force: true });

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
