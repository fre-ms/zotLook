/* eslint-disable no-unused-vars */
/* global Zotero, ChromeUtils, PathUtils, IOUtils, Services */

var QuickLook = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,

	// Process state
	_proc: null,
	_isActive: false,
	_launching: false,
	_tempDir: null,
	_contactSheetBinary: null,

	// Per-window cleanup tracking
	_windowListeners: new Map(),

	log(msg) {
		Zotero.debug("QuickLook: " + msg);
	},

	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;

		// Clean up any leftover temp files from previous sessions
		this._cleanTempDir();
	},

	// ── Window management ─────────────────────────────────────────────

	addToAllWindows() {
		let windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.addToWindow(win);
		}
	},

	removeFromAllWindows() {
		let windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.removeFromWindow(win);
		}
	},

	addToWindow(window) {
		if (!Zotero.isMac) {
			this.log("QuickLook is only supported on macOS");
			return;
		}

		let doc = window.document;

		// Keyboard listener on items tree (capture phase to intercept
		// before VirtualizedTable's bubble-phase Space handler)
		let itemsTree = doc.getElementById("zotero-items-tree");
		if (!itemsTree) {
			this.log("Could not find zotero-items-tree");
			return;
		}

		let keydownHandler = (event) => this._onKeyDown(event, window);
		itemsTree.addEventListener("keydown", keydownHandler, true);

		let listeners = { keydownHandler, itemsTree };

		// Context menu items
		let menuPopup = doc.getElementById("zotero-itemmenu");
		if (menuPopup) {
			let menuItem = doc.createXULElement("menuitem");
			menuItem.id = "quicklook-menu-item";
			menuItem.setAttribute("label", "Quick Look");
			menuItem.addEventListener("command", () => {
				let items = window.ZoteroPane.getSelectedItems();
				if (items.length > 0) {
					this._openQuickLook(items);
				}
			});
			menuPopup.appendChild(menuItem);

			let contactMenuItem = doc.createXULElement("menuitem");
			contactMenuItem.id = "quicklook-contactsheet-menu-item";
			contactMenuItem.setAttribute("label", "Quick Look Contact Sheet");
			contactMenuItem.addEventListener("command", () => {
				let items = window.ZoteroPane.getSelectedItems();
				if (items.length > 0) {
					this._openContactSheet(items);
				}
			});
			menuPopup.appendChild(contactMenuItem);

			let popupShowHandler = () => this._onMenuShowing(doc);
			menuPopup.addEventListener("popupshowing", popupShowHandler);

			listeners.popupShowHandler = popupShowHandler;
			listeners.menuPopup = menuPopup;
		}

		this._windowListeners.set(window, listeners);
		this.log("Added to window");
	},

	removeFromWindow(window) {
		let listeners = this._windowListeners.get(window);
		if (!listeners) return;

		// Remove keyboard listener
		listeners.itemsTree.removeEventListener(
			"keydown",
			listeners.keydownHandler,
			true
		);

		// Remove context menu listener and elements
		if (listeners.menuPopup && listeners.popupShowHandler) {
			listeners.menuPopup.removeEventListener(
				"popupshowing",
				listeners.popupShowHandler
			);
		}

		let doc = window.document;
		let menuItem = doc.getElementById("quicklook-menu-item");
		if (menuItem) menuItem.remove();
		let contactMenuItem = doc.getElementById(
			"quicklook-contactsheet-menu-item"
		);
		if (contactMenuItem) contactMenuItem.remove();

		this._windowListeners.delete(window);
		this.log("Removed from window");
	},

	// ── Keyboard handling ─────────────────────────────────────────────

	_onKeyDown(event, window) {
		let isSpace =
			event.code === "Space" &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.metaKey &&
			!event.shiftKey;
		let isOptionSpace =
			event.code === "Space" &&
			event.altKey &&
			!event.ctrlKey &&
			!event.metaKey;
		let isShiftSpace =
			event.code === "Space" &&
			event.shiftKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.metaKey;
		let isCmdY =
			event.key === "y" &&
			event.metaKey &&
			!event.ctrlKey &&
			!event.altKey;
		let isEscape = event.key === "Escape";

		// Shift+Space: note preview
		if (isShiftSpace) {
			event.preventDefault();
			event.stopPropagation();

			if (this._isActive) {
				this._closeQuickLook();
			} else {
				let items = window.ZoteroPane.getSelectedItems();
				if (items.length > 0) {
					this._openNotePreview(items);
				}
			}
			return;
		}

		// Option+Space: contact sheet mode
		if (isOptionSpace) {
			event.preventDefault();
			event.stopPropagation();

			if (this._isActive) {
				this._closeQuickLook();
			} else {
				let items = window.ZoteroPane.getSelectedItems();
				if (items.length > 0) {
					this._openContactSheet(items);
				}
			}
			return;
		}

		// Space or Cmd+Y: normal QuickLook
		if (isSpace || isCmdY) {
			event.preventDefault();
			event.stopPropagation();

			if (this._isActive) {
				this._closeQuickLook();
			} else {
				let items = window.ZoteroPane.getSelectedItems();
				if (items.length > 0) {
					this._openQuickLook(items);
				}
			}
			return;
		}

		if (isEscape) {
			if (this._isActive) {
				this._closeQuickLook();
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
	},

	// ── Context menu ──────────────────────────────────────────────────

	_onMenuShowing(doc) {
		let menuItem = doc.getElementById("quicklook-menu-item");
		let contactMenuItem = doc.getElementById(
			"quicklook-contactsheet-menu-item"
		);
		let items = doc.defaultView.ZoteroPane.getSelectedItems();
		let hasItems = items.length > 0;

		if (menuItem) menuItem.hidden = !hasItems;

		// Only show contact sheet option if there are PDF attachments
		if (contactMenuItem) {
			contactMenuItem.hidden = !hasItems;
		}
	},

	// ── QuickLook open/close ──────────────────────────────────────────

	async _openQuickLook(items) {
		if (this._launching) return false;

		let paths = await this._getPreviewPath(items);
		if (paths.length === 0) {
			this.log("No files to preview");
			return false;
		}

		await this._launchQlmanage(paths);
		return true;
	},

	async _openNotePreview(items) {
		if (this._launching) return false;

		let paths = await this._getNotePaths(items);
		if (paths.length === 0) {
			this.log("No notes to preview");
			return false;
		}

		await this._launchQlmanage(paths);
		return true;
	},

	async _openContactSheet(items) {
		if (this._launching) return false;

		// Get only PDF file paths
		let paths = await this._getPreviewPath(items);
		let pdfPaths = paths.filter(
			(p) => p.toLowerCase().endsWith(".pdf")
		);

		if (pdfPaths.length === 0) {
			this.log("No PDF files for contact sheet");
			return false;
		}

		// Ensure the contact sheet binary is deployed
		let binary = await this._ensureContactSheetBinary();
		if (!binary) {
			this.log("Contact sheet binary not available");
			return false;
		}

		// Generate contact sheet for the first PDF
		let pdfPath = pdfPaths[0];
		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
		let outputPath = PathUtils.join(tempDir, "contactsheet.html");

		const { Subprocess } = ChromeUtils.importESModule(
			"resource://gre/modules/Subprocess.sys.mjs"
		);

		this.log("Generating contact sheet for: " + pdfPath);

		try {
			let proc = await Subprocess.call({
				command: binary,
				arguments: [pdfPath, outputPath, "5", "200"],
			});
			let result = await proc.wait();
			if (result.exitCode !== 0) {
				this.log(
					"Contact sheet generation failed with code " +
						result.exitCode
				);
				return false;
			}
		} catch (e) {
			this.log("Contact sheet generation error: " + e);
			return false;
		}

		// QuickLook the generated contact sheet HTML
		await this._launchQlmanage([outputPath]);
		return true;
	},

	async _ensureContactSheetBinary() {
		if (this._contactSheetBinary) {
			if (await IOUtils.exists(this._contactSheetBinary)) {
				return this._contactSheetBinary;
			}
		}

		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

		let binaryPath = PathUtils.join(tempDir, "contactsheet");

		// Check if already deployed
		if (await IOUtils.exists(binaryPath)) {
			this._contactSheetBinary = binaryPath;
			return binaryPath;
		}

		// Copy the pre-compiled binary from the plugin bundle to temp
		this.log("Deploying contact sheet binary...");

		try {
			let binaryURI = this.rootURI + "contactsheet";
			let response = await fetch(binaryURI);
			let data = await response.arrayBuffer();
			await IOUtils.write(binaryPath, new Uint8Array(data));

			// Make executable
			await IOUtils.setPermissions(binaryPath, 0o755);

			this.log("Contact sheet binary deployed");
			this._contactSheetBinary = binaryPath;
			return binaryPath;
		} catch (e) {
			this.log("Failed to deploy contact sheet binary: " + e);
			return null;
		}
	},

	async _launchQlmanage(filePaths) {
		if (this._launching) return;
		this._launching = true;

		const { Subprocess } = ChromeUtils.importESModule(
			"resource://gre/modules/Subprocess.sys.mjs"
		);

		let args = ["-p", ...filePaths];
		this.log("Launching: qlmanage " + args.join(" "));

		try {
			this._proc = await Subprocess.call({
				command: "/usr/bin/qlmanage",
				arguments: args,
			});
			this._isActive = true;

			// Monitor process exit (user may close qlmanage externally)
			this._proc.wait().then(() => {
				this.log("qlmanage exited");
				this._isActive = false;
				this._proc = null;
			});
		} catch (e) {
			this.log("Failed to launch qlmanage: " + e);
			this._isActive = false;
			this._proc = null;
		} finally {
			this._launching = false;
		}
	},

	_closeQuickLook() {
		if (this._proc) {
			this.log("Killing qlmanage");
			this._proc.kill();
			this._proc = null;
			this._isActive = false;
		}
	},

	// ── File path resolution ──────────────────────────────────────────

	async _getPreviewPath(items) {
		let paths = [];

		for (let item of items) {
			if (item.isAttachment() && !item.isNote()) {
				let path = await this._getAttachmentPath(item);
				if (path) {
					path = await this._normalizeForPreview(path);
					if (path) paths.push(path);
				}
			} else if (item.isNote()) {
				let path = await this._writeNoteToTempFile(item);
				if (path) paths.push(path);
			} else {
				// Regular item: prefer PDF, then EPUB, then any other attachment
				let attachmentIDs = item.getAttachments(false);
				let pdfPath = null;
				let epubPath = null;
				let fallbackPath = null;

				for (let attID of attachmentIDs) {
					let attachment = Zotero.Items.get(attID);
					if (attachment.isNote()) continue;
					let path = await this._getAttachmentPath(attachment);
					if (!path) continue;

					let lower = path.toLowerCase();
					if (lower.endsWith(".pdf")) {
						pdfPath = path;
						break;
					}
					if (lower.endsWith(".epub") && !epubPath) {
						epubPath = path;
					}
					if (!fallbackPath) {
						fallbackPath = path;
					}
				}

				let chosen = pdfPath || epubPath || fallbackPath;
				if (chosen) {
					chosen = await this._normalizeForPreview(chosen);
					if (chosen) paths.push(chosen);
				}
			}
		}

		return paths;
	},

	async _normalizeForPreview(path) {
		if (path && path.toLowerCase().endsWith(".epub")) {
			let html = await this._convertEpubToHtml(path);
			return html || path;
		}
		return path;
	},

	async _getNotePaths(items) {
		let paths = [];

		for (let item of items) {
			if (item.isNote()) {
				let path = await this._writeNoteToTempFile(item);
				if (path) paths.push(path);
			} else if (!item.isAttachment()) {
				// Regular item: collect all child notes
				let noteIDs = item.getNotes(false);
				for (let noteID of noteIDs) {
					let note = Zotero.Items.get(noteID);
					let path = await this._writeNoteToTempFile(note);
					if (path) paths.push(path);
				}
			}
		}

		return paths;
	},

	async _getAttachmentPath(item) {
		if (!item.isAttachment()) return null;

		// Skip web-only attachments
		if (
			item.attachmentLinkMode ===
			Zotero.Attachments.LINK_MODE_LINKED_URL
		) {
			return null;
		}

		let path = await item.getFilePathAsync();
		if (!path) {
			this.log("No file path for attachment " + item.id);
			return null;
		}

		let exists = await IOUtils.exists(path);
		if (!exists) {
			this.log("File does not exist: " + path);

			// Try downloading synced file
			if (
				item.isImportedAttachment() &&
				Zotero.Sync.Storage.Local.getEnabledForLibrary(item.libraryID)
			) {
				try {
					this.log("Attempting to download synced file...");
					await Zotero.Sync.Runner.downloadFile(item);
					path = await item.getFilePathAsync();
					if (path && (await IOUtils.exists(path))) {
						return path;
					}
				} catch (e) {
					this.log("Download failed: " + e);
				}
			}
			return null;
		}

		return path;
	},

	// ── Note preview ──────────────────────────────────────────────────

	async _writeNoteToTempFile(item) {
		if (!item.isNote()) return null;

		let noteContent = item.getNote();
		if (!noteContent) return null;

		let title = item.getNoteTitle() || "Note";
		let safeTitle = title
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.substring(0, 100);

		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

		let html =
			"<!DOCTYPE html>\n" +
			"<html>\n" +
			"<head>\n" +
			'<meta charset="UTF-8">\n' +
			"<title>" +
			this._escapeHtml(title) +
			"</title>\n" +
			"<style>\n" +
			"body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;\n" +
			"       padding: 20px; max-width: 800px; margin: 0 auto; }\n" +
			"</style>\n" +
			"</head>\n" +
			"<body>\n" +
			noteContent +
			"\n</body>\n" +
			"</html>";

		let filePath = PathUtils.join(tempDir, safeTitle + ".html");
		if (await IOUtils.exists(filePath)) {
			filePath = PathUtils.join(
				tempDir,
				safeTitle + "_" + Date.now() + ".html"
			);
		}

		await IOUtils.writeUTF8(filePath, html);
		this.log("Wrote note to: " + filePath);

		return filePath;
	},

	_getTempDirPath() {
		if (!this._tempDir) {
			let base = Zotero.getTempDirectory().path;
			this._tempDir = PathUtils.join(base, "QuickLook");
		}
		return this._tempDir;
	},

	_escapeHtml(str) {
		return str
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	},

	// ── EPUB preview ──────────────────────────────────────────────────

	async _convertEpubToHtml(epubPath) {
		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

		let baseName = PathUtils.filename(epubPath).replace(/\.epub$/i, "");
		let safeName = baseName
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.substring(0, 80);
		let extractDir = PathUtils.join(
			tempDir,
			"epub_" + safeName + "_" + Date.now()
		);
		await IOUtils.makeDirectory(extractDir, { ignoreExisting: true });

		const { Subprocess } = ChromeUtils.importESModule(
			"resource://gre/modules/Subprocess.sys.mjs"
		);

		this.log("Extracting epub: " + epubPath);

		try {
			let proc = await Subprocess.call({
				command: "/usr/bin/unzip",
				arguments: ["-o", "-q", epubPath, "-d", extractDir],
			});
			let result = await proc.wait();
			if (result.exitCode !== 0) {
				this.log("unzip failed with code " + result.exitCode);
				return null;
			}
		} catch (e) {
			this.log("Failed to unzip epub: " + e);
			return null;
		}

		// Locate the OPF manifest via META-INF/container.xml
		let containerPath = PathUtils.join(
			extractDir,
			"META-INF",
			"container.xml"
		);
		if (!(await IOUtils.exists(containerPath))) {
			this.log("No META-INF/container.xml in epub");
			return null;
		}

		let containerXml;
		try {
			containerXml = await IOUtils.readUTF8(containerPath);
		} catch (e) {
			this.log("Failed to read container.xml: " + e);
			return null;
		}

		let rootfileMatch = containerXml.match(
			/<rootfile[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i
		);
		if (!rootfileMatch) {
			this.log("No rootfile in container.xml");
			return null;
		}

		let opfRel = decodeURIComponent(rootfileMatch[1]);
		let opfPath = PathUtils.join(extractDir, ...opfRel.split("/"));
		if (!(await IOUtils.exists(opfPath))) {
			this.log("OPF file not found: " + opfPath);
			return null;
		}

		let opfDir = PathUtils.parent(opfPath);
		let opfXml;
		try {
			opfXml = await IOUtils.readUTF8(opfPath);
		} catch (e) {
			this.log("Failed to read OPF: " + e);
			return null;
		}

		// Title from metadata (prefer dc:title; fall back to file basename)
		let title = baseName;
		let metadataMatch = opfXml.match(
			/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i
		);
		if (metadataMatch) {
			let titleMatch = metadataMatch[1].match(
				/<(?:[\w-]+:)?title[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?title>/i
			);
			if (titleMatch) {
				let decoded = this._decodeXmlEntities(
					titleMatch[1].replace(/<[^>]+>/g, "").trim()
				);
				if (decoded) title = decoded;
			}
		}

		// Manifest: id → href
		let manifest = {};
		let manifestMatch = opfXml.match(
			/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i
		);
		if (manifestMatch) {
			let itemRegex = /<item\s+([^>]+?)\/?>/gi;
			let m;
			while ((m = itemRegex.exec(manifestMatch[1])) !== null) {
				let attrs = m[1];
				let idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
				let hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/);
				if (idMatch && hrefMatch) {
					manifest[idMatch[1]] = hrefMatch[1];
				}
			}
		}

		// Spine: ordered list of itemref idrefs
		let spineMatch = opfXml.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i);
		if (!spineMatch) {
			this.log("No spine in OPF");
			return null;
		}

		let spineFiles = [];
		let itemrefRegex = /<itemref\s+([^>]+?)\/?>/gi;
		let m;
		while ((m = itemrefRegex.exec(spineMatch[1])) !== null) {
			let idrefMatch = m[1].match(/\bidref\s*=\s*["']([^"']+)["']/);
			if (idrefMatch && manifest[idrefMatch[1]]) {
				let href = decodeURIComponent(manifest[idrefMatch[1]]);
				let filePath = PathUtils.join(opfDir, ...href.split("/"));
				spineFiles.push(filePath);
			}
		}

		if (spineFiles.length === 0) {
			this.log("No spine items resolved");
			return null;
		}

		// Concatenate body content; collect <head> CSS for the merged document
		let bodyParts = [];
		let cssLinks = new Set();
		let inlineStyles = [];
		let seenInlineStyles = new Set();

		for (let filePath of spineFiles) {
			try {
				if (!(await IOUtils.exists(filePath))) continue;
				let content = await IOUtils.readUTF8(filePath);
				let fileDir = PathUtils.parent(filePath);

				let headMatch = content.match(
					/<head\b[^>]*>([\s\S]*?)<\/head>/i
				);
				if (headMatch) {
					let head = headMatch[1];
					let linkRegex = /<link\b([^>]*?)\/?>/gi;
					let lm;
					while ((lm = linkRegex.exec(head)) !== null) {
						let attrs = lm[1];
						let relMatch = attrs.match(
							/\brel\s*=\s*["']([^"']+)["']/i
						);
						if (
							!relMatch ||
							!/stylesheet/i.test(relMatch[1])
						) {
							continue;
						}
						let hrefMatch = attrs.match(
							/\bhref\s*=\s*["']([^"']+)["']/i
						);
						if (!hrefMatch) continue;
						let absUrl = this._resolveEpubUrl(
							hrefMatch[1],
							fileDir
						);
						if (absUrl) cssLinks.add(absUrl);
					}
					let styleRegex =
						/<style\b[^>]*>([\s\S]*?)<\/style>/gi;
					let sm;
					while ((sm = styleRegex.exec(head)) !== null) {
						let css = this._rewriteCssUrls(sm[1], fileDir);
						if (!seenInlineStyles.has(css)) {
							seenInlineStyles.add(css);
							inlineStyles.push(css);
						}
					}
				}

				let bodyMatch = content.match(
					/<body\b[^>]*>([\s\S]*?)<\/body>/i
				);
				if (!bodyMatch) continue;
				let body = bodyMatch[1].replace(
					/<script\b[^>]*>[\s\S]*?<\/script>/gi,
					""
				);
				body = this._rewriteEpubUrls(body, fileDir);
				bodyParts.push(body);
			} catch (e) {
				this.log("Failed to read spine file " + filePath + ": " + e);
			}
		}

		if (bodyParts.length === 0) {
			this.log("No readable spine content");
			return null;
		}

		let cssLinkTags = [...cssLinks]
			.map((url) => `<link rel="stylesheet" href="${url}">`)
			.join("\n");
		let cssStyleBlocks = inlineStyles
			.map((css) => "<style>\n" + css + "\n</style>")
			.join("\n");

		let html =
			"<!DOCTYPE html>\n" +
			'<html lang="en">\n' +
			"<head>\n" +
			'<meta charset="UTF-8">\n' +
			"<title>" +
			this._escapeHtml(title) +
			"</title>\n" +
			cssLinkTags +
			"\n" +
			cssStyleBlocks +
			"\n" +
			"<style>\n" +
			"  html, body { margin: 0; }\n" +
			"  body {\n" +
			'    font-family: "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif !important;\n' +
			"    font-size: 16px;\n" +
			"    line-height: 1.6;\n" +
			"    color: #1a1a1a;\n" +
			"    background: #fdfdfd;\n" +
			"    max-width: 720px !important;\n" +
			"    margin: 0 auto !important;\n" +
			"    padding: 80px !important;\n" +
			"    box-sizing: border-box !important;\n" +
			"  }\n" +
			"  img, svg { max-width: 100%; height: auto; }\n" +
			"  pre, code { font-family: Menlo, monospace; }\n" +
			"  hr.epub-chapter-break {\n" +
			"    border: none;\n" +
			"    border-top: 1px solid #ddd;\n" +
			"    margin: 3em 0;\n" +
			"  }\n" +
			"</style>\n" +
			"</head>\n" +
			"<body>\n" +
			bodyParts.join('\n<hr class="epub-chapter-break" />\n') +
			"\n</body>\n</html>";

		let outputPath = PathUtils.join(extractDir, "preview.html");
		await IOUtils.writeUTF8(outputPath, html);
		this.log("Wrote epub preview: " + outputPath);
		return outputPath;
	},

	_resolveEpubUrl(url, baseDir) {
		if (
			/^(https?:|data:|file:|mailto:|tel:|javascript:|#)/i.test(url)
		) {
			return null;
		}

		let fragment = "";
		let hashIdx = url.indexOf("#");
		if (hashIdx >= 0) {
			fragment = url.substring(hashIdx);
			url = url.substring(0, hashIdx);
		}
		if (!url) return null;

		try {
			let decoded = decodeURIComponent(url);
			let parts = decoded.split("/").filter((p) => p !== "");
			let segs = baseDir.split("/").filter((p) => p !== "");
			for (let p of parts) {
				if (p === ".") continue;
				if (p === "..") segs.pop();
				else segs.push(p);
			}
			let absPath = "/" + segs.join("/");
			let encoded = absPath
				.split("/")
				.map(encodeURIComponent)
				.join("/");
			return "file://" + encoded + fragment;
		} catch (e) {
			return null;
		}
	},

	_rewriteEpubUrls(html, baseDir) {
		return html.replace(
			/(src|href|xlink:href|poster)\s*=\s*(["'])([^"']+)\2/gi,
			(match, attr, quote, url) => {
				let resolved = this._resolveEpubUrl(url, baseDir);
				if (resolved === null) return match;
				return `${attr}=${quote}${resolved}${quote}`;
			}
		);
	},

	_rewriteCssUrls(css, baseDir) {
		return css.replace(
			/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
			(match, quote, url) => {
				let resolved = this._resolveEpubUrl(url, baseDir);
				if (resolved === null) return match;
				return 'url("' + resolved + '")';
			}
		);
	},

	_decodeXmlEntities(str) {
		return str
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&#(\d+);/g, (_, n) =>
				String.fromCharCode(parseInt(n, 10))
			)
			.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			)
			.replace(/&amp;/g, "&");
	},

	// ── Shutdown ──────────────────────────────────────────────────────

	shutdown() {
		this._closeQuickLook();
		this._cleanTempDir();
		this.initialized = false;
	},

	async _cleanTempDir() {
		if (this._tempDir) {
			try {
				await IOUtils.remove(this._tempDir, { recursive: true });
				this.log("Cleaned temp directory");
			} catch (e) {
				// Temp dir may not exist yet, that's fine
			}
			this._tempDir = null;
		}
	},
};
