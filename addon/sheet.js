/* global Zotero */

// The contact sheet's markup and the sizing behind it — and the two corner
// menus the EPUB preview and both page sheets share.
//
// Kept apart from the rendering so that the grid, the labels and the reader
// links can be changed and tested without a PDF anywhere in sight.

var zotLookSheet = {
	/** Thumbnail width for a single column, before the column count widens it. */
	BASE_WIDTH: 500,

	/** Heading of the contents menu; the host writes the locale's in. */
	TOC_LABEL: "Contents",
	/** Heading of the annotations menu, likewise. */
	ANNOTATIONS_LABEL: "Annotations",
	/** "Page 12", the link an annotation entry carries. */
	PAGE_LABEL: "Page",
	/** What an annotation with nothing to quote and nothing said is called. */
	TYPE_LABELS: { note: "Note", image: "Image", ink: "Ink", text: "Text" },

	log(msg) {
		Zotero.debug("zotLook/sheet: " + msg);
	},

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

	/** Whitespace as a reader sees it, for the lists. */
	collapse(value) {
		return String(value).replace(/\s+/g, " ").trim();
	},

	// ── Colours ───────────────────────────────────────────────────────

	/**
	 * The colour to paint with.
	 *
	 * Zotero's own palette is eight colours, but the field holds a string and
	 * plugins put their own in it — zotQDA's palettes among them. Every one
	 * seen in practice is a six-digit hex, which is what Zotero's reader also
	 * requires: it appends the alpha as two more digits, exactly as here.
	 *
	 * A three-digit form is written out first, or the alpha would land inside
	 * the colour and change it. Anything else is passed on untouched and
	 * without an alpha: an unexpected notation should show the wrong opacity
	 * at worst, never the wrong colour.
	 */
	annotationColour(value) {
		let colour = String(value || "").trim();
		if (!colour) return { value: "#ffd400", hex: true };
		if (/^#[0-9a-f]{3}$/i.test(colour)) {
			return {
				value:
					"#" +
					colour
						.slice(1)
						.split("")
						.map((c) => c + c)
						.join(""),
				hex: true,
			};
		}
		if (/^#[0-9a-f]{6}$/i.test(colour)) return { value: colour, hex: true };
		// Eight digits already carry their own alpha
		if (/^#[0-9a-f]{8}$/i.test(colour)) return { value: colour, hex: false };
		this.log("Unfamiliar annotation colour, used as given: " + colour);
		return { value: colour, hex: false };
	},

	/** The colour at half opacity, by the same means Zotero uses: the alpha
	 *  as two more hex digits, where the notation allows it. */
	halfOpaque(colour) {
		return colour.hex ? colour.value + "80" : colour.value;
	},

	/**
	 * How an annotation is drawn — as Zotero draws it, not as it seemed
	 * reasonable to draw it.
	 *
	 * Its reader renders an annotation in flowing text this way:
	 *
	 *     style: type === "underline" ? { textDecorationColor: color }
	 *                                 : { backgroundColor: color + "80" }
	 *
	 * `80` is the alpha, half opacity, and the same value the PDF canvas
	 * fills a highlight with. A solid fill was what this did before, which
	 * made a purple or a blue passage hard to read and looked unlike the
	 * document it came from. The underline's thickness and offset are from
	 * the reader's own stylesheet.
	 */
	annotationStyle(annotation) {
		let colour = this.annotationColour(annotation.color);
		if (annotation.type === "underline") {
			return (
				"text-decoration: underline; text-decoration-color: " +
				colour.value +
				"; text-decoration-thickness: 2px; text-underline-offset: 2px;"
			);
		}
		return "background-color: " + this.halfOpaque(colour) + ";";
	},

	// ── The two floating menus ────────────────────────────────────────
	//
	// A book wants the page to itself; a reader wants its contents within
	// reach. Both are had by letting the summary float as a button and the
	// list appear over the page when it is opened.
	//
	// All of it is <details> and CSS, and that is not a stylistic preference:
	// a preview panel runs no scripts, so a menu that needed one would simply
	// never open. The element carries the state itself.
	//
	// The two sit in opposite corners rather than side by side, so that
	// neither label's width can ever push the other out of place.
	//
	// Shared by the EPUB preview, which builds its lists as DOM, and by the
	// two page sheets, which build theirs as strings — the same classes, so
	// one stylesheet serves all three.
	MENU_CSS: [
		"details.zl-toc, details.zl-annotations {",
		"  margin: 0;",
		"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
		"}",
		"details.zl-toc > summary, details.zl-annotations > summary {",
		"  position: fixed;",
		"  bottom: 24px;",
		"  z-index: 20;",
		"  cursor: default;",
		"  font-size: 14px;",
		"  font-weight: 600;",
		"  padding: 0.6em 1.1em;",
		"  border-radius: 999px;",
		"  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);",
		// The disclosure triangle goes two ways, because the three viewers
		// are not one engine
		"  list-style: none;",
		"}",
		"details.zl-toc > summary::-webkit-details-marker,",
		"details.zl-annotations > summary::-webkit-details-marker {",
		"  display: none;",
		"}",
		"details.zl-toc > summary {",
		"  right: 24px;",
		"  background: #2e8b84;",
		"  color: #ffffff;",
		"}",
		"details.zl-toc[open] > summary { background: #1f2a33; }",
		"details.zl-annotations > summary {",
		"  left: 24px;",
		"  background: #f5b841;",
		"  color: #1f2a33;",
		"}",
		"details.zl-annotations[open] > summary { background: #1f2a33; color: #ffffff; }",
		"ol.zl-toc-list, ol.zl-annotation-list {",
		"  position: fixed;",
		"  bottom: 80px;",
		"  z-index: 15;",
		"  width: min(360px, 70vw);",
		"  max-height: 62vh;",
		"  overflow: auto;",
		"  margin: 0;",
		"  padding: 0.7em 0;",
		"  list-style: none;",
		"  background: #ffffff;",
		"  border-radius: 12px;",
		"  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.28);",
		"  font-size: 14px;",
		"  line-height: 1.45;",
		"  text-align: left;",
		"}",
		"ol.zl-toc-list { right: 24px; }",
		"ol.zl-annotation-list { left: 24px; }",
		"ol.zl-toc-list li { margin: 0; }",
		"ol.zl-toc-list a {",
		"  display: block;",
		"  padding: 0.42em 1.2em;",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"}",
		"ol.zl-toc-list a:hover { background: #f0f4f3; }",
		"li.zl-toc-level1 a { padding-left: 2.4em; font-size: 0.95em; }",
		"li.zl-toc-level2 a { padding-left: 3.6em; font-size: 0.92em; color: #4a4a4a; }",
		"ol.zl-annotation-list li { margin: 0; padding: 0.5em 1.2em; line-height: 1.5; }",
		// A row rather than a block, so the swatch and the first line of the
		// quotation sit together. The native disclosure marker goes away
		// under flex, so one is drawn here — which is steadier anyway across
		// three engines that draw their own differently.
		"details.zl-annotation-entry > summary {",
		"  cursor: default;",
		"  display: flex;",
		"  align-items: baseline;",
		"  gap: 0.3em;",
		"  list-style: none;",
		"}",
		"details.zl-annotation-entry > summary::-webkit-details-marker {",
		"  display: none;",
		"}",
		"details.zl-annotation-entry > summary::before {",
		"  content: \"\\25b8\";",
		"  color: #8a8a8a;",
		"  font-size: 0.9em;",
		"}",
		"details.zl-annotation-entry[open] > summary::before { content: \"\\25be\"; }",
		// Two lines closed, all of it open. Measured in Quick Look, which
		// renders the clamp: the text is cut with an ellipsis rather than
		// running on. max-height carries the rest, where the property is not
		// understood — a little more than two lines, but never the whole
		// passage.
		"details.zl-annotation-entry:not([open]) q {",
		"  display: -webkit-box;",
		"  -webkit-line-clamp: 2;",
		"  line-clamp: 2;",
		"  -webkit-box-orient: vertical;",
		"  overflow: hidden;",
		"  max-height: 3.1em;",
		"}",
		"details.zl-annotation-entry[open] > summary { margin-bottom: 0.35em; }",
		".zl-annotation-detail { margin-left: 1.2em; }",
		"a.zl-annotation-goto {",
		"  display: inline-block;",
		"  margin-top: 0.3em;",
		"  font-size: 0.92em;",
		"  color: #2e8b84;",
		"  text-decoration: none;",
		"}",
		"a.zl-annotation-goto:hover { text-decoration: underline; }",
		".zl-annotation-swatch {",
		"  display: inline-block;",
		"  width: 0.7em;",
		"  height: 0.7em;",
		"  border-radius: 2px;",
		"  margin-right: 0.5em;",
		"  flex: none;",
		"}",
		"ol.zl-annotation-list q { quotes: none; }",
		"ol.zl-annotation-list a {",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"  border-bottom: 1px solid transparent;",
		"}",
		"ol.zl-annotation-list a:hover { border-bottom-color: #999; }",
		".zl-annotation-unplaced { opacity: 0.75; font-style: italic; }",
		".zl-annotation-comment {",
		"  display: block;",
		"  margin-left: 1.2em;",
		"  color: #4a4a4a;",
		"}",
		// Narrow enough and a floating menu covers more than it offers, so
		// it goes back into the flow it came from
		"@media (max-width: 420px) {",
		"  details.zl-toc > summary, details.zl-annotations > summary,",
		"  ol.zl-toc-list, ol.zl-annotation-list {",
		"    position: static;",
		"    width: auto;",
		"    max-height: none;",
		"    box-shadow: none;",
		"  }",
		"  details.zl-toc, details.zl-annotations { margin: 0 0 1.6em 0; }",
		"}",
		"@media print {",
		"  details.zl-toc, details.zl-annotations { display: none; }",
		"}",
	].join("\n"),

	/**
	 * The contents menu, as a string. Entries whose target is missing are
	 * left out; with none left there is no menu, so a document with no
	 * chapters looks like the document rather than like a feature that
	 * failed.
	 *
	 * @param {Array<{title: string, target: string, level?: number}>} entries
	 *   target is an element id in the same page, without the "#"
	 * @returns {string} "" when there is nothing to list
	 */
	tocHtml(entries) {
		let items = "";
		for (let entry of entries || []) {
			let title = this.collapse(entry.title || "");
			if (!title || !entry.target) continue;
			let level = Math.max(0, Math.min(2, Number(entry.level) || 0));
			items +=
				'<li class="zl-toc-level' + level + '"><a href="#' +
				this.escape(entry.target) + '">' + this.escape(title) +
				"</a></li>\n";
		}
		if (!items) return "";
		// Closed on arrival: as a menu over the page it would cover the
		// first thing a reader looks at
		return (
			'<details class="zl-toc"><summary>' +
			this.escape(this.TOC_LABEL) +
			'</summary>\n<ol class="zl-toc-list">\n' +
			items +
			"</ol></details>\n"
		);
	},

	/**
	 * The annotations menu, as a string: every annotation in document
	 * order, each a way to the page it sits on.
	 *
	 * A quotation gets a fold — two lines closed, all of it open — so that a
	 * list of long passages stays a list. A note has no passage: swatch,
	 * comment, page. An annotation with neither is named by its kind, since
	 * an area or an ink drawing is still worth finding.
	 *
	 * @param {Array<{target: string, page: string|number, type?: string,
	 *   text?: string, comment?: string, color?: string}>} entries
	 *   target is the id of the page's tile; page is what the link says
	 * @returns {string} "" when there is nothing to list
	 */
	annotationsHtml(entries) {
		let items = "";
		let count = 0;
		for (let entry of entries || []) {
			if (!entry || !entry.target) continue;
			let text = this.collapse(entry.text || "");
			let comment = this.collapse(entry.comment || "");
			let type = String(entry.type || "highlight");
			// Solid here: the reader shows the swatch in the full colour
			// and only the passage at half
			let swatch =
				'<span class="zl-annotation-swatch" style="background-color: ' +
				this.escape(this.annotationColour(entry.color).value) +
				';"></span>';
			let goto =
				'<a class="zl-annotation-goto" href="#' +
				this.escape(entry.target) + '">' +
				this.escape(this.PAGE_LABEL + " " + entry.page) +
				"</a>";
			let note = comment
				? '<span class="zl-annotation-comment">' +
					this.escape(comment) + "</span>"
				: "";
			count++;

			if (!text) {
				let said = note ||
					'<span class="zl-annotation-comment">' +
					this.escape(this.TYPE_LABELS[type] || type) + "</span>";
				items += "<li>" + swatch + said + goto + "</li>\n";
				continue;
			}
			// Marked here as it is marked on the page — which is also how
			// Zotero shows it in its own annotation list
			items +=
				'<li><details class="zl-annotation-entry"><summary>' +
				swatch +
				'<q style="' + this.escape(this.annotationStyle(
					{ type: type, color: entry.color })) + '">' +
				this.escape(text) + "</q></summary>\n" +
				'<div class="zl-annotation-detail">' + note + goto +
				"</div></details></li>\n";
		}
		if (!items) return "";
		return (
			'<details class="zl-annotations"><summary>' +
			this.escape(this.ANNOTATIONS_LABEL + " (" + count + ")") +
			'</summary>\n<ol class="zl-annotation-list">\n' +
			items +
			"</ol></details>\n"
		);
	},

	/** The id a page's tile carries, the same on both sides of a link. */
	tileId(page) {
		return "p" + page;
	},

	/**
	 * Where a tile lands when a menu entry jumps to it: the middle of the
	 * window, so that the page and its neighbours are seen together.
	 *
	 * A fragment jump puts the target's top edge at the top of the window,
	 * and scroll-margin is the only lever a page without scripts has on
	 * that. The tile's height on screen is not known here — it follows the
	 * window's width — but it can be written as an expression of it: the
	 * grid divides the width left by the padding and the gaps into equal
	 * columns, and a tile is that wide and its page's proportion tall, plus
	 * the label under it. Half the window less half of that is the margin.
	 * Never below zero: a tile taller than the window sits at the top.
	 *
	 * @param {number} ratio the page's height over its width
	 * @param {number} columns
	 */
	scrollMargin(ratio, columns) {
		let taken = 24 + 12 * (Math.max(1, columns) - 1);
		return (
			"max(0px, calc(50vh - ((100vw - " + taken + "px) / " +
			Math.max(1, columns) + " * " + ratio.toFixed(4) + " + 21px) / 2))"
		);
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
	 * @param {Array<{title: string, page: number, level?: number}>} [spec.toc]
	 *   The document's outline; entries whose page was not drawn are left out.
	 * @param {Array<{page: number, label?: string, type?: string,
	 *   text?: string, comment?: string, color?: string}>} [spec.annotations]
	 *   Zotero's annotations, page being the 1-based page they sit on.
	 * @returns {string} A complete HTML document.
	 */
	html(spec) {
		let pages = spec.pages || [];
		let linkBase = spec.linkBase || "";
		let columns = Math.max(1, Number(spec.columns) || 1);
		let body = "";

		// The proportion most pages share goes into the stylesheet; a page
		// that differs — a fold-out, a landscape plate — carries its own
		let ratios = pages.map((p) => p.height / Math.max(1, spec.width));
		let common = ratios.length ? ratios[0] : 1.4142;
		let drawn = new Set(pages.map((p) => p.page));

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
			// target="_blank" does two different jobs, and both were
			// measured by clicking the four combinations in a real preview.
			//
			// Under GNOME Sushi it keeps the sheet alive. Its WebKit view
			// really follows links and cannot load a zotero: URL; the load
			// fails, and a failed load is how it reports that it cannot show
			// the file at all, so a click replaced the sheet with an error
			// box. A new-window request raises "create" instead, which Sushi
			// does not handle, so the click does nothing and the sheet stays.
			//
			// Under Quick Look it is what makes the links work at all.
			// Ordinary navigation is refused there — the click just beeps —
			// but a new-window request is handed to the system handler,
			// whatever the scheme: zotero: opens the reader at that page,
			// http: opens the browser. The preview closes as it hands over.
			// Without target the same link does nothing but beep.
			let inner = linkBase
				? '<a target="_blank" href="' +
					this.escape(linkBase) +
					"?page=" +
					entry.page +
					'">' +
					thumb +
					"</a>"
				: thumb;
			let ratio = entry.height / Math.max(1, spec.width);
			let own = Math.abs(ratio - common) > 0.01
				? ' style="scroll-margin-top: ' +
					this.scrollMargin(ratio, columns) + ';"'
				: "";
			body +=
				'<div class="page" id="' + this.tileId(entry.page) + '"' + own +
				">\n" + inner + "</div>\n\n";
		}

		let notice = spec.notice
			? '<p class="notice">' + this.escape(spec.notice) + "</p>\n"
			: "";

		// The menus, where there is something to put in them. An entry is
		// only worth following to a page that is there: with a page limit
		// in force, the outline of the rest would point at nothing.
		let toc = this.tocHtml(
			(spec.toc || [])
				.filter((e) => drawn.has(e.page))
				.map((e) => ({
					title: e.title,
					level: e.level,
					target: this.tileId(e.page),
				}))
		);
		let annotations = this.annotationsHtml(
			(spec.annotations || [])
				.filter((a) => drawn.has(a.page))
				.map((a) => ({
					target: this.tileId(a.page),
					page: a.label || a.page,
					type: a.type,
					text: a.text,
					comment: a.comment,
					color: a.color,
				}))
		);

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
			columns +
			", 1fr);\n" +
			"    gap: 12px;\n" +
			"}\n" +
			".page {\n" +
			"    background: white;\n" +
			"    box-shadow: 0 1px 4px rgba(0,0,0,0.2);\n" +
			"    text-align: center;\n" +
			"    overflow: hidden;\n" +
			"    scroll-margin-top: " + this.scrollMargin(common, columns) + ";\n" +
			"}\n" +
			// The page jumped to should be findable once the eye arrives
			".page:target {\n" +
			"    outline: 3px solid #f5b841;\n" +
			"    outline-offset: 3px;\n" +
			"}\n" +
			".page:target .label { color: #1f2a33; font-weight: 600; }\n" +
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
			this.MENU_CSS + "\n" +
			"</style>\n" +
			"</head>\n<body>\n" +
			toc +
			annotations +
			'<div class="grid">\n\n' +
			body +
			"</div>\n" +
			notice +
			"</body>\n</html>"
		);
	},
};
