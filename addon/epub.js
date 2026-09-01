/* global Zotero, PathUtils, IOUtils, zotLookUtil, zotLookCfi */

/**
 * Renders an epub into a single HTML page that QuickLook can display.
 *
 * No system preview shows an epub, so the book is read out of its archive, its
 * spine walked in reading order, and every chapter body concatenated into one
 * document. The book's own stylesheets are carried into that page and its
 * images written out beside it, so the original typography survives — all of
 * it, at any size: a preview that left out part of a book would not be a
 * preview of that book.
 *
 * The only things this needs from the host plugin are somewhere to write the
 * finished page and the two readers the platform already provides; see
 * convert().
 */
var zotLookEpub = {

	// Applied on top of the book's own stylesheets, so it has to come last in
	// the head and win the specificity fight
	/** Heading of the table of contents; set from the plugin's locale. */
	TOC_LABEL: "Contents",

	BASE_CSS: [
		"html, body { margin: 0; }",
		"body {",
		'  font-family: "Palatino", "Palatino Linotype", "Book Antiqua",',
		"      Georgia, serif !important;",
		"  font-size: 16px;",
		"  line-height: 1.6;",
		"  color: #1a1a1a;",
		"  background: #fdfdfd;",
		"  max-width: 720px !important;",
		"  margin: 0 auto !important;",
		"  padding: 80px !important;",
		"  box-sizing: border-box !important;",
		"}",
		"img, svg { max-width: 100%; height: auto; }",
		"pre, code { font-family: Menlo, monospace; }",
		"hr.epub-chapter-break {",
		"  border: none;",
		"  border-top: 1px solid #ddd;",
		"  margin: 3em 0;",
		"}",
		// The anchor is a landing point, not a box: it must take no space,
		// and scroll-margin keeps the heading clear of the window's top edge
		"div.epub-anchor { height: 0; scroll-margin-top: 1.5em; }",
		// ── The two floating menus ────────────────────────────────────
		//
		// A book wants the page to itself; a reader wants its contents
		// within reach. Both are had by letting the summary float as a
		// button and the list appear over the text when it is opened.
		//
		// All of it is <details> and CSS, and that is not a stylistic
		// preference: a preview panel runs no scripts, so a menu that needed
		// one would simply never open. The element carries the state itself.
		//
		// The two sit in opposite corners rather than side by side, so that
		// neither label's width can ever push the other out of place.
		"details.epub-toc, details.epub-annotations {",
		"  margin: 0;",
		"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
		"}",
		"details.epub-toc > summary, details.epub-annotations > summary {",
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
		"details.epub-toc > summary::-webkit-details-marker,",
		"details.epub-annotations > summary::-webkit-details-marker {",
		"  display: none;",
		"}",
		"details.epub-toc > summary {",
		"  right: 24px;",
		"  background: #2e8b84;",
		"  color: #ffffff;",
		"}",
		"details.epub-toc[open] > summary { background: #1f2a33; }",
		"details.epub-annotations > summary {",
		"  left: 24px;",
		"  background: #f5b841;",
		"  color: #1f2a33;",
		"}",
		"details.epub-annotations[open] > summary { background: #1f2a33; color: #ffffff; }",
		"ol.epub-toc-list, ol.epub-annotation-list {",
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
		"}",
		"ol.epub-toc-list { right: 24px; }",
		"ol.epub-annotation-list { left: 24px; }",
		"ol.epub-toc-list li { margin: 0; }",
		"ol.epub-toc-list a {",
		"  display: block;",
		"  padding: 0.42em 1.2em;",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"}",
		"ol.epub-toc-list a:hover { background: #f0f4f3; }",
		"li.epub-toc-level1 a { padding-left: 2.4em; font-size: 0.95em; }",
		"li.epub-toc-level2 a { padding-left: 3.6em; font-size: 0.92em; color: #4a4a4a; }",
		"ol.epub-annotation-list li { margin: 0; padding: 0.5em 1.2em; line-height: 1.5; }",
		// A row rather than a block, so the swatch and the first line of the
		// quotation sit together. The native disclosure marker goes away
		// under flex, so one is drawn here — which is steadier anyway across
		// three engines that draw their own differently.
		"details.epub-annotation-entry > summary {",
		"  cursor: default;",
		"  display: flex;",
		"  align-items: baseline;",
		"  gap: 0.3em;",
		"  list-style: none;",
		"}",
		"details.epub-annotation-entry > summary::-webkit-details-marker {",
		"  display: none;",
		"}",
		"details.epub-annotation-entry > summary::before {",
		"  content: \"\\25b8\";",
		"  color: #8a8a8a;",
		"  font-size: 0.9em;",
		"}",
		"details.epub-annotation-entry[open] > summary::before { content: \"\\25be\"; }",
		// Two lines closed, all of it open. Measured in Quick Look, which
		// renders the clamp: the text is cut with an ellipsis rather than
		// running on. max-height carries the rest, where the property is not
		// understood — a little more than two lines, but never the whole
		// passage.
		"details.epub-annotation-entry:not([open]) q {",
		"  display: -webkit-box;",
		"  -webkit-line-clamp: 2;",
		"  line-clamp: 2;",
		"  -webkit-box-orient: vertical;",
		"  overflow: hidden;",
		"  max-height: 3.1em;",
		"}",
		"details.epub-annotation-entry[open] > summary { margin-bottom: 0.35em; }",
		".epub-annotation-detail { margin-left: 1.2em; }",
		"a.epub-annotation-goto {",
		"  display: inline-block;",
		"  margin-top: 0.3em;",
		"  font-size: 0.92em;",
		"  color: #2e8b84;",
		"  text-decoration: none;",
		"}",
		"a.epub-annotation-goto:hover { text-decoration: underline; }",
		".epub-annotation-swatch {",
		"  display: inline-block;",
		"  width: 0.7em;",
		"  height: 0.7em;",
		"  border-radius: 2px;",
		"  margin-right: 0.5em;",
		"}",
		"ol.epub-annotation-list q { quotes: none; }",
		"ol.epub-annotation-list a {",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"  border-bottom: 1px solid transparent;",
		"}",
		"ol.epub-annotation-list a:hover { border-bottom-color: #999; }",
		// The passage jumped to should be findable once the eye arrives
		"span.zotlook-annotation:target { outline: 2px solid #1f2a33; }",
		".epub-annotation-unplaced { opacity: 0.75; font-style: italic; }",
		".epub-annotation-comment {",
		"  display: block;",
		"  margin-left: 1.2em;",
		"  color: #4a4a4a;",
		"}",
		"span.zotlook-annotation { border-radius: 2px; }",
		// Narrow enough and a floating menu covers more than it offers, so
		// it goes back into the flow it came from
		"@media (max-width: 420px) {",
		"  details.epub-toc > summary, details.epub-annotations > summary,",
		"  ol.epub-toc-list, ol.epub-annotation-list {",
		"    position: static;",
		"    width: auto;",
		"    max-height: none;",
		"    box-shadow: none;",
		"  }",
		"  details.epub-toc, details.epub-annotations { margin: 0 0 1.6em 0; }",
		"}",
		"@media print {",
		"  details.epub-toc, details.epub-annotations { display: none; }",
		"}",
	].join("\n"),

	// ── The page sheet ────────────────────────────────────────────────
	//
	// A tile is a page-shaped box holding that page's own text at the book's
	// own typography, shrunk. Shrunk rather than re-typeset: transform: scale
	// keeps the proportions the book gives its headings, its verse, its
	// tables, and those proportions are most of what makes a page
	// recognisable at a glance.
	//
	// The inner box is laid out at reading width and then scaled, so the line
	// breaks are the ones the book would have — not the two-words-a-line a
	// 200px column would produce. What does not fit is clipped, exactly as a
	// printed page clips at its foot.
	//
	// No script, again: the sheet has to work in a preview panel that runs
	// none. Everything here is layout.

	SHEET_CSS: [
		"body.epub-sheet-body {",
		"  max-width: none !important;",
		"  padding: 24px !important;",
		"  background: #eceae6 !important;",
		"}",
		"div.epub-sheet {",
		"  display: grid;",
		"  grid-template-columns: repeat(auto-fill, minmax(210px, 210px));",
		"  gap: 26px 22px;",
		"  justify-content: center;",
		"}",
		"div.epub-page { width: 210px; }",
		"div.epub-page a { text-decoration: none; color: inherit; }",
		// The margin belongs to the paper, not to the text inside it. Put it
		// on the scaled box and it scales with the text, so a page whose
		// content runs long is clipped flush against the edge — text sliced
		// off mid-line at the very border, which is what a page never looks
		// like. Out here the clip happens inside the margin, and every tile
		// keeps white all the way round.
		"div.epub-paper {",
		"  width: 210px;",
		"  height: 297px;",
		"  padding: 10px;",
		"  overflow: hidden;",
		"  background: #fff;",
		"  border: 1px solid #cfcdc8;",
		"  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);",
		"  box-sizing: border-box;",
		"}",
		// The inner box is the page at reading size; the scale is what makes
		// it a thumbnail. 626 × 0.3 = 188, which is what the paper leaves
		// between its border and its margin, and 916 × 0.3 = 275 likewise.
		"div.epub-paper-inner {",
		"  width: 626px;",
		"  height: 916px;",
		"  transform: scale(0.3);",
		"  transform-origin: top left;",
		"  font-size: 14px;",
		"  line-height: 1.45;",
		"  overflow: hidden;",
		"}",
		// The book's first heading often carries a large top margin meant to
		// open a chapter, which on a tile only pushes the text out of sight
		"div.epub-paper-inner > *:first-child { margin-top: 0 !important; }",
		// The book's own rules may float, absolutely position or hide things
		// in ways that assume a whole document around them
		"div.epub-paper-inner * {",
		"  position: static !important;",
		"  float: none !important;",
		"  max-width: 100% !important;",
		"}",
		"div.epub-paper-inner img, div.epub-paper-inner svg {",
		"  max-height: 600px;",
		"  height: auto;",
		"}",
		"div.epub-page-label {",
		"  margin-top: 6px;",
		"  text-align: center;",
		"  font-size: 12px;",
		"  color: #55534f;",
		"  font-family: -apple-system, Segoe UI, Cantarell, sans-serif;",
		"}",
		// A page that could not be linked still gets its number, but nothing
		// should suggest it can be clicked
		"div.epub-page a:hover div.epub-paper { border-color: #8a8781; }",
		"div.epub-sheet-notice {",
		"  max-width: 34em;",
		"  margin: 12vh auto;",
		"  text-align: center;",
		"}",
		"div.epub-sheet-notice h1 { font-size: 1.3em; font-weight: normal; }",
		"p.epub-sheet-hint { color: #66635e; font-size: 0.92em; }",
		"@media print {",
		"  div.epub-paper { box-shadow: none; }",
		"}",
	].join("\n"),

	log(msg) {
		Zotero.debug("zotLook/epub: " + msg);
	},

	/**
	 * @param {string} epubPath
	 * @param {object} env
	 * @param {string} env.outDir - where the finished page is written
	 * @param {function} env.openZip - (path) => nsIZipReader
	 * @param {function} env.openBook - (path) => Zotero's EPUB, whose
	 *   getSectionDocuments() yields the spine in reading order. That join of
	 *   manifest and spine is the one piece of epub arithmetic Zotero already
	 *   does, and it does it on every book it indexes.
	 * @returns {Promise<string|null>} path to the generated HTML, or null
	 */
	async convert(epubPath, env) {
		let baseName = PathUtils.filename(epubPath).replace(/\.epub$/i, "");

		let zip = null;
		let book = null;
		try {
			zip = env.openZip(epubPath);
			book = env.openBook(epubPath);
		} catch (e) {
			this.log("Could not open " + epubPath + ": " + e);
			this._close(zip, book);
			return null;
		}

		try {
			let pkg = await this._readPackage(zip);
			if (!pkg) return null;

			let title = this._readTitle(pkg.doc, baseName);
			let nav = await this._readNav(zip, pkg.doc, pkg.dir);

			let sections = [];
			try {
				for await (let section of book.getSectionDocuments()) {
					sections.push(section);
				}
			} catch (e) {
				this.log("Could not walk the spine: " + e);
				return null;
			}
			if (sections.length === 0) {
				this.log("No spine items resolved");
				return null;
			}

			let sheet = env.mode === "sheet";
			let html = sheet
				? await this._buildSheet(zip, sections, title, env, pkg)
				: await this._buildHtml(zip, sections, title, nav, env);
			if (!html) return null;

			let outputPath = PathUtils.join(
				env.outDir, sheet ? "sheet.html" : "preview.html"
			);
			await IOUtils.writeUTF8(outputPath, html);
			this.log("Wrote " + (sheet ? "sheet" : "preview") + ": " + outputPath);
			return outputPath;
		} finally {
			this._close(zip, book);
		}
	},

	/** Both handles, whatever happened. An archive left open holds the file. */
	_close(zip, book) {
		for (let handle of [book, zip]) {
			try {
				if (handle) handle.close();
			} catch (e) {
				this.log("Could not close the archive: " + e);
			}
		}
	},

	// ── Reading the container ─────────────────────────────────────────
	//
	// The book is read straight out of its zip, through Gecko's own
	// nsIZipReader — the same one Zotero uses for its full-text indexing.
	// Until now this spawned /usr/bin/unzip, or bsdtar on Windows, and spread
	// the book across a temp directory: a subprocess and its timeout for
	// something the platform already does, and a directory to clean up
	// afterwards.
	//
	// The whole archive is no longer spread out either. Chapters and
	// stylesheets are read from it and go into the page; only the assets a
	// chapter actually refers to are written out beside it, once each, and
	// referred to relatively from there.

	/** The text of one entry, or null when it is not there. */
	async _entryText(zip, entry) {
		try {
			if (!zip.hasEntry(entry)) return null;
			let stream = zip.getInputStream(entry);
			try {
				return await Zotero.File.getContentsAsync(stream);
			} finally {
				stream.close();
			}
		} catch (e) {
			this.log("Could not read " + entry + ": " + e);
			return null;
		}
	},

	/**
	 * An asset of the book, written out beside the page once and referenced
	 * relatively from it.
	 *
	 * Carried as data: URLs at first, which made the page self-contained but
	 * needed a size limit to stay sane — and a preview that leaves out half a
	 * book is not a preview of that book. Written out, base64's third is
	 * saved, the page stays small however large the volume, and there is
	 * nothing to cap: the store removes the whole entry when its time comes.
	 *
	 * @returns {Promise<string|null>} a relative URL, or null to leave the
	 *   reference as it stands
	 */
	async _asset(zip, entry, env, written) {
		if (written.has(entry)) return written.get(entry);
		try {
			if (!zip.hasEntry(entry)) return null;
			let name = this._assetName(entry);
			let dir = PathUtils.join(env.outDir, this.ASSET_DIR);
			await IOUtils.makeDirectory(dir, {
				ignoreExisting: true,
				createAncestors: true,
			});
			// Straight from the archive to the file, without the bytes
			// passing through a string on the way
			await env.extractEntry(zip, entry, PathUtils.join(dir, name));
			let url = this.ASSET_DIR + "/" + encodeURIComponent(name);
			written.set(entry, url);
			return url;
		} catch (e) {
			this.log("Could not write out " + entry + ": " + e);
			written.set(entry, null);
			return null;
		}
	},

	ASSET_DIR: "asset",

	/**
	 * A flat name for an entry, keeping its own so a reader who opens the
	 * directory can still tell what is what. Two entries of the same name in
	 * different folders stay apart because the folders are folded into it.
	 */
	_assetName(entry) {
		return String(entry).replace(/[\\/]+/g, "_").replace(/[^\w.\- ]+/g, "_");
	},

	// ── Package metadata ──────────────────────────────────────────────

	/**
	 * Follows META-INF/container.xml to the OPF package document.
	 *
	 * Zotero's EPUB module resolves the spine but keeps the package document
	 * to itself, and the table of contents is read from there — so this
	 * stays, now against the archive rather than a directory.
	 *
	 * @returns {Promise<{doc: Document, dir: string}|null>}
	 */
	async _readPackage(zip) {
		let containerDoc = await this._readPackageDoc(
			zip,
			"META-INF/container.xml"
		);
		if (!containerDoc) {
			this.log("Unusable META-INF/container.xml");
			return null;
		}

		let rootfile = containerDoc.querySelector("rootfile");
		let opfPath = rootfile && rootfile.getAttribute("full-path");
		if (!opfPath) {
			this.log("No rootfile in container.xml");
			return null;
		}

		let opfDoc = await this._readPackageDoc(zip, opfPath);
		if (!opfDoc) {
			this.log("Unusable OPF: " + opfPath);
			return null;
		}

		let cut = opfPath.lastIndexOf("/");
		return {
			doc: opfDoc,
			dir: cut === -1 ? "" : opfPath.substring(0, cut),
			// Which child of <package> the spine is, because that is the
			// first step of every CFI into this book: /6 in the usual
			// metadata, manifest, spine order
			spineStep: this._spineStep(opfDoc),
			// And where each document sits in the spine, which is the second
			spineFor: this._spinePositions(opfDoc, cut === -1 ? "" : opfPath.substring(0, cut)),
		};
	},

	/**
	 * Where each document sits in the spine, by its path in the archive.
	 *
	 * Counted over every itemref, including any whose file is missing. That
	 * matters: the reader resolves a CFI by taking its spine step as an index
	 * into its own list of sections, epub.js builds that list from all the
	 * itemrefs, and Zotero's getSectionDocuments() quietly skips the ones it
	 * cannot read. Counting the documents that arrived here would drift from
	 * the reader's numbering at the first missing file, and every link after
	 * it would land in the wrong chapter.
	 */
	_spinePositions(opfDoc, opfDir) {
		let hrefFor = new Map();
		for (let item of opfDoc.querySelectorAll("manifest item")) {
			let id = item.getAttribute("id");
			let href = item.getAttribute("href");
			if (!id || !href) continue;
			let target = zotLookUtil.resolveRelativePath(href, opfDir);
			if (target) hrefFor.set(id, target.path);
		}

		let positions = new Map();
		let at = -1;
		for (let ref of opfDoc.querySelectorAll("spine itemref")) {
			at++;
			let href = hrefFor.get(ref.getAttribute("idref"));
			// First wins: a document used twice in the spine is rare, and the
			// earlier appearance is the one a page number belongs to
			if (href && !positions.has(href)) positions.set(href, at);
		}
		return positions;
	},

	/** The spine's position among the package's element children. */
	_spineStep(opfDoc) {
		let pkg = opfDoc.documentElement;
		if (!pkg) return 2;
		let at = -1;
		for (let child of pkg.childNodes) {
			if (child.nodeType !== 1) continue;
			at++;
			if ((child.tagName || "").toLowerCase().replace(/^.*:/, "") === "spine") {
				return at;
			}
		}
		return 2;   // the conventional order, and the only sensible guess
	},

	/**
	 * Reads container.xml or the OPF. Both are required to be well-formed XML,
	 * but shipped epubs are not always, so a file the XML parser rejects is
	 * retried with the lenient HTML parser rather than abandoned: the element
	 * names we look for survive either way.
	 */
	async _readPackageDoc(zip, entry) {
		let text = await this._entryText(zip, entry);
		if (text === null) {
			this.log("Missing: " + entry);
			return null;
		}
		let doc = zotLookUtil.parseStrict(text, "application/xml");
		if (doc) return doc;
		this.log("Not well-formed XML, parsing leniently: " + entry);
		return zotLookUtil.parseLoose(text);
	},

	/**
	 * First descendant with the given local name, ignoring any namespace
	 * prefix. Needed because a leniently parsed document has no namespaces,
	 * so dc:title arrives as an element literally named "dc:title".
	 */
	_findByLocalName(root, localName) {
		for (let el of root.querySelectorAll("*")) {
			let name = (el.localName || el.nodeName || "").toLowerCase();
			if (name.replace(/^.*:/, "") === localName) return el;
		}
		return null;
	},

	/**
	 * dc:title from the package metadata, falling back to the file's basename.
	 */
	_readTitle(opfDoc, fallback) {
		let metadata = opfDoc.querySelector("metadata");
		if (!metadata) return fallback;
		let el = this._findByLocalName(metadata, "title");
		let text = el && el.textContent.trim();
		return text || fallback;
	},

	/**
	 * The book's own table of contents.
	 *
	 * EPUB 3 keeps it in a navigation document — the manifest item carrying
	 * properties="nav" — and EPUB 2 in an NCX file the spine points at. Both
	 * are read, newer first, because the titles and the nesting are the
	 * author's and better than anything derived from headings.
	 *
	 * @returns {Promise<Array<{title: string, path: string, fragment: string,
	 *   level: number}>>} empty where the book carries no usable navigation
	 */
	async _readNav(zip, opfDoc, opfDir) {
		let hrefFor = (id) => {
			for (let item of opfDoc.querySelectorAll("manifest item")) {
				if (item.getAttribute("id") === id) {
					return item.getAttribute("href");
				}
			}
			return null;
		};

		// EPUB 3: properties is a space-separated token list
		let navHref = null;
		for (let item of opfDoc.querySelectorAll("manifest item")) {
			let props = (item.getAttribute("properties") || "").split(/\s+/);
			if (props.includes("nav")) {
				navHref = item.getAttribute("href");
				break;
			}
		}
		if (navHref) {
			let target = zotLookUtil.resolveRelativePath(navHref, opfDir);
			let entries = target
				? await this._readNavDocument(zip, target.path)
				: [];
			if (entries.length) return entries;
		}

		// EPUB 2: spine@toc names the manifest id of the NCX
		let spine = opfDoc.querySelector("spine");
		let ncxHref = spine && hrefFor(spine.getAttribute("toc"));
		if (ncxHref) {
			let target = zotLookUtil.resolveRelativePath(ncxHref, opfDir);
			if (target) return this._readNcx(zip, target.path);
		}
		return [];
	},

	/** EPUB 3: nested <ol> inside the toc <nav>. */
	async _readNavDocument(zip, path) {
		let doc = await this._readEntryDoc(zip, path);
		if (!doc) return [];

		let nav = null;
		for (let candidate of doc.querySelectorAll("nav")) {
			let type = candidate.getAttribute("epub:type") ||
				candidate.getAttributeNS(
					"http://www.idpf.org/2007/ops", "type") || "";
			if (type.split(/\s+/).includes("toc")) {
				nav = candidate;
				break;
			}
		}
		nav = nav || doc.querySelector("nav");
		if (!nav) return [];

		let cut = path.lastIndexOf("/");
		let dir = cut === -1 ? "" : path.substring(0, cut);
		let entries = [];
		let walk = (list, level) => {
			for (let li of [...list.children]) {
				if ((li.localName || "").toLowerCase() !== "li") continue;
				let anchor = li.querySelector("a");
				if (anchor) {
					this._pushNavEntry(entries, anchor.textContent,
						anchor.getAttribute("href"), dir, level);
				}
				for (let child of [...li.children]) {
					if ((child.localName || "").toLowerCase() === "ol") {
						walk(child, level + 1);
					}
				}
			}
		};
		let root = nav.querySelector("ol");
		if (root) walk(root, 0);
		return entries;
	},

	/** EPUB 2: nested <navPoint> in the NCX navMap. */
	async _readNcx(zip, path) {
		let doc = await this._readEntryDoc(zip, path);
		if (!doc) return [];

		let cut = path.lastIndexOf("/");
		let dir = cut === -1 ? "" : path.substring(0, cut);
		let entries = [];
		let isPoint = (el) =>
			(el.localName || el.nodeName || "").toLowerCase()
				.replace(/^.*:/, "") === "navpoint";

		let walk = (parent, level) => {
			for (let el of [...parent.children]) {
				if (!isPoint(el)) continue;
				let label = this._findByLocalName(el, "text");
				let content = null;
				for (let child of [...el.children]) {
					let name = (child.localName || child.nodeName || "")
						.toLowerCase().replace(/^.*:/, "");
					if (name === "content") content = child;
				}
				if (label && content) {
					this._pushNavEntry(entries, label.textContent,
						content.getAttribute("src"), dir, level);
				}
				walk(el, level + 1);
			}
		};

		let map = this._findByLocalName(doc, "navmap");
		if (map) walk(map, 0);
		return entries;
	},

	/** One navigation entry, with its href split into file and fragment. */
	_pushNavEntry(entries, title, href, dir, level) {
		title = (title || "").replace(/\s+/g, " ").trim();
		if (!title || !href) return;
		let hash = href.indexOf("#");
		let file = hash >= 0 ? href.slice(0, hash) : href;
		let fragment = hash >= 0 ? href.slice(hash + 1) : "";
		let target = file ? zotLookUtil.resolveRelativePath(file, dir) : null;
		if (!target) return;
		let path = target.path;
		// Deeper than this reads as clutter in a preview rather than structure
		entries.push({ title, path, fragment, level: Math.min(level, 2) });
	},

	// ── Document assembly ─────────────────────────────────────────────

	/**
	 * Concatenates the chapter bodies into one document, carrying over the
	 * stylesheets each chapter declares.
	 *
	 * @returns {Promise<string|null>} serialised HTML
	 */
	async _buildHtml(zip, sections, title, nav, env) {
		let out = zotLookUtil.newHtmlDocument();
		if (!out) {
			this.log("Could not create output document");
			return null;
		}
		out.title = title;

		let seenCssUrls = new Set();
		let seenInlineCss = new Set();
		let chapters = 0;
		// Where each spine entry ended up, so a navigation entry naming it can
		// be turned into a link into this one document
		let anchorFor = new Map();
		// Shared across the whole book, so one chapter of scans cannot spend
		// everything the rest of it needs
		// Written out once each, however often the book refers to them
		let written = new Map();

		let placed = new Set();
		let sectionIndex = -1;
		for (let section of sections) {
			sectionIndex++;
			let doc = section.doc;
			let body = doc && this._bodyOf(doc);
			if (!body) continue;

			// Before anything is moved: the CFI describes this tree, and
			// after the assembly that tree is gone.
			for (let one of this._markSection(doc, sectionIndex, env.annotations)) {
				placed.add(one);
			}

			let filePath = section.href;
			let cut = filePath.lastIndexOf("/");
			let fileDir = cut === -1 ? "" : filePath.substring(0, cut);

			await this._collectStyles(
				zip, doc, fileDir, out, seenCssUrls, seenInlineCss, env, written
			);

			zotLookUtil.sanitize(body);
			await this._rewriteUrls(zip, body, fileDir, env, written);

			if (chapters > 0) {
				let hr = out.createElement("hr");
				hr.className = "epub-chapter-break";
				out.body.appendChild(hr);
			}

			// One anchor per chapter, always — the book's own ids may be
			// absent, and its navigation often points at the file alone
			let mark = out.createElement("div");
			mark.id = "zotlook-ch" + chapters;
			mark.className = "epub-anchor";
			out.body.appendChild(mark);
			anchorFor.set(filePath, mark.id);

			for (let node of [...body.childNodes]) {
				out.body.appendChild(out.importNode(node, true));
			}
			chapters++;
		}

		if (chapters === 0) {
			this.log("No readable spine content");
			return null;
		}

		let notes = this._buildAnnotationList(out, env.annotations, placed);
		if (notes) out.body.insertBefore(notes, out.body.firstChild);

		let toc = this._buildToc(out, nav, anchorFor);
		if (toc) out.body.insertBefore(toc, out.body.firstChild);

		// Last in the head, so it overrides the book's own rules
		let base = out.createElement("style");
		base.textContent = this.BASE_CSS;
		out.head.appendChild(base);

		return zotLookUtil.serializeHtmlDocument(out);
	},

	/**
	 * The table of contents, as a <details> block at the top of the document.
	 *
	 * <details> and in-page anchors both work inside Quick Look, which runs
	 * previews with JavaScript disabled — measured by clicking each in a real
	 * preview. So the block folds away and its entries jump, with no script.
	 *
	 * Returns null where the book carries no navigation, rather than an empty
	 * box: a preview of a document with no chapters should look like the
	 * document, not like a feature that failed.
	 */
	_buildToc(out, nav, anchorFor) {
		if (!nav || !nav.length) return null;

		let list = out.createElement("ol");
		list.className = "epub-toc-list";
		let used = 0;

		for (let entry of nav) {
			let anchor = anchorFor.get(entry.path);
			if (!anchor) continue;

			// A fragment is only worth following where the chapter actually
			// carries that id; otherwise the chapter itself is the target.
			let target = anchor;
			if (entry.fragment) {
				let el = out.getElementById(entry.fragment);
				if (el) target = entry.fragment;
			}

			let li = out.createElement("li");
			li.className = "epub-toc-level" + entry.level;
			let link = out.createElement("a");
			link.setAttribute("href", "#" + target);
			link.textContent = entry.title;
			li.appendChild(link);
			list.appendChild(li);
			used++;
		}

		if (!used) return null;

		let box = out.createElement("details");
		box.className = "epub-toc";
		// Closed on arrival. It was open when it stood above the book and
		// there was nothing to be in the way of; as a menu over the page it
		// would cover the first thing a reader looks at.
		let summary = out.createElement("summary");
		summary.textContent = this.TOC_LABEL;
		box.appendChild(summary);
		box.appendChild(list);
		return box;
	},

	/**
	 * Chapters are XHTML, so they are parsed as XHTML first. That matters for
	 * fidelity: an empty element written `<div/>` is empty in XHTML, whereas
	 * the HTML parser reads it as an opening tag that swallows everything
	 * after it. Books that are not well-formed fall back to lenient parsing.
	 */
	async _readEntryDoc(zip, entry) {
		let text = await this._entryText(zip, entry);
		if (text === null) return null;

		let doc = zotLookUtil.parseStrict(text, "application/xhtml+xml");
		if (doc && this._bodyOf(doc)) return doc;

		this.log("Not well-formed XHTML, parsing leniently: " + entry);
		return zotLookUtil.parseLoose(text);
	},

	/**
	 * The body element, whether the document came from the XML or the HTML
	 * parser. Document.body is an HTML-document convenience that an XML
	 * document does not necessarily expose.
	 */
	_bodyOf(doc) {
		return doc.body || doc.querySelector("body") || null;
	},

	/**
	 * Copies a chapter's stylesheet links and inline styles into the output
	 * head, skipping ones already carried over from an earlier chapter.
	 */
	async _collectStyles(zip, doc, fileDir, out, seenCssUrls, seenInlineCss, env, written) {
		for (let link of doc.querySelectorAll("head link")) {
			let rel = link.getAttribute("rel") || "";
			if (!/stylesheet/i.test(rel)) continue;
			let href = link.getAttribute("href");
			if (!href) continue;
			let target = zotLookUtil.resolveRelativePath(href, fileDir);
			if (!target || seenCssUrls.has(target.path)) continue;
			seenCssUrls.add(target.path);

			// Carried in as text rather than linked: there is no file beside
			// the page to link to any more, and a stylesheet that failed to
			// load would take the book's typography with it.
			let css = await this._entryText(zip, target.path);
			if (css === null) continue;
			let cut = target.path.lastIndexOf("/");
			let cssDir = cut === -1 ? "" : target.path.substring(0, cut);

			let el = out.createElement("style");
			el.textContent = await this._rewriteCssAssets(
				zip, css, cssDir, env, written
			);
			out.head.appendChild(el);
		}

		for (let style of doc.querySelectorAll("head style")) {
			let css = await this._rewriteCssAssets(
				zip, style.textContent, fileDir, env, written
			);
			if (seenInlineCss.has(css)) continue;
			seenInlineCss.add(css);

			let el = out.createElement("style");
			el.textContent = css;
			out.head.appendChild(el);
		}
	},

	/**
	 * url(...) references in a stylesheet, resolved into the archive.
	 *
	 * Textual, because CSS has no DOM here — and asynchronous, because every
	 * hit means reading an entry, so the substitutions are collected first
	 * and applied afterwards.
	 */
	async _rewriteCssAssets(zip, css, baseDir, env, written) {
		let text = String(css);
		let wanted = new Map();
		for (let match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
			let raw = match[2];
			if (wanted.has(raw)) continue;
			wanted.set(raw, await this._assetUrl(zip, raw, baseDir, env, written));
		}
		return zotLookUtil.rewriteCssUrls(text, baseDir, (raw) =>
			wanted.get(raw) || null
		);
	},

	/**
	 * Points every relative reference in a chapter at the extracted file.
	 */
	async _rewriteUrls(zip, root, baseDir, env, written) {
		const XLINK = "http://www.w3.org/1999/xlink";
		const URL_ATTRS = ["src", "poster"];

		for (let el of root.querySelectorAll("*")) {
			for (let name of URL_ATTRS) {
				let value = el.getAttribute(name);
				if (value === null) continue;
				let data = await this._assetUrl(zip, value, baseDir, env, written);
				if (data) el.setAttribute(name, data);
			}

			// Inline SVG uses the xlink namespace for image references.
			// Asked for by namespace and checked again on the attribute
			// itself: a plain href has no namespace, and an implementation
			// that answers by local name alone would otherwise have every
			// link in the book written out as though it were an image.
			let xlinkAttr = el.getAttributeNodeNS
				? el.getAttributeNodeNS(XLINK, "href")
				: null;
			if (xlinkAttr && xlinkAttr.namespaceURI === XLINK) {
				let data = await this._assetUrl(
					zip, xlinkAttr.value, baseDir, env, written
				);
				if (data) el.setAttributeNS(XLINK, "xlink:href", data);
			}

			// A link between chapters used to point at a file beside the
			// page; there is no such file now, and the whole book is on this
			// one page anyway, so what is left of it is its text.
			let href = el.getAttribute("href");
			if (
				href !== null &&
				el.tagName &&
				el.tagName.toLowerCase() === "a" &&
				zotLookUtil.resolveRelativePath(href, baseDir)
			) {
				el.removeAttribute("href");
			}

			if (el.tagName && el.tagName.toLowerCase() === "style") {
				el.textContent = await this._rewriteCssAssets(
					zip, el.textContent, baseDir, env, written
				);
			}

			let styleAttr = el.getAttribute("style");
			if (styleAttr) {
				el.setAttribute(
					"style",
					await this._rewriteCssAssets(
						zip, styleAttr, baseDir, env, written
					)
				);
			}
		}
	},

	ANNOTATIONS_LABEL: "Annotations",
	GOTO_LABEL: "Go to the passage",

	/**
	 * Turns the book's own links into plain text inside a tile.
	 *
	 * A whole tile is one link into the reader, and an <a> inside an <a> is
	 * not something a browser keeps: on meeting the inner one the parser
	 * closes the outer, and everything after that point in the tile stops
	 * being clickable. Measured in Quick Look with a page whose CSS reveals
	 * the parsed tree — with an inner anchor present, the page box is no
	 * longer a descendant of the outer link. In one 416-page book, 198 tiles
	 * carried the book's cross-references, which is why some pages linked and
	 * others seemed not to.
	 *
	 * They are no loss. They point at chapter files that do not exist beside
	 * a sheet, so following one could only fail; what they were is still
	 * there to read.
	 *
	 * Marks are carried over rather than left pointing at a discarded
	 * element: a page-list entry can name an <a> as the place a page begins.
	 */
	_flattenLinks(root, marks) {
		let doc = root.ownerDocument;
		if (!doc) return;

		for (let link of [...root.querySelectorAll("a")]) {
			let span = doc.createElement("span");
			for (let name of ["id", "class", "style"]) {
				let value = link.getAttribute(name);
				if (value !== null) span.setAttribute(name, value);
			}
			while (link.firstChild) span.appendChild(link.firstChild);
			if (!link.parentNode) continue;
			link.parentNode.replaceChild(span, link);

			for (let mark of marks || []) {
				if (mark.node === link) mark.node = span;
			}
		}
	},

	/**
	 * The book cut into one piece per printed page.
	 *
	 * A page mark rarely sits between two paragraphs; it sits inside one, and
	 * everything after it belongs to the next page. So the tree is copied
	 * rather than sliced: elements that hold no mark are cloned whole, and
	 * those that do are walked into, with their ancestors mirrored again in
	 * the piece that follows. That keeps every piece well formed — a half
	 * paragraph in a page of its own, with its own <p> around it.
	 *
	 * @returns {Array<{label: string|null, node: Element, section: number,
	 *                  mark: Element|null}>}
	 */
	_buildPages(out, sections) {
		let pages = [];
		let current = -1;

		let openPage = (label, cfi) => {
			pages.push({
				label,
				cfi: cfi || null,
				node: out.createElement("div"),
				chain: new Map(),
			});
			current = pages.length - 1;
		};
		// What comes before the first mark is the book's front matter: kept,
		// because a reader looking for the title page should find it, and
		// labelled with nothing because it carries no printed number
		openPage(null, null);

		let mirror = (path) => {
			let page = pages[current];
			let parent = page.node;
			for (let el of path) {
				let clone = page.chain.get(el);
				if (!clone) {
					clone = out.importNode(el.cloneNode(false), false);
					page.chain.set(el, clone);
					parent.appendChild(clone);
				}
				parent = clone;
			}
			return parent;
		};

		let walk = (node, path, marks, ancestors) => {
			for (let child of Array.prototype.slice.call(node.childNodes)) {
				if (marks.has(child)) {
					let mark = marks.get(child);
					openPage(mark.label, mark.cfi);
					// A pagebreak span is a marker and nothing else. A node
					// the navigation pointed at is the heading or paragraph
					// the page opens with, and belongs in it.
					if (mark.inline) continue;
					mirror(path).appendChild(out.importNode(child, true));
					continue;
				}
				if (child.nodeType === 3) {
					let text = String(child.data || "");
					if (!text.trim() && !pages[current].node.childNodes.length) {
						continue;   // no page starts with the whitespace of the last
					}
					mirror(path).appendChild(out.createTextNode(text));
					continue;
				}
				if (child.nodeType !== 1) continue;
				let name = (child.tagName || "").toLowerCase();
				if (name === "script" || name === "style") continue;

				if (ancestors.has(child)) {
					walk(child, path.concat([child]), marks, ancestors);
				} else {
					mirror(path).appendChild(out.importNode(child, true));
				}
			}
		};

		for (let section of sections) {
			let body = section.doc && this._bodyOf(section.doc);
			if (!body) continue;

			let marks = new Map();
			let ancestors = new Set();
			for (let mark of section.marks || []) {
				marks.set(mark.node, mark);
				for (let at = mark.node.parentNode; at && at !== body.parentNode;
					at = at.parentNode) {
					ancestors.add(at);
				}
			}
			walk(body, [], marks, ancestors);
			// The mirrored chain belongs to one section's elements; the next
			// section brings different ones, and a page carrying on across
			// the boundary starts a fresh chain for them
			pages[current].chain.clear();
		}

		return pages.filter((page) => page.node.childNodes.length);
	},

	/**
	 * The contact sheet of a paginated book.
	 *
	 * Each tile is a page-shaped box holding that page's own text at its own
	 * typography, scaled down. It is not a facsimile — the printed layout
	 * lives in the PDF and nowhere in the EPUB — but it is that page's
	 * content, and enough to see where a table sits or a chapter begins.
	 */
	async _buildSheet(zip, sections, title, env, pkg) {
		let out = zotLookUtil.newHtmlDocument();
		if (!out) return null;
		out.title = title;

		// First of all, and on trees nothing has touched yet.
		//
		// A CFI is a path counted through siblings, and it has to describe the
		// book as Zotero's reader will open it — not as this page ends up.
		// Drawing an annotation wraps text in a <span>, sanitising drops a
		// <script>, and either shifts every index after it. So the marks are
		// found and their CFIs written down before any of that happens, and
		// what the tiles carry afterwards is a string, not a position in a
		// tree that has since moved.
		await this._attachPageMarks(zip, pkg, sections);

		let seenCssUrls = new Set();
		let seenInlineCss = new Set();
		let written = new Map();

		let sectionIndex = -1;
		for (let section of sections) {
			sectionIndex++;
			let doc = section.doc;
			let body = doc && this._bodyOf(doc);
			if (!body) continue;

			// The marked-up pages are the ones worth picking out of a sheet,
			// which is the same reason the PDF sheet renders the annotated
			// copy rather than the stored file.
			this._markSection(doc, sectionIndex, env.annotations);

			let cut = section.href.lastIndexOf("/");
			let fileDir = cut === -1 ? "" : section.href.substring(0, cut);
			await this._collectStyles(
				zip, doc, fileDir, out, seenCssUrls, seenInlineCss, env, written
			);
			zotLookUtil.sanitize(body);
			await this._rewriteUrls(zip, body, fileDir, env, written);
			this._flattenLinks(body, section.marks);
		}

		let pages = this._buildPages(out, sections);
		if (!pages.some((page) => page.label)) {
			// Not a failure: most reflowable books simply have no printed
			// edition to be paginated after, and saying so is the answer.
			this.log("No printed page numbers in this book");
			return this._sheetNotice(out, title);
		}

		out.body.className = "epub-sheet-body";
		let grid = out.createElement("div");
		grid.className = "epub-sheet";
		for (let page of pages) {
			grid.appendChild(this._pageTile(out, page, env));
		}
		out.body.appendChild(grid);

		let base = out.createElement("style");
		base.textContent = this.BASE_CSS + "\n" + this.SHEET_CSS;
		out.head.appendChild(base);
		return zotLookUtil.serializeHtmlDocument(out);
	},

	/**
	 * What a book without printed pages gets instead.
	 *
	 * An EPUB reflows, so it has no pages of its own; the numbers a page sheet
	 * shows are a print edition's, carried along in the file. Where the
	 * publisher did not carry them, no amount of work will invent them, and a
	 * sheet of arbitrary slices would be worse than none.
	 */
	_sheetNotice(out, title) {
		out.body.className = "epub-sheet-body";
		let box = out.createElement("div");
		box.className = "epub-sheet-notice";

		let head = out.createElement("h1");
		head.textContent = title;
		box.appendChild(head);

		let text = out.createElement("p");
		text.textContent = this.NO_PAGES_LABEL;
		box.appendChild(text);

		let hint = out.createElement("p");
		hint.className = "epub-sheet-hint";
		hint.textContent = this.NO_PAGES_HINT;
		box.appendChild(hint);

		out.body.appendChild(box);
		let base = out.createElement("style");
		base.textContent = this.BASE_CSS + "\n" + this.SHEET_CSS;
		out.head.appendChild(base);
		return zotLookUtil.serializeHtmlDocument(out);
	},

	NO_PAGES_LABEL: "This book carries no printed page numbers.",
	NO_PAGES_HINT: "An EPUB reflows and has no pages of its own. A page "
		+ "overview can only show the pagination of a printed edition where "
		+ "the file carries it — this one does not. Use the ordinary preview "
		+ "to read the book.",

	/** One tile: the page, its number, and a way into the reader. */
	_pageTile(out, page, env) {
		let tile = out.createElement("div");
		tile.className = "epub-page";

		let paper = out.createElement("div");
		paper.className = "epub-paper";
		let inner = out.createElement("div");
		inner.className = "epub-paper-inner";
		inner.appendChild(page.node);
		paper.appendChild(inner);

		if (page.cfi && env.readerLink) {
			let link = out.createElement("a");
			// New window for the same measured reason the PDF sheet uses it:
			// Quick Look refuses ordinary navigation but hands a new-window
			// request to the system, and Sushi ignores it rather than
			// replacing the sheet with an error box
			link.setAttribute("target", "_blank");
			link.setAttribute(
				"href",
				env.readerLink + "?cfi=" + encodeURIComponent(page.cfi)
			);
			link.appendChild(paper);
			tile.appendChild(link);
		} else {
			tile.appendChild(paper);
		}

		let label = out.createElement("div");
		label.className = "epub-page-label";
		label.textContent = page.label || this.FRONT_LABEL;
		tile.appendChild(label);
		return tile;
	},

	FRONT_LABEL: "Before page one",

	// ── Printed pages ─────────────────────────────────────────────────
	//
	// A reflowable book has no pages, which is the whole point of the format
	// and the reason a contact sheet of one seemed impossible. But a book
	// published beside a print edition carries the print edition's pagination
	// anyway: EPUB 3 marks it with epub:type="pagebreak" and lists it in a
	// page-list navigation, EPUB 2 in the NCX's pageList. In a library of
	// 1175 books, a sample of 120 found it in about one in eight — and those
	// were the academic ones, Springer and O'Reilly and textbooks.
	//
	// Where it is there, the book can be cut at those marks and shown a page
	// at a time. Where it is not, saying so is the honest answer.

	/**
	 * Hangs each section's page marks on it, ready for the split.
	 *
	 * The navigation is read first because it is the book's own statement of
	 * what its pages are; the marks in the text are what the split actually
	 * cuts at. Where both are there they agree, and the text wins, because a
	 * position is what is needed and a list of hrefs is not.
	 */
	async _attachPageMarks(zip, pkg, sections) {
		let listed = [];
		try {
			listed = await this._readPageList(zip, pkg.doc, pkg.dir);
		} catch (e) {
			this.log("Could not read the page list: " + e);
		}

		let byFile = new Map();
		for (let entry of listed) {
			if (!byFile.has(entry.href)) byFile.set(entry.href, []);
			byFile.get(entry.href).push(entry);
		}

		let total = 0;
		let addressed = 0;
		for (let section of sections) {
			section.marks = section.doc
				? this._pageMarksIn(section.doc, byFile.get(section.href))
				: [];
			total += section.marks.length;

			let spinePos = pkg.spineFor && pkg.spineFor.get(section.href);
			if (typeof spinePos !== "number") continue;
			let body = this._bodyOf(section.doc);
			for (let mark of section.marks) {
				mark.cfi = this._markCfi(pkg.spineStep, spinePos, mark, body);
				if (mark.cfi) addressed++;
			}
		}
		this.log("Page marks found: " + total
			+ " (page list: " + listed.length
			+ ", addressable: " + addressed + ")");
	},

	/**
	 * A CFI naming where a page begins, in the form the reader can follow.
	 *
	 * A collapsed CFI naming the empty pagebreak <span> alone gives epub.js no
	 * range to set and the reader arrives nowhere, so a range is needed. The
	 * text after the mark is the page's first character — but a mark sits
	 * mid-paragraph, in a paragraph that began on the previous printed page,
	 * and a range starting there leaves the mark just above the fold, so the
	 * reader's page indicator reads the previous page. The range is therefore
	 * anchored at the mark itself and closed one character into that text:
	 * the reader scrolls the mark to the top and reads this page, which is
	 * what the book's own page-list entry points at. A mark taken from the
	 * navigation is a heading that contains its text and starts its own line;
	 * there the plain text range already lands right, and forRange declines.
	 */
	_markCfi(spineStep, spinePos, mark, body) {
		let text = this._firstTextFrom(mark.node, body);
		if (!text) return null;
		if (mark.inline) {
			let ranged = zotLookCfi.forRange(
				spineStep, spinePos, mark.node, text, 1
			);
			if (ranged) return ranged;
		}
		return zotLookCfi.forTextRange(spineStep, spinePos, text, 0, 1);
	},

	/**
	 * The first text node at or after a node, in document order.
	 *
	 * A mark resolved out of the navigation is a heading, and its text is
	 * inside it; a pagebreak span is empty, and the text is what follows.
	 * Both are the same forward walk.
	 */
	_firstTextFrom(node, root) {
		let at = node;
		while (at) {
			if (at.nodeType === 3 && String(at.data || "").trim()) return at;

			if (at.firstChild) {
				at = at.firstChild;
				continue;
			}
			while (at && at !== root && !at.nextSibling) {
				at = at.parentNode;
			}
			if (!at || at === root) return null;
			at = at.nextSibling;
		}
		return null;
	},

	/**
	 * The page marks of one section, in document order.
	 *
	 * Taken from the marks themselves where the book sets them, which is the
	 * common case and needs nothing else. A book that lists its pages in the
	 * navigation but sets no marks in the text is met by looking its listed
	 * fragments up by id.
	 *
	 * @returns {Array<{label: string, node: Element}>}
	 */
	_pageMarksIn(doc, listed) {
		let marks = [];
		let body = this._bodyOf(doc);
		if (!body) return marks;

		for (let el of body.querySelectorAll("*")) {
			let type = (el.getAttributeNS
				&& el.getAttributeNS(this.EPUB_NS, "type"))
				|| el.getAttribute("epub:type");
			let role = el.getAttribute("role");
			let isMark =
				(type && /\bpagebreak\b/.test(type)) ||
				(role && /\bdoc-pagebreak\b/.test(role));
			if (!isMark) continue;
			marks.push({ label: this._markLabel(el), node: el, inline: true });
		}
		if (marks.length) return marks;

		// Nothing in the text: fall back to what the navigation listed
		for (let entry of listed || []) {
			if (!entry.id) continue;
			let node = doc.getElementById && doc.getElementById(entry.id);
			if (node) marks.push({ label: entry.label, node, inline: false });
		}
		// Listed order is the book's order, but ids are looked up one by one,
		// so put them back into the order the document has them in
		marks.sort((a, b) => this._precedes(a.node, b.node) ? -1 : 1);
		return marks;
	},

	EPUB_NS: "http://www.idpf.org/2007/ops",

	/** The printed number a mark carries. */
	_markLabel(el) {
		for (let name of ["title", "aria-label", "id"]) {
			let value = (el.getAttribute(name) || "").trim();
			if (!value) continue;
			// An id is a last resort and usually reads "PB212"
			if (name === "id") {
				let digits = value.replace(/^[^0-9ivxlcIVXLC]*/, "");
				return digits || value;
			}
			return value;
		}
		return this._collapse(el.textContent || "");
	},

	/** Whether a comes before b in the document. */
	_precedes(a, b) {
		if (!a || !b || a === b) return false;
		if (typeof a.compareDocumentPosition === "function") {
			// DOCUMENT_POSITION_FOLLOWING
			return (a.compareDocumentPosition(b) & 4) !== 0;
		}
		return false;
	},

	/**
	 * The page-list a book carries, as {label, href, id} per entry.
	 *
	 * EPUB 3 keeps it in the navigation document beside the table of
	 * contents; EPUB 2 in the NCX the spine points at. Both are read, the
	 * newer first, exactly as the contents are.
	 */
	async _readPageList(zip, opfDoc, opfDir) {
		let navHref = null;
		for (let item of opfDoc.querySelectorAll("manifest item")) {
			let props = (item.getAttribute("properties") || "").split(/\s+/);
			if (props.includes("nav")) {
				navHref = item.getAttribute("href");
				break;
			}
		}
		if (navHref) {
			let target = zotLookUtil.resolveRelativePath(navHref, opfDir);
			let entries = target
				? await this._readPageListDocument(zip, target.path)
				: [];
			if (entries.length) return entries;
		}

		let spine = opfDoc.querySelector("spine");
		let toc = spine && spine.getAttribute("toc");
		if (toc) {
			for (let item of opfDoc.querySelectorAll("manifest item")) {
				if (item.getAttribute("id") !== toc) continue;
				let target = zotLookUtil.resolveRelativePath(
					item.getAttribute("href"),
					opfDir
				);
				if (target) return this._readNcxPageList(zip, target.path);
			}
		}
		return [];
	},

	/** EPUB 3: <nav epub:type="page-list"> in the navigation document. */
	async _readPageListDocument(zip, path) {
		let doc = await this._readEntryDoc(zip, path);
		if (!doc) return [];
		let nav = null;
		for (let candidate of doc.querySelectorAll("nav")) {
			let type = candidate.getAttribute("epub:type") || "";
			if (/\bpage-list\b/.test(type)) {
				nav = candidate;
				break;
			}
		}
		if (!nav) return [];
		let cut = path.lastIndexOf("/");
		let dir = cut === -1 ? "" : path.substring(0, cut);
		return this._pageEntries(nav.querySelectorAll("a"), dir, (a) =>
			this._collapse(a.textContent || "")
		);
	},

	/** EPUB 2: <pageList> in the NCX. */
	async _readNcxPageList(zip, path) {
		let doc = await this._readEntryDoc(zip, path);
		if (!doc) return [];
		let list = this._findByLocalName(doc, "pagelist");
		if (!list) return [];
		let cut = path.lastIndexOf("/");
		let dir = cut === -1 ? "" : path.substring(0, cut);

		let named = (el, name) =>
			(el.localName || el.nodeName || "").toLowerCase()
				.replace(/^.*:/, "") === name;

		let entries = [];
		for (let target of [...list.children]) {
			if (!named(target, "pagetarget")) continue;
			let content = this._findByLocalName(target, "content");
			let label = this._findByLocalName(target, "text");
			if (!content) continue;
			let href = content.getAttribute("src") || "";
			let resolved = this._splitHref(href, dir);
			if (!resolved) continue;
			entries.push({
				label: this._collapse(label ? label.textContent : "") ||
					resolved.id,
				href: resolved.path,
				id: resolved.id,
			});
		}
		return entries;
	},

	_pageEntries(anchors, dir, labelOf) {
		let entries = [];
		for (let a of anchors) {
			let resolved = this._splitHref(a.getAttribute("href") || "", dir);
			if (!resolved) continue;
			entries.push({
				label: labelOf(a) || resolved.id,
				href: resolved.path,
				id: resolved.id,
			});
		}
		return entries;
	},

	/** An href out of a navigation, as {path, id}. */
	_splitHref(href, dir) {
		let hash = href.indexOf("#");
		let file = hash >= 0 ? href.slice(0, hash) : href;
		let id = hash >= 0 ? href.slice(hash + 1) : "";
		if (!file) return null;
		let target = zotLookUtil.resolveRelativePath(file, dir);
		return target ? { path: target.path, id } : null;
	},

	// ── Annotations ───────────────────────────────────────────────────
	//
	// A PDF gets its annotations from Zotero itself: PDFWorker.export bakes
	// them into a copy. There is no such export for an epub, so they are
	// placed here — but placed the way Zotero placed them, by resolving the
	// EPUB CFI it stored against the very document the CFI was written
	// against. That document is what getSectionDocuments() hands over, which
	// is why the marking happens per section, before the page is assembled:
	// afterwards the tree the CFI describes no longer exists.
	//
	// See cfi.js for the notation itself.

	/**
	 * Marks up every annotation belonging to one section.
	 *
	 * @param {number} sectionIndex position of the section in the spine
	 * @returns {Set} the annotations that were placed
	 */
	_markSection(doc, sectionIndex, annotations) {
		let placed = new Set();
		if (!annotations || !annotations.length) return placed;

		for (let annotation of annotations) {
			let parsed = zotLookCfi.parse(this._cfiOf(annotation));
			if (!parsed) continue;
			if (zotLookCfi.spineIndex(parsed) !== sectionIndex) continue;

			let range = zotLookCfi.resolve(doc, parsed);
			if (!range) {
				this.log("Could not resolve a CFI in section " + sectionIndex);
				continue;
			}
			// The anchor goes on the piece that comes first in reading order:
			// a range crossing element boundaries becomes several wrappers,
			// an id may occur once, and a reader following the link should
			// arrive at the beginning of the passage rather than its end.
			let anchor = this._annotationAnchor(annotations.indexOf(annotation));
			let wrapped = zotLookCfi.wrapRange(range, (at) => {
				let span = doc.createElement("span");
				span.setAttribute("class", "zotlook-annotation");
				span.setAttribute("style", this._annotationStyle(annotation));
				if (at === 0) span.setAttribute("id", anchor);
				return span;
			});
			if (wrapped) placed.add(annotation);
		}
		return placed;
	},

	/** The anchor of one annotation, named the same on both sides. */
	_annotationAnchor(index) {
		return "zotlook-annot" + index;
	},

	/**
	 * The CFI out of what Zotero stored: a FragmentSelector whose value is
	 * the identifier. Taken as an object or as the JSON it is kept in.
	 */
	_cfiOf(annotation) {
		let position = annotation && annotation.position;
		if (!position) return null;
		if (typeof position === "string") {
			let text = position.trim();
			if (text.startsWith("epubcfi(")) return text;
			try {
				position = JSON.parse(text);
			} catch (badJson) {
				this.log('Unreadable annotation position: ' + badJson);
				return null;
			}
		}
		return position && typeof position.value === "string"
			? position.value
			: null;
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
	_annotationStyle(annotation) {
		let colour = this._annotationColour(annotation.color);
		if (annotation.type === "underline") {
			return (
				"text-decoration: underline; text-decoration-color: " +
				colour.value +
				"; text-decoration-thickness: 2px; text-underline-offset: 2px;"
			);
		}
		return "background-color: " + this._halfOpaque(colour) + ";";
	},

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
	_annotationColour(value) {
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
	_halfOpaque(colour) {
		return colour.hex ? colour.value + "80" : colour.value;
	},

	/** Whitespace as a reader sees it, for the list above the book. */
	_collapse(value) {
		return String(value).replace(/\s+/g, " ").trim();
	},

	/**
	 * Every annotation, in reading order, above the book.
	 *
	 * Notes carry no text to mark, comments belong to no particular word, and
	 * a highlight whose wording the markup broke differently cannot be found
	 * — all three would simply be missing otherwise. Folded away like the
	 * table of contents, so it costs nothing to a reader who wants the book.
	 */
	_buildAnnotationList(out, annotations, placed) {
		if (!annotations || !annotations.length) return null;

		let ordered = [...annotations].sort((a, b) =>
			String(a.sortIndex || "").localeCompare(String(b.sortIndex || ""))
		);

		let details = out.createElement("details");
		details.className = "epub-annotations";
		let summary = out.createElement("summary");
		summary.textContent =
			this.ANNOTATIONS_LABEL + " (" + ordered.length + ")";
		details.appendChild(summary);

		let list = out.createElement("ol");
		list.className = "epub-annotation-list";
		for (let annotation of ordered) {
			let text = this._collapse(annotation.text || "");
			let comment = this._collapse(annotation.comment || "");
			if (!text && !comment) continue;

			let entry = out.createElement("li");
			let swatch = out.createElement("span");
			swatch.className = "epub-annotation-swatch";
			swatch.setAttribute(
				"style",
				// Solid here: the reader shows the swatch in the full colour
				// and only the passage at half
				"background-color: " +
					this._annotationColour(annotation.color).value +
					";"
			);

			// A note has no passage and nothing to reveal: swatch, comment,
			// done. Anything quoted gets a fold, so that a list of long
			// passages stays a list rather than becoming the book again.
			if (!text) {
				entry.appendChild(swatch);
				let note = out.createElement("span");
				note.className = "epub-annotation-comment";
				note.textContent = comment;
				entry.appendChild(note);
				list.appendChild(entry);
				continue;
			}

			let fold = out.createElement("details");
			fold.className = "epub-annotation-entry";
			let summary = out.createElement("summary");
			summary.appendChild(swatch);

			let quote = out.createElement("q");
			quote.textContent = text;
			// Marked here as it is marked in the book — which is also how
			// Zotero shows it in its own annotation list: the same span, the
			// same style, `annotation-text` beside a menu button and a hint.
			// A swatch alone says which colour; this says what was done.
			quote.setAttribute("style", this._annotationStyle(annotation));
			// Two lines when closed, all of it when open — one copy of the
			// text either way, cut by the stylesheet rather than here, so
			// nothing is lost and nothing is duplicated.
			if (!placed.has(annotation)) {
				quote.className = "epub-annotation-unplaced";
			}
			summary.appendChild(quote);
			fold.appendChild(summary);

			let detail = out.createElement("div");
			detail.className = "epub-annotation-detail";
			if (comment) {
				let note = out.createElement("span");
				note.className = "epub-annotation-comment";
				note.textContent = comment;
				detail.appendChild(note);
			}
			if (placed.has(annotation)) {
				let link = out.createElement("a");
				link.setAttribute(
					"href",
					"#" + this._annotationAnchor(annotations.indexOf(annotation))
				);
				link.className = "epub-annotation-goto";
				link.textContent = this.GOTO_LABEL;
				detail.appendChild(link);
			}
			fold.appendChild(detail);

			entry.appendChild(fold);
			list.appendChild(entry);
		}
		if (!list.childNodes.length) return null;

		details.appendChild(list);
		return details;
	},

	/** One document reference, resolved into the archive and written out. */
	async _assetUrl(zip, value, baseDir, env, written) {
		let target = zotLookUtil.resolveRelativePath(value, baseDir);
		if (!target) return null;
		return this._asset(zip, target.path, env, written);
	},
};
