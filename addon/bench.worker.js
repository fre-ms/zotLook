
/* global OffscreenCanvas */

// TEMPORARY — measurement prototype for the portable pdf.js renderer.
// Renders pages with the pdf.js build Zotero already ships and reports how
// long each step takes, so the choice between the Swift renderer and a
// portable one can be made on numbers rather than expectation.

const PDF_JS = "resource://zotero/reader/pdf/build/pdf.mjs";
const PDF_WORKER = "resource://zotero/reader/pdf/build/pdf.worker.mjs";

let pdfjs = null;

async function loadPdfjs() {
	if (pdfjs) return pdfjs;
	pdfjs = await import(PDF_JS);
	// pdf.js normally spawns a worker of its own; inside a worker that would be
	// a nested one. Point it at the shipped build and let it decide.
	// If this throws, pdf.js falls back to rendering on this thread, which is
	// fine for a measurement
	// If setting this throws, pdf.js falls back to rendering on this thread,
	// which is fine for a measurement
	try {
		pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
	} catch (e) {
		// deliberately ignored
		void e;
	}
	return pdfjs;
}

self.addEventListener("message", async (event) => {
	let { data, maxPages, width, quality } = event.data;
	let report = { ok: false, steps: {}, pages: [], sample: null, error: null };

	try {
		let t0 = Date.now();
		let lib = await loadPdfjs();
		report.steps.importMs = Date.now() - t0;
		report.version = lib.version || "unknown";

		let t1 = Date.now();
		let doc = await lib.getDocument({ data: data, isEvalSupported: false }).promise;
		report.steps.openMs = Date.now() - t1;
		report.pageCount = doc.numPages;

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
			await page.render({
				canvasContext: ctx,
				viewport: scaled,
				intent: "print",
				annotationMode: 2,
			}).promise;

			let blob = await canvas.convertToBlob({
				type: "image/jpeg",
				quality: quality,
			});
			report.pages.push({ page: i, ms: Date.now() - tp, bytes: blob.size });

			if (i === 1) {
				report.sample = await blob.arrayBuffer();
			}
			page.cleanup();
		}

		report.steps.totalMs = Date.now() - t0;
		report.ok = true;
	} catch (e) {
		report.error = String(e && e.stack ? e.stack : e);
	}

	self.postMessage(report, report.sample ? [report.sample] : []);
});
