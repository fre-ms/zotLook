
/* global OffscreenCanvas */

// TEMPORARY — measurement prototype for the portable pdf.js renderer.
// Renders pages with the pdf.js build Zotero already ships and reports how
// long each step takes, so the choice between the Swift renderer and a
// portable one can be made on numbers rather than expectation.
//
// Spawned as a module worker: a classic worker may not import() at all.

const PDF_JS = "resource://zotero/reader/pdf/build/pdf.mjs";
const PDF_WORKER = "resource://zotero/reader/pdf/build/pdf.worker.mjs";
const PDF_WEB = "resource://zotero/reader/pdf/web/";

let pdfjs = null;

async function loadPdfjs() {
	if (pdfjs) return pdfjs;
	pdfjs = await import(PDF_JS);
	// pdf.js normally spawns a worker of its own; inside a worker that would
	// be a nested one. Point it at the shipped build and let it decide. If
	// that throws, pdf.js renders on this thread, which is fine to measure.
	try {
		pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
	} catch (e) {
		// deliberately ignored
		void e;
	}
	return pdfjs;
}

// pdf.js takes these as classes and constructs them itself, under the names
// CanvasFactory and FilterFactory — an instance under a lower-case name is
// silently ignored, which is what let the first attempt fail unchanged.
//
// The canvas one is what matters: pdf.js creates scratch canvases for scaling
// inline images, and its default reaches for document, which a worker has not
// got. The filter one only avoids the same trap for soft masks; returning
// "none" is what the shipped base class does anyway.
class OffscreenCanvasFactory {
	constructor({ enableHWA = false } = {}) {
		this._willReadFrequently = !enableHWA;
	}

	create(width, height) {
		if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
		let canvas = new OffscreenCanvas(width, height);
		return {
			canvas: canvas,
			context: canvas.getContext("2d", {
				willReadFrequently: this._willReadFrequently,
			}),
		};
	}

	reset(entry, width, height) {
		if (!entry.canvas) throw new Error("Canvas is not specified");
		if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
		entry.canvas.width = width;
		entry.canvas.height = height;
	}

	destroy(entry) {
		if (!entry.canvas) throw new Error("Canvas is not specified");
		entry.canvas.width = entry.canvas.height = 0;
		entry.canvas = null;
		entry.context = null;
	}
}

class NoFilterFactory {
	addFilter() {
		return "none";
	}
	addHCMFilter() {
		return "none";
	}
	addAlphaFilter() {
		return "none";
	}
	addLuminosityFilter() {
		return "none";
	}
	addHighlightHCMFilter() {
		return "none";
	}
	destroy() {}
}

// Zotero's build of pdf.js refuses to paint highlights onto the canvas at
// all: pdf.worker.mjs keeps a list of allowed annotation subtypes and
// Highlight is not on it, because Zotero's reader draws them in an HTML layer
// of its own instead. The data still comes through getAnnotations, so a
// portable renderer has to draw them itself. This is that drawing.
const QUAD_TYPES = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);

function drawAnnotations(ctx, viewport, annotations) {
	for (let a of annotations) {
		let colour = a.color
			? "rgb(" + a.color[0] + "," + a.color[1] + "," + a.color[2] + ")"
			: "rgb(255,255,0)";

		if (QUAD_TYPES.has(a.subtype) && a.quadPoints) {
			ctx.save();
			// Multiply is what a marker pen does: the text stays readable
			// through it, which plain painting over would not manage.
			ctx.globalCompositeOperation =
				a.subtype === "Highlight" ? "multiply" : "source-over";
			ctx.globalAlpha = typeof a.opacity === "number" ? a.opacity : 1;
			ctx.fillStyle = colour;

			// Eight numbers per quad, corners in the order pdf.js normalises
			// them to: top-left, top-right, bottom-left, bottom-right
			for (let i = 0; i + 7 < a.quadPoints.length; i += 8) {
				let tl = viewport.convertToViewportPoint(
					a.quadPoints[i],
					a.quadPoints[i + 1]
				);
				let br = viewport.convertToViewportPoint(
					a.quadPoints[i + 6],
					a.quadPoints[i + 7]
				);
				let x = Math.min(tl[0], br[0]);
				let y = Math.min(tl[1], br[1]);
				let w = Math.abs(br[0] - tl[0]);
				let h = Math.abs(br[1] - tl[1]);
				let rule = Math.max(1, h * 0.08);

				if (a.subtype === "Highlight") {
					ctx.fillRect(x, y, w, h);
				} else if (a.subtype === "StrikeOut") {
					ctx.fillRect(x, y + h / 2 - rule / 2, w, rule);
				} else {
					ctx.fillRect(x, y + h - rule, w, rule);
				}
			}
			ctx.restore();
			continue;
		}

		// Zotero's own area and ink annotations are excluded by the same
		// filter, on the isZotero flag
		if (a.subtype === "Square" && a.rect) {
			let p1 = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
			let p2 = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
			ctx.save();
			ctx.strokeStyle = colour;
			ctx.lineWidth = 2;
			ctx.strokeRect(
				Math.min(p1[0], p2[0]),
				Math.min(p1[1], p2[1]),
				Math.abs(p2[0] - p1[0]),
				Math.abs(p2[1] - p1[1])
			);
			ctx.restore();
		} else if (a.subtype === "Ink" && a.inkLists) {
			ctx.save();
			ctx.strokeStyle = colour;
			ctx.lineWidth = Math.max(1, a.borderStyle?.width || 1);
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (let stroke of a.inkLists) {
				ctx.beginPath();
				for (let i = 0; i + 1 < stroke.length; i += 2) {
					let pt = viewport.convertToViewportPoint(
						stroke[i],
						stroke[i + 1]
					);
					if (i === 0) ctx.moveTo(pt[0], pt[1]);
					else ctx.lineTo(pt[0], pt[1]);
				}
				ctx.stroke();
			}
			ctx.restore();
		}
	}
}

// Each stage is reported as it is reached. A run that stops says where it
// stopped, which a single message at the end cannot.
function stage(name, extra) {
	self.postMessage(Object.assign({ stage: name }, extra || {}));
}

stage("worker running");

self.addEventListener("message", async (event) => {
	let report = { ok: false, stage: "done", steps: {}, pages: [], error: null };
	let samples = [];

	try {
		let payload = event.data || {};
		let { data, maxPages, width, quality, samplePages } = payload;
		let wanted = new Set(samplePages || [1]);
		stage("message received", { bytes: data ? data.byteLength : null });
		if (!data) throw new Error("no PDF data in the message");

		let t0 = Date.now();
		let lib = await loadPdfjs();
		report.steps.importMs = Date.now() - t0;
		report.version = lib.version || "unknown";
		stage("pdf.js imported", {
			importMs: report.steps.importMs,
			version: report.version,
		});

		let t1 = Date.now();
		let doc = await lib.getDocument({
			data: data,
			isEvalSupported: false,
			CanvasFactory: OffscreenCanvasFactory,
			FilterFactory: NoFilterFactory,

			// A worker has no FontFace registry, so pdf.js has to draw glyph
			// outlines itself. Left at its default it renders text as blocks.
			disableFontFace: true,
			useSystemFonts: false,

			// Zotero ships the substitution fonts, character maps and wasm the
			// renderer falls back on; without these, anything with an unusual
			// encoding or a JPEG 2000 image would come out wrong.
			standardFontDataUrl: PDF_WEB + "standard_fonts/",
			cMapUrl: PDF_WEB + "cmaps/",
			cMapPacked: true,
			wasmUrl: PDF_WEB + "wasm/",

			// Stated outright: pdf.js would otherwise work this out from
			// document.baseURI, which does not exist here.
			useWorkerFetch: false,
		}).promise;
		report.steps.openMs = Date.now() - t1;
		report.pageCount = doc.numPages;
		stage("document opened", {
			openMs: report.steps.openMs,
			pageCount: report.pageCount,
		});

		let count = Math.min(doc.numPages, maxPages);
		for (let i = 1; i <= count; i++) {
			let tp = Date.now();
			let page = await doc.getPage(i);
			let viewport = page.getViewport({ scale: 1 });
			let scale = width / viewport.width;
			let scaled = page.getViewport({ scale: scale });

			let canvas = new OffscreenCanvas(
				Math.ceil(scaled.width),
				Math.ceil(scaled.height)
			);
			let ctx = canvas.getContext("2d");
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			// Annotations are what this whole exercise is about, so render them
			// Not print intent: pdf.js only paints an annotation for printing
			// when its PRINT flag is set, and Zotero's exported highlights
			// carry no flags at all — under which pdf.js treats them as
			// viewable but not printable, so they vanish without a word.
			await page.render({
				canvasContext: ctx,
				viewport: scaled,
				intent: "display",
				annotationMode: 1,
			}).promise;

			let annots = await page.getAnnotations({ intent: "display" });
			drawAnnotations(ctx, scaled, annots);
			if (i === 1) report.annotationCount = annots.length;

			let blob = await canvas.convertToBlob({
				type: "image/jpeg",
				quality: quality,
			});
			report.pages.push({ page: i, ms: Date.now() - tp, bytes: blob.size });

			if (wanted.has(i)) {
				samples.push({ page: i, buffer: await blob.arrayBuffer() });
				stage("page " + i + " rendered", { ms: report.pages[i - 1].ms });
			}
			page.cleanup();
		}

		report.steps.totalMs = Date.now() - t0;
		report.ok = true;
	} catch (e) {
		report.error = String(e && e.stack ? e.stack : e);
	}

	report.samples = samples;
	self.postMessage(
		report,
		samples.map((s) => s.buffer)
	);
});
