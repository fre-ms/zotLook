// The contact sheet's markup and the sizing behind it.
//
// Kept apart from the rendering so that the grid, the labels and the reader
// links can be changed and tested without a PDF anywhere in sight.

var ZotLookSheet = {
	/** Thumbnail width for a single column, before the column count widens it. */
	BASE_WIDTH: 500,

	/**
	 * Columns actually used: a three-page PDF asked to fill five columns
	 * looks better in three, so the grid never has more columns than pages.
	 */
	columnsFor(pageCount, maxColumns) {
		return Math.max(1, Math.min(pageCount, maxColumns));
	},

	/**
	 * Pixel width to render at. Fewer columns means each thumbnail is shown
	 * larger, so it needs more pixels to stay sharp.
	 */
	widthFor(pageCount, maxColumns) {
		let columns = this.columnsFor(pageCount, maxColumns);
		return Math.round((this.BASE_WIDTH * Math.max(1, maxColumns)) / columns);
	},

	/** The directory the thumbnails live in, named after the sheet itself. */
	imageDirName(outputName) {
		return String(outputName).replace(/\.html?$/i, "") + "_pages";
	},

	escape(value) {
		return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	},

	/**
	 * @param {object} spec
	 * @param {Array<{page: number, height: number}>} spec.pages Rendered pages,
	 *   in order. A page the renderer could not draw is simply absent.
	 * @param {number} spec.columns Grid columns.
	 * @param {number} spec.width Rendered pixel width of a thumbnail.
	 * @param {string} spec.imageDir Directory name the thumbnails live in.
	 * @param {number} spec.pageCount Pages in the document.
	 * @param {string} [spec.linkBase] Reader link; thumbnails are not
	 *   clickable without one.
	 * @param {string} [spec.notice] Shown when not every page was rendered.
	 * @returns {string} A complete HTML document.
	 */
	html(spec) {
		let pages = spec.pages || [];
		let linkBase = spec.linkBase || "";
		let body = "";

		for (let entry of pages) {
			// width and height reserve the box before the image arrives, so
			// lazy loading does not make the grid jump while scrolling
			let thumb =
				'<img src="' +
				this.escape(spec.imageDir) +
				"/p" +
				entry.page +
				'.jpg" loading="lazy" width="' +
				spec.width +
				'" height="' +
				entry.height +
				'">\n<div class="label">' +
				entry.page +
				"</div>";
			let inner = linkBase
				? '<a href="' +
					this.escape(linkBase) +
					"?page=" +
					entry.page +
					'">' +
					thumb +
					"</a>"
				: thumb;
			body += '<div class="page">\n' + inner + "</div>\n\n";
		}

		let notice = spec.notice
			? '<p class="notice">' + this.escape(spec.notice) + "</p>\n"
			: "";

		return (
			"<!DOCTYPE html>\n" +
			"<html>\n<head>\n" +
			'<meta charset="UTF-8">\n' +
			"<title>Contact Sheet</title>\n" +
			"<style>\n" +
			"body {\n" +
			"    background: #f0f0f0;\n" +
			"    margin: 0;\n" +
			"    padding: 12px;\n" +
			"    font-family: -apple-system, BlinkMacSystemFont, sans-serif;\n" +
			"}\n" +
			".grid {\n" +
			"    display: grid;\n" +
			"    grid-template-columns: repeat(" +
			spec.columns +
			", 1fr);\n" +
			"    gap: 12px;\n" +
			"}\n" +
			".page {\n" +
			"    background: white;\n" +
			"    box-shadow: 0 1px 4px rgba(0,0,0,0.2);\n" +
			"    text-align: center;\n" +
			"    overflow: hidden;\n" +
			"}\n" +
			".page img {\n" +
			"    width: 100%;\n" +
			"    height: auto;\n" +
			"    display: block;\n" +
			"}\n" +
			".page a {\n" +
			"    text-decoration: none;\n" +
			"    color: inherit;\n" +
			"    display: block;\n" +
			"}\n" +
			".page .label {\n" +
			"    font-size: 11px;\n" +
			"    color: #666;\n" +
			"    padding: 4px 0;\n" +
			"}\n" +
			".notice {\n" +
			"    font-size: 13px;\n" +
			"    color: #666;\n" +
			"    text-align: center;\n" +
			"    padding: 12px 0 0 0;\n" +
			"}\n" +
			"</style>\n" +
			"</head>\n<body>\n" +
			'<div class="grid">\n\n' +
			body +
			"</div>\n" +
			notice +
			"</body>\n</html>"
		);
	},
};
