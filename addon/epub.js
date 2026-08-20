/* eslint-disable no-unused-vars */
/* global Zotero, PathUtils, IOUtils, ZotLookUtil */

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
var ZotLookEpub = {
	UNZIP_TIMEOUT_MS: 60000,

	// epubPath -> { mtime, size, html }
	_cache: new Map(),

	// Applied on top of the book's own stylesheets, so it has to come last in
	// the head and win the specificity fight
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

		let html = await this._buildHtml(spineFiles, title);
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
				ZotLookUtil.safeName(baseName, 80) +
				"_" +
				ZotLookUtil.hashString(epubPath)
		);
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
			let result = await env.runProcess(
				"/usr/bin/unzip",
				["-o", "-q", epubPath, "-d", extractDir],
				{ timeoutMs: this.UNZIP_TIMEOUT_MS }
			);
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

		let doc = ZotLookUtil.parseStrict(text, "application/xml");
		if (doc) return doc;

		this.log("Malformed XML, retrying leniently: " + path);
		return ZotLookUtil.parseLoose(text);
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

	// ── Document assembly ─────────────────────────────────────────────

	/**
	 * Concatenates the chapter bodies into one document, carrying over the
	 * stylesheets each chapter declares.
	 *
	 * @returns {Promise<string|null>} serialised HTML
	 */
	async _buildHtml(spineFiles, title) {
		let out = ZotLookUtil.newHtmlDocument();
		if (!out) {
			this.log("Could not create output document");
			return null;
		}
		out.title = title;

		let seenCssUrls = new Set();
		let seenInlineCss = new Set();
		let chapters = 0;

		for (let filePath of spineFiles) {
			let doc = await this._readChapter(filePath);
			let body = doc && this._bodyOf(doc);
			if (!body) continue;

			let fileDir = PathUtils.parent(filePath);

			this._collectStyles(doc, fileDir, out, seenCssUrls, seenInlineCss);

			ZotLookUtil.sanitize(body);
			this._rewriteUrls(body, fileDir);

			if (chapters > 0) {
				let hr = out.createElement("hr");
				hr.className = "epub-chapter-break";
				out.body.appendChild(hr);
			}
			for (let node of [...body.childNodes]) {
				out.body.appendChild(out.importNode(node, true));
			}
			chapters++;
		}

		if (chapters === 0) {
			this.log("No readable spine content");
			return null;
		}

		// Last in the head, so it overrides the book's own rules
		let base = out.createElement("style");
		base.textContent = this.BASE_CSS;
		out.head.appendChild(base);

		return ZotLookUtil.serializeHtmlDocument(out);
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

		let doc = ZotLookUtil.parseStrict(text, "application/xhtml+xml");
		if (doc && this._bodyOf(doc)) return doc;

		this.log("Not well-formed XHTML, parsing leniently: " + filePath);
		return ZotLookUtil.parseLoose(text);
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
			let url = ZotLookUtil.resolveFileUrl(href, fileDir);
			if (!url || seenCssUrls.has(url)) continue;
			seenCssUrls.add(url);

			let el = out.createElement("link");
			el.setAttribute("rel", "stylesheet");
			el.setAttribute("href", url);
			out.head.appendChild(el);
		}

		for (let style of doc.querySelectorAll("head style")) {
			let css = ZotLookUtil.rewriteCssUrls(style.textContent, fileDir);
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
				let resolved = ZotLookUtil.resolveFileUrl(value, baseDir);
				if (resolved) el.setAttribute(name, resolved);
			}

			// Inline SVG uses the xlink namespace for image references
			let xlinkHref = el.getAttributeNS(XLINK, "href");
			if (xlinkHref) {
				let resolved = ZotLookUtil.resolveFileUrl(
					xlinkHref,
					baseDir
				);
				if (resolved) {
					el.setAttributeNS(XLINK, "xlink:href", resolved);
				}
			}

			if (el.tagName && el.tagName.toLowerCase() === "style") {
				el.textContent = ZotLookUtil.rewriteCssUrls(
					el.textContent,
					baseDir
				);
			}

			let styleAttr = el.getAttribute("style");
			if (styleAttr) {
				el.setAttribute(
					"style",
					ZotLookUtil.rewriteCssUrls(styleAttr, baseDir)
				);
			}
		}
	},
};
