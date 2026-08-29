/* eslint-disable no-unused-vars */
/* global Zotero, PathUtils, IOUtils, Services, zotLookUtil */

/**
 * Renders an epub into a single HTML page that QuickLook can display.
 *
 * macOS has no native epub preview, so the book is unzipped into a temp
 * directory, its spine walked in reading order, and every chapter body
 * concatenated into one document. The book's own stylesheets are carried over
 * so the original typography survives.
 *
 * The only things this needs from the host plugin are a temp directory and a
 * way to run a subprocess; see convert().
 */
var zotLookEpub = {
	UNZIP_TIMEOUT_MS: 60000,

	// epubPath -> { mtime, size, html }
	_cache: new Map(),

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
		"details.epub-toc {",
		"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
		"  font-size: 15px;",
		"  background: #f4f4f2;",
		"  border: 1px solid #e2e2de;",
		"  border-radius: 8px;",
		"  padding: 0.8em 1.2em;",
		"  margin: 0 0 3em 0;",
		"}",
		"details.epub-toc > summary {",
		"  cursor: default;",
		"  font-weight: 600;",
		"  letter-spacing: 0.02em;",
		"}",
		"details.epub-toc[open] > summary { margin-bottom: 0.7em; }",
		"ol.epub-toc-list { list-style: none; margin: 0; padding: 0; }",
		"ol.epub-toc-list li { margin: 0.15em 0; }",
		"ol.epub-toc-list a {",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"  border-bottom: 1px solid transparent;",
		"}",
		"ol.epub-toc-list a:hover { border-bottom-color: #999; }",
		"li.epub-toc-level1 { padding-left: 1.4em; font-size: 0.95em; }",
		"li.epub-toc-level2 { padding-left: 2.8em; font-size: 0.92em; }",
		"@media print { details.epub-toc { display: none; } }",
	].join("\n"),

	log(msg) {
		Zotero.debug("zotLook/epub: " + msg);
	},

	/**
	 * @param {string} epubPath
	 * @param {object} env
	 * @param {string} env.tempDir - directory to extract into
	 * @param {function} env.runProcess - (command, args, opts) => {exitCode}
	 * @returns {Promise<string|null>} path to the generated HTML, or null
	 */
	async convert(epubPath, env) {
		let stat = await this._stat(epubPath);

		// Unzipping and reassembling a book takes seconds. Reuse the previous
		// result while the source is unchanged, so holding Space does not
		// re-extract the same epub over and over.
		let cached = this._cache.get(epubPath);
		if (
			cached &&
			stat &&
			cached.mtime === stat.lastModified &&
			cached.size === stat.size &&
			(await IOUtils.exists(cached.html))
		) {
			this.log("Reusing cached preview: " + cached.html);
			return cached.html;
		}

		let baseName = PathUtils.filename(epubPath).replace(/\.epub$/i, "");
		let extractDir = this._extractDirFor(epubPath, baseName, env.tempDir);

		if (!(await this._unpack(epubPath, extractDir, env))) return null;

		let pkg = await this._readPackage(extractDir);
		if (!pkg) return null;

		let title = this._readTitle(pkg.doc, baseName);
		let spineFiles = this._resolveSpine(pkg.doc, pkg.dir);
		if (spineFiles.length === 0) {
			this.log("No spine items resolved");
			return null;
		}

		let nav = await this._readNav(pkg.doc, pkg.dir);
		let html = await this._buildHtml(spineFiles, title, nav);
		if (!html) return null;

		let outputPath = PathUtils.join(extractDir, "preview.html");
		await IOUtils.writeUTF8(outputPath, html);
		this.log("Wrote preview: " + outputPath);

		if (stat) {
			this._cache.set(epubPath, {
				mtime: stat.lastModified,
				size: stat.size,
				html: outputPath,
			});
		}

		return outputPath;
	},

	/**
	 * Drops every cached preview. The host calls this after wiping the temp
	 * directory the cached files lived in.
	 */
	clearCache() {
		this._cache.clear();
	},

	// ── Unpacking ─────────────────────────────────────────────────────

	async _stat(path) {
		try {
			return await IOUtils.stat(path);
		} catch (e) {
			this.log("Could not stat " + path + ": " + e);
			return null;
		}
	},

	/**
	 * Derived from the source path rather than a timestamp, so a stale copy is
	 * replaced instead of accumulating. The hash keeps two books with the same
	 * sanitised name apart.
	 */
	_extractDirFor(epubPath, baseName, tempDir) {
		return PathUtils.join(
			tempDir,
			"epub_" +
				zotLookUtil.safeName(baseName, 80) +
				"_" +
				zotLookUtil.hashString(epubPath)
		);
	},

	/**
	 * The extractor for this platform. /usr/bin/unzip is where macOS and the
	 * Linux distributions keep it, but it is not a Windows tool; there bsdtar
	 * has shipped with the system since Windows 10, and it reads zip
	 * archives — the epub container included — detecting the format itself.
	 */
	_unpackCommand(epubPath, extractDir) {
		if (Zotero.isWin) {
			let root = "C:\\Windows";
			try {
				root = Services.env.get("SystemRoot") || root;
			} catch (e) {
				// Services.env is a recent arrival; the default serves
			}
			return {
				command: root + "\\System32\\tar.exe",
				args: ["-xf", epubPath, "-C", extractDir],
			};
		}
		return {
			command: "/usr/bin/unzip",
			args: ["-o", "-q", epubPath, "-d", extractDir],
		};
	},

	async _unpack(epubPath, extractDir, env) {
		try {
			await IOUtils.remove(extractDir, {
				recursive: true,
				ignoreAbsent: true,
			});
		} catch (e) {
			this.log("Could not clear previous extract dir: " + e);
		}
		await IOUtils.makeDirectory(extractDir, { ignoreExisting: true });

		this.log("Extracting: " + epubPath);
		try {
			let { command, args } = this._unpackCommand(epubPath, extractDir);
			let result = await env.runProcess(command, args, {
				timeoutMs: this.UNZIP_TIMEOUT_MS,
			});
			if (result.exitCode !== 0) {
				this.log("unzip failed with code " + result.exitCode);
				return false;
			}
		} catch (e) {
			this.log("Failed to unzip: " + e);
			return false;
		}
		return true;
	},

	// ── Package metadata ──────────────────────────────────────────────

	/**
	 * Follows META-INF/container.xml to the OPF package document.
	 *
	 * @returns {Promise<{doc: Document, dir: string}|null>}
	 */
	async _readPackage(extractDir) {
		let containerPath = PathUtils.join(
			extractDir,
			"META-INF",
			"container.xml"
		);
		let containerDoc = await this._readPackageDoc(containerPath);
		if (!containerDoc) {
			this.log("Unusable META-INF/container.xml");
			return null;
		}

		let rootfile = containerDoc.querySelector("rootfile");
		let opfRel = rootfile && rootfile.getAttribute("full-path");
		if (!opfRel) {
			this.log("No rootfile in container.xml");
			return null;
		}

		let opfPath = this._joinRelative(extractDir, opfRel);
		if (!opfPath) return null;

		let opfDoc = await this._readPackageDoc(opfPath);
		if (!opfDoc) {
			this.log("Unusable OPF: " + opfPath);
			return null;
		}

		return { doc: opfDoc, dir: PathUtils.parent(opfPath) };
	},

	/**
	 * Reads container.xml or the OPF. Both are required to be well-formed XML,
	 * but shipped epubs are not always, so a file the XML parser rejects is
	 * retried with the lenient HTML parser rather than abandoned: the element
	 * names we look for survive either way.
	 */
	async _readPackageDoc(path) {
		if (!(await IOUtils.exists(path))) {
			this.log("Missing: " + path);
			return null;
		}
		let text;
		try {
			text = await IOUtils.readUTF8(path);
		} catch (e) {
			this.log("Failed to read " + path + ": " + e);
			return null;
		}

		let doc = zotLookUtil.parseStrict(text, "application/xml");
		if (doc) return doc;

		this.log("Malformed XML, retrying leniently: " + path);
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
	 * Joins a percent-encoded, forward-slashed relative path onto a directory.
	 */
	_joinRelative(dir, relative) {
		let decoded;
		try {
			decoded = decodeURIComponent(relative);
		} catch (e) {
			this.log("Undecodable path: " + relative);
			return null;
		}
		return PathUtils.join(dir, ...decoded.split("/").filter((p) => p));
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
	 * The spine lists chapters in reading order by manifest id.
	 *
	 * @returns {string[]} absolute chapter paths
	 */
	_resolveSpine(opfDoc, opfDir) {
		let manifest = new Map();
		for (let item of opfDoc.querySelectorAll("manifest item")) {
			let id = item.getAttribute("id");
			let href = item.getAttribute("href");
			if (id && href) manifest.set(id, href);
		}

		let files = [];
		for (let ref of opfDoc.querySelectorAll("spine itemref")) {
			let href = manifest.get(ref.getAttribute("idref"));
			if (!href) continue;
			let path = this._joinRelative(opfDir, href);
			if (path) files.push(path);
		}
		return files;
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
	async _readNav(opfDoc, opfDir) {
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
			let path = this._joinRelative(opfDir, navHref);
			let entries = path ? await this._readNavDocument(path) : [];
			if (entries.length) return entries;
		}

		// EPUB 2: spine@toc names the manifest id of the NCX
		let spine = opfDoc.querySelector("spine");
		let ncxHref = spine && hrefFor(spine.getAttribute("toc"));
		if (ncxHref) {
			let path = this._joinRelative(opfDir, ncxHref);
			if (path) return this._readNcx(path);
		}
		return [];
	},

	/** EPUB 3: nested <ol> inside the toc <nav>. */
	async _readNavDocument(path) {
		let doc = await this._readChapter(path);
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

		let dir = PathUtils.parent(path);
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
	async _readNcx(path) {
		let doc = await this._readChapter(path);
		if (!doc) return [];

		let dir = PathUtils.parent(path);
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
		let path = file ? this._joinRelative(dir, file) : null;
		if (!path) return;
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
	async _buildHtml(spineFiles, title, nav) {
		let out = zotLookUtil.newHtmlDocument();
		if (!out) {
			this.log("Could not create output document");
			return null;
		}
		out.title = title;

		let seenCssUrls = new Set();
		let seenInlineCss = new Set();
		let chapters = 0;
		// Where each spine file ended up, so a navigation entry naming it can
		// be turned into a link into this one document
		let anchorFor = new Map();

		for (let filePath of spineFiles) {
			let doc = await this._readChapter(filePath);
			let body = doc && this._bodyOf(doc);
			if (!body) continue;

			let fileDir = PathUtils.parent(filePath);

			this._collectStyles(doc, fileDir, out, seenCssUrls, seenInlineCss);

			zotLookUtil.sanitize(body);
			this._rewriteUrls(body, fileDir);

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
		box.setAttribute("open", "");
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
	async _readChapter(filePath) {
		let text;
		try {
			if (!(await IOUtils.exists(filePath))) return null;
			text = await IOUtils.readUTF8(filePath);
		} catch (e) {
			this.log("Failed to read spine file " + filePath + ": " + e);
			return null;
		}

		let doc = zotLookUtil.parseStrict(text, "application/xhtml+xml");
		if (doc && this._bodyOf(doc)) return doc;

		this.log("Not well-formed XHTML, parsing leniently: " + filePath);
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
	_collectStyles(doc, fileDir, out, seenCssUrls, seenInlineCss) {
		for (let link of doc.querySelectorAll("head link")) {
			let rel = link.getAttribute("rel") || "";
			if (!/stylesheet/i.test(rel)) continue;
			let href = link.getAttribute("href");
			if (!href) continue;
			let url = zotLookUtil.resolveFileUrl(href, fileDir);
			if (!url || seenCssUrls.has(url)) continue;
			seenCssUrls.add(url);

			let el = out.createElement("link");
			el.setAttribute("rel", "stylesheet");
			el.setAttribute("href", url);
			out.head.appendChild(el);
		}

		for (let style of doc.querySelectorAll("head style")) {
			let css = zotLookUtil.rewriteCssUrls(style.textContent, fileDir);
			if (seenInlineCss.has(css)) continue;
			seenInlineCss.add(css);

			let el = out.createElement("style");
			el.textContent = css;
			out.head.appendChild(el);
		}
	},

	/**
	 * Points every relative reference in a chapter at the extracted file.
	 */
	_rewriteUrls(root, baseDir) {
		const XLINK = "http://www.w3.org/1999/xlink";
		const URL_ATTRS = ["src", "href", "poster"];

		for (let el of root.querySelectorAll("*")) {
			for (let name of URL_ATTRS) {
				let value = el.getAttribute(name);
				if (value === null) continue;
				let resolved = zotLookUtil.resolveFileUrl(value, baseDir);
				if (resolved) el.setAttribute(name, resolved);
			}

			// Inline SVG uses the xlink namespace for image references
			let xlinkHref = el.getAttributeNS(XLINK, "href");
			if (xlinkHref) {
				let resolved = zotLookUtil.resolveFileUrl(
					xlinkHref,
					baseDir
				);
				if (resolved) {
					el.setAttributeNS(XLINK, "xlink:href", resolved);
				}
			}

			if (el.tagName && el.tagName.toLowerCase() === "style") {
				el.textContent = zotLookUtil.rewriteCssUrls(
					el.textContent,
					baseDir
				);
			}

			let styleAttr = el.getAttribute("style");
			if (styleAttr) {
				el.setAttribute(
					"style",
					zotLookUtil.rewriteCssUrls(styleAttr, baseDir)
				);
			}
		}
	},
};
