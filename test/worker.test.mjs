// The renderer runs where nothing can be inspected: inside a ChromeWorker,
// against a build of pdf.js that Zotero has modified. Every requirement below
// was found by watching it fail, and each fails in a way that gives no hint —
// a blank sheet, black bars instead of text, missing highlights, or a throw
// from deep inside pdf.js. Dropping one while moving code around is exactly
// how the sheet broke once already, so they are checked in the source, which
// is the only place they can be checked without Zotero running.

import fs from 'node:fs';
import { ADDON } from './load.mjs';

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log((c ? 'ok  ' : 'FAIL') + '  ' + l); };

const src = fs.readFileSync(ADDON + 'render.worker.js', 'utf8');

// ── or pdf.js throws before it reads a single byte ────────────────────
ok(/GlobalWorkerOptions\.workerSrc\s*=/.test(src),
   'workerSrc is set, without which getDocument throws immediately');

// ── or pdf.js reaches for document, which a worker has not got ────────
ok(/CanvasFactory:\s*\w+/.test(src),
   'a canvas factory is passed under the capital name pdf.js reads');
ok(/FilterFactory:\s*\w+/.test(src),
   'and a filter factory, for the same reason');
ok(/new OffscreenCanvas\(/.test(src),
   'and it hands out OffscreenCanvas, the only kind a worker can make');

// ── or every glyph comes out as a black bar ───────────────────────────
ok(/disableFontFace:\s*true/.test(src),
   'font faces are disabled, since a worker has no FontFace registry');
ok(/standardFontDataUrl:/.test(src) && /cMapUrl:/.test(src) && /wasmUrl:/.test(src),
   'and the fonts, character maps and wasm Zotero ships are pointed at');

// ── or pdf.js works it out from document.baseURI and throws ───────────
ok(/useWorkerFetch:\s*false/.test(src),
   'worker fetch is stated rather than inferred');

// ── or Zotero's highlights are silently dropped ───────────────────────
ok(/intent:\s*"display"/.test(src) && !/intent:\s*"print"/.test(src),
   'pages render under display intent, not print');
ok(/globalCompositeOperation/.test(src) && /multiply/.test(src),
   "highlights are drawn by hand under multiply, because Zotero's build of "
   + 'pdf.js will not paint them onto a canvas at all');
ok(/getAnnotations\(/.test(src),
   'from the annotation data, which does still come through');

// ── or the contents menu is empty ─────────────────────────────────────
ok(/getOutline\(/.test(src),
   "the document's outline is read, since only this side has the document");
ok(/getPageIndex\(/.test(src) && /getDestination\(/.test(src),
   'and its destinations are resolved to pages, named ones included');

// ── the plugin has to be able to reach it ─────────────────────────────
const plugin = fs.readFileSync(ADDON + 'zotlook.js', 'utf8');
ok(/render\.worker\.js/.test(plugin), 'the plugin names the worker file');
ok(/resource:\/\/zotlook\//.test(plugin),
   'and reaches it through a resource alias, the only scheme a worker accepts');
ok(/_dropResourceAlias/.test(plugin), 'which is given back on shutdown');

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
