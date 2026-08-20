/* global OffscreenCanvas */

// Page renderer for platforms the bundled binary cannot be built for.
//
// Renders with the pdf.js build Zotero already ships, so nothing is
// downloaded and nothing has to be compiled. Costs about three times the CPU
// per page of the PDFKit renderer, which is why macOS keeps that one; here it
// is the difference between having a contact sheet and not having one.
//
// Loaded as a module worker, and reachable only through the resource: alias
// the plugin registers: the worker constructor rejects both jar: and file:.
//
// Measured on a 30-page article at 500 px: pdf.js imports in 24 ms, the
// document opens in 59 ms, and pages render in 21 ms each — 31 ms with the
// annotation drawing below.

import * as pdfjs from "resource://zotero/reader/pdf/build/pdf.mjs";

const PDF_WEB = "resource://zotero/reader/pdf/web/";

// pdf.js takes these as classes and constructs them itself. Its own defaults
// reach for document, which a worker has not got.
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

// Zotero's build of pdf.js keeps a list of annotation subtypes it will paint
// onto a canvas, and Highlight is not on it — nor are Zotero's own area and
// ink annotations, which it excludes by name. Its reader draws them in an
// HTML layer instead, so the canvas never sees them however it is asked.
// getAnnotations still returns the data, so they are drawn here.
const QUAD_TYPES = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);

function drawAnnotations(ctx, viewport, annotations) {
	for (let a of annotations) {
		let colour = a.color
			? "rgb(" + a.color[0] + "," + a.color[1] + "," + a.color[2] + ")"
			: "rgb(255,255,0)";

		if (QUAD_TYPES.has(a.subtype) && a.quadPoints) {
			ctx.save();
			// Multiply is what a marker pen does: the text stays readable
			// through it, which painting over it would not manage.
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

async function open(data) {
	return pdfjs.getDocument({
		data: data,
		isEvalSupported: false,
		CanvasFactory: OffscreenCanvasFactory,
		FilterFactory: NoFilterFactory,

		// A worker has no FontFace registry, so pdf.js has to draw glyph
		// outlines itself. Left at its default it renders text as blocks.
		disableFontFace: true,
		useSystemFonts: false,

		// Zotero ships the substitution fonts, character maps and wasm the
		// renderer falls back on
		standardFontDataUrl: PDF_WEB + "standard_fonts/",
		cMapUrl: PDF_WEB + "cmaps/",
		cMapPacked: true,
		wasmUrl: PDF_WEB + "wasm/",

		// Stated outright: pdf.js would otherwise work this out from
		// document.baseURI, which does not exist here
		useWorkerFetch: false,
	}).promise;
}

/**
 * Renders one page and hands the JPEG back. Pages are posted one at a time so
 * the main thread can write each to disk as it arrives — a long book held in
 * memory all at once is what the file-per-page layout exists to avoid.
 */
async function renderPage(doc, number, width, quality) {
	let page = await doc.getPage(number);
	let unit = page.getViewport({ scale: 1 });
	let viewport = page.getViewport({ scale: width / unit.width });
	let height = Math.ceil(viewport.height);

	let canvas = new OffscreenCanvas(Math.ceil(viewport.width), height);
	let ctx = canvas.getContext("2d");
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	await page.render({
		canvasContext: ctx,
		viewport: viewport,
		intent: "display",
		annotationMode: 1,
	}).promise;

	drawAnnotations(ctx, viewport, await page.getAnnotations({
		intent: "display",
	}));

	let blob = await canvas.convertToBlob({
		type: "image/jpeg",
		quality: quality,
	});
	page.cleanup();

	return { height: height, buffer: await blob.arrayBuffer() };
}

// Two steps, because the page count decides the column count, which decides
// the width to render at — and only this side knows the page count.
let document = null;

self.addEventListener("message", async (event) => {
	let message = event.data;

	try {
		if (message.type === "open") {
			document = await open(message.data);
			self.postMessage({ type: "opened", pageCount: document.numPages });
			return;
		}

		if (message.type === "render") {
			for (let number of message.pages) {
				if (number > document.numPages) break;
				try {
					let out = await renderPage(
						document,
						number,
						message.width,
						message.quality
					);
					self.postMessage(
						{
							type: "page",
							page: number,
							height: out.height,
							buffer: out.buffer,
						},
						[out.buffer]
					);
				} catch (e) {
					// One unrenderable page must not cost the whole sheet
					self.postMessage({
						type: "page-failed",
						page: number,
						error: String(e),
					});
				}
			}
			self.postMessage({ type: "done" });
			if (document) {
				await document.destroy();
				document = null;
			}
		}
	} catch (e) {
		self.postMessage({
			type: "failed",
			error: String(e && e.stack ? e.stack : e),
		});
	}
});
