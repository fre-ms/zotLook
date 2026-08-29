/* eslint-disable no-unused-vars */
/* global Zotero, ChromeUtils, PathUtils, IOUtils, Services, Localization */
/* global setTimeout, clearTimeout */
/* global ChromeWorker, Components, OffscreenCanvas */
/* global ZotLookUtil, ZotLookEpub, ZotLookSheet, ZotLookWinPreview */

var ZotLook = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,

	// Process state
	_proc: null,
	_isActive: false,
	_launching: false,
	_tempDir: null,
	// binary name -> deployed path
	_binaries: new Map(),
	// attachment key -> { signature, path } for exported annotated copies
	_annotationCache: new Map(),

	// Pages render concurrently into files beside the HTML, so the page count
	// is a safety limit rather than a performance ceiling; it is configurable
	// under extensions.zotlook.contactSheetMaxPages. The deadline still applies.
	CONTACT_SHEET_TIMEOUT_MS: 60000,

	// How long to wait for Sushi to answer a preview request. The call itself
	// returns as soon as the window has been handed its file, so this only has
	// to cover starting the service, which D-Bus does on the first request.
	PREVIEW_REPLY_TIMEOUT_MS: 10000,

	// Per-window cleanup tracking
	_windowListeners: new Map(),

	// id -> translated text, filled in asynchronously; until then the English
	// fallbacks in MENU_ITEMS stand in
	_strings: null,

	PROGRESS_STRINGS: [
		"zotlook-progress-headline",
		"zotlook-progress-contactsheet",
		"zotlook-epub-contents",
	],

	L10N_FILE: "zotlook.ftl",
	MENU_ID: "zotlook-item-menu",
	PREF_BRANCH: "extensions.zotlook.",
	PANE_ID: "zotlook-prefpane",

	_prefObservers: [],
	_paneID: null,

	SEPARATOR_ID: "zotlook-menu-separator",

	/**
	 * The context menu entries.
	 *
	 * Each carries an English fallback: the label is resolved here and set as a
	 * plain attribute rather than left to the document's Fluent context, so an
	 * entry can never end up blank.
	 */
	MENU_ITEMS: [
		{
			id: "zotlook-menu-item",
			l10nID: "zotlook-menu-preview",
			fallback: "Quick Look",
			open: "_openQuickLook",
			needsPDF: false,
		},
		{
			id: "zotlook-contactsheet-menu-item",
			l10nID: "zotlook-menu-contactsheet",
			fallback: "Quick Look Contact Sheet",
			open: "_openContactSheet",
			needsPDF: true,
			needsSystemPreview: true,
		},
		{
			id: "zotlook-contactsheet-window-menu-item",
			l10nID: "zotlook-menu-contactsheet-window",
			fallback: "Contact Sheet in a Window (clickable)",
			open: "_openContactSheetInViewer",
			needsPDF: true,
		},
	],

	/** The last lines this plugin logged, kept for _writeFailureReport. */
	_recentLog: [],

	log(msg) {
		Zotero.debug("zotLook: " + msg);
		// Zotero's debug output is shared with every other plugin, and a
		// chatty one drowns this out entirely — so keep our own last words
		this._recentLog.push(new Date().toISOString() + "  " + msg);
		if (this._recentLog.length > 200) this._recentLog.shift();
	},

	/**
	 * Writes what the plugin logged just before something failed, next to the
	 * files it was working on. Somebody reporting "it does not work" can then
	 * send this instead of a debug log with everyone else's noise in it.
	 */
	async _writeFailureReport(what) {
		try {
			let dir = this._getTempDirPath();
			await IOUtils.makeDirectory(dir, { ignoreExisting: true });
			await IOUtils.writeUTF8(
				PathUtils.join(dir, "last-failure.log"),
				"zotLook " + (this.version || "?") + " — " + what + "\n\n" +
					this._recentLog.join("\n") + "\n"
			);
		} catch (e) {
			this.log("Could not write the failure report: " + e);
		}
	},

	/** Whether this platform has a preview mechanism to drive at all. */
	_platformSupported() {
		return !!(Zotero.isMac || Zotero.isLinux || Zotero.isWin);
	},

	/** The contact sheet needs the bundled renderer, which is macOS-only. */
	_contactSheetSupported() {
		// macOS renders through the bundled binary, everywhere else through
		// the pdf.js build Zotero ships — so every platform can build one.
		return true;
	},

	/**
	 * Whether a built sheet can actually be shown outside Zotero. The window
	 * route works anywhere; the system previews can all take the sheet's
	 * HTML — QuickLook for Windows included, whose viewer was measured to
	 * render the page and load the thumbnails beside it.
	 */
	_contactSheetPreviewable() {
		return this._platformSupported();
	},

	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;

		this._registerPreferencePane();
		this._watchPreferences();
		this._loadStrings().catch((e) =>
			this.log("String loading failed: " + e)
		);

		// Clean up any leftover temp files from previous sessions
		this._cleanTempDir().catch((e) =>
			this.log("Startup cleanup failed: " + e)
		);

		// Kept sheets are not leftovers, so they survive that — but the ones
		// nobody has opened in a long time are dropped here
		this._expireSheets().catch((e) =>
			this.log("Could not clear old contact sheets: " + e)
		);
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
		if (!this._platformSupported()) {
			this.log("No preview mechanism on this platform");
			return;
		}

		// Idempotent: startup and onMainWindowLoad can both reach the same
		// window, and adding a second keyboard listener and a second
		// popupshowing handler each time is how a window gets slow.
		if (this._windowListeners.has(window)) {
			this.removeFromWindow(window);
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

		this._addMenuToWindow(window, doc, listeners);

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

		this._removeMenuFromDocument(window.document);

		this._windowListeners.delete(window);
		this.log("Removed from window");
	},

	// ── Keyboard handling ─────────────────────────────────────────────

	/**
	 * Which preference drives which action. Order decides precedence when two
	 * shortcuts would both match, so the more specific ones come first.
	 *
	 * Space is matched on event.code, which is the physical key, because it
	 * sits in the same place on every layout. A shortcut on a letter or digit
	 * is matched on event.key, the character produced: on a QWERTZ keyboard
	 * the key labelled Y sits at code "KeyZ", so only event.key identifies the
	 * shortcut the user actually sees on their keycaps.
	 *
	 * A binding matches only when the modifiers it does not name are absent,
	 * so no combination can fall through to more than one entry.
	 */
	KEY_ACTIONS: [
		{ pref: "key.notes", open: "_openNotePreview" },
		{ pref: "key.contactSheetWindow", open: "_openContactSheetInViewer" },
		{ pref: "key.contactSheet", open: "_openContactSheet" },
		{ pref: "key.preview", open: "_openQuickLook" },
	],

	_bindings: null,

	/**
	 * The configured shortcuts, parsed once and rebuilt when a preference
	 * changes, so an edit takes effect without restarting Zotero.
	 */
	get bindings() {
		if (!this._bindings) {
			this._bindings = this.KEY_ACTIONS.map((action) => {
				let raw = this._pref(action.pref);
				let shortcut = ZotLookUtil.parseShortcut(raw);
				if (!shortcut) {
					this.log("Unusable shortcut for " + action.pref + ": " + raw);
					return null;
				}
				return Object.assign({}, shortcut, { open: action.open });
			}).filter(Boolean);
		}
		return this._bindings;
	},

	_pref(name, fallback) {
		try {
			let value = Zotero.Prefs.get(this.PREF_BRANCH + name, true);
			return value === undefined ? fallback : value;
		} catch (e) {
			this.log("Could not read preference " + name + ": " + e);
			return fallback;
		}
	},

	/**
	 * Whether this shortcut is something the item tree would otherwise collect
	 * as search input: a bare key, or one held only with Shift.
	 */
	_isTypeAheadKey(binding) {
		if (binding.ctrl || binding.alt || binding.meta) return false;
		return binding.code === "Space" || !!binding.key;
	},

	/**
	 * Whether the item tree is currently collecting a find-as-you-type string.
	 *
	 * Reaches into a private field of Zotero's virtualized table, so anything
	 * unexpected is read as "not typing": the worst case is the behaviour this
	 * plugin had before, not an exception.
	 */
	_isTypeAheadActive(window) {
		try {
			let tree = window.ZoteroPane &&
				window.ZoteroPane.itemsView &&
				window.ZoteroPane.itemsView.tree;
			return !!(tree && tree._typingString);
		} catch (e) {
			return false;
		}
	},

	_matchesBinding(event, binding) {
		if (binding.code && event.code !== binding.code) return false;
		if (binding.key && (event.key || "").toLowerCase() !== binding.key) {
			return false;
		}
		return (
			event.shiftKey === !!binding.shift &&
			event.altKey === !!binding.alt &&
			event.metaKey === !!binding.meta &&
			event.ctrlKey === !!binding.ctrl
		);
	},

	_onKeyDown(event, window) {
		if (event.key === "Escape") {
			if (!this._isActive) return;
			event.preventDefault();
			event.stopPropagation();
			this._closeQuickLook();
			return;
		}

		let binding = this.bindings.find((b) =>
			this._matchesBinding(event, b)
		);
		if (!binding) return;

		// A space, like any bare character, is legitimate input to the item
		// tree's find-as-you-type search, and Zotero's own handler stands down
		// while one is in progress. Ours has to as well, or typing a multi-word
		// title opens a preview instead. Only shortcuts that carry no command
		// modifier can be mistaken for typing.
		if (this._isTypeAheadKey(binding) && this._isTypeAheadActive(window)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		// A second press closes whatever is open, whichever variant opened it
		if (this._isActive) {
			this._closeQuickLook();
			return;
		}

		let items = window.ZoteroPane && window.ZoteroPane.getSelectedItems();
		if (items && items.length > 0) {
			this[binding.open](items);
		}
	},

	// ── Preferences ───────────────────────────────────────────────────

	_registerPreferencePane() {
		if (!Zotero.PreferencePanes || !this.rootURI) return;
		Zotero.PreferencePanes.register({
			pluginID: this.id,
			id: this.PANE_ID,
			src: this.rootURI + "prefs-pane.xhtml",
			scripts: [this.rootURI + "util.js", this.rootURI + "prefs-pane.js"],
			stylesheets: [this.rootURI + "prefs-pane.css"],
			// Zotero draws this at 24 px in the navigation sidebar. Its own
			// icons are single-colour SVGs filled through
			// -moz-context-properties, which Gecko only honours for images
			// from chrome: and resource: URIs — a plugin's come out of the
			// XPI, so context-fill would leave nothing to paint. Hence a
			// self-coloured icon, which also means it stays legible on the
			// selected row's accent background.
			image: this.rootURI + "icon/zotlook-24.svg",
		})
			.then((id) => {
				this._paneID = id;
				this.log("Registered preference pane");
			})
			.catch((e) => this.log("Could not register preference pane: " + e));
	},

	_unregisterPreferencePane() {
		if (!this._paneID) return;
		try {
			Zotero.PreferencePanes.unregister(this._paneID);
		} catch (e) {
			this.log("Could not unregister preference pane: " + e);
		}
		this._paneID = null;
	},

	/**
	 * Rebuilds the shortcut table when a preference changes, so an edit in the
	 * pane takes effect immediately rather than at the next restart.
	 *
	 * One observer per preference: Zotero dispatches to observers registered
	 * under the exact preference name, so watching the branch would never fire.
	 */
	_watchPreferences() {
		for (let action of this.KEY_ACTIONS) {
			this._observePref(action.pref, () => {
				this._bindings = null;
				this.log("Shortcuts reloaded after " + action.pref + " changed");
			});
		}
	},

	_observePref(name, handler) {
		try {
			this._prefObservers.push(
				Zotero.Prefs.registerObserver(this.PREF_BRANCH + name, handler, true)
			);
		} catch (e) {
			this.log("Could not observe preference " + name + ": " + e);
		}
	},

	_unwatchPreferences() {
		for (let symbol of this._prefObservers) {
			try {
				Zotero.Prefs.unregisterObserver(symbol);
			} catch (e) {
				this.log("Could not stop observing a preference: " + e);
			}
		}
		this._prefObservers = [];
	},

	// ── Context menu ──────────────────────────────────────────────────

	/**
	 * Inserts the entries into the item context menu.
	 *
	 * Done directly rather than through Zotero.MenuManager: that API accepts
	 * only an l10n id, never a plain label, so an entry whose string the
	 * document's Fluent context cannot resolve renders blank. Setting the
	 * label here keeps the fallback under this plugin's control.
	 */
	_addMenuToWindow(window, doc, listeners) {
		let menuPopup = doc.getElementById("zotero-itemmenu");
		if (!menuPopup) {
			this.log("Could not find zotero-itemmenu");
			return;
		}

		// A reload that left the previous elements behind must not double them
		this._removeMenuFromDocument(doc);

		let separator = doc.createXULElement("menuseparator");
		separator.id = this.SEPARATOR_ID;
		menuPopup.appendChild(separator);

		for (let entry of this.MENU_ITEMS) {
			let menuItem = doc.createXULElement("menuitem");
			menuItem.id = entry.id;
			menuItem.setAttribute(
				"label",
				this._string(entry.l10nID, entry.fallback)
			);
			menuItem.addEventListener("command", () => {
				try {
					let pane = window.ZoteroPane;
					let items = (pane && pane.getSelectedItems()) || [];
					if (items.length > 0) this[entry.open](items);
				} catch (e) {
					this.log("Menu command failed: " + e);
				}
			});
			// Appending is safe: Zotero addresses its own entries by position
			// from the start of the popup, so only prepending would shift them
			menuPopup.appendChild(menuItem);
		}

		let popupShowHandler = () => this._onMenuShowing(doc);
		menuPopup.addEventListener("popupshowing", popupShowHandler);

		listeners.popupShowHandler = popupShowHandler;
		listeners.menuPopup = menuPopup;
	},

	_removeMenuFromDocument(doc) {
		for (let id of [this.SEPARATOR_ID].concat(
			this.MENU_ITEMS.map((e) => e.id)
		)) {
			let el = doc.getElementById(id);
			if (el) el.remove();
		}
	},

	_onMenuShowing(doc) {
		// Runs as a popupshowing listener next to Zotero's own; an exception
		// here must not disturb it
		try {
			let pane = doc.defaultView.ZoteroPane;
			let items = (pane && pane.getSelectedItems()) || [];

			let anyVisible = false;
			for (let entry of this.MENU_ITEMS) {
				let el = doc.getElementById(entry.id);
				if (!el) continue;
				let applies = this._menuApplies(entry, items);
				el.hidden = !applies;
				if (applies) anyVisible = true;
			}

			// Hide the separator too, rather than leaving a stray line
			let separator = doc.getElementById(this.SEPARATOR_ID);
			if (separator) separator.hidden = !anyVisible;
		} catch (e) {
			this.log("Menu update failed: " + e);
		}
	},

	_menuApplies(entry, items) {
		items = items || [];
		if (items.length === 0) return false;
		if (entry.needsSystemPreview && !this._contactSheetPreviewable()) {
			return false;
		}
		if (!entry.needsPDF) return true;
		return this._hasPDF(items);
	},

	/**
	 * Whether the selection holds anything the contact sheet could render.
	 *
	 * Deliberately synchronous: this runs while the context menu is opening,
	 * so it interrogates the items rather than resolving file paths.
	 */
	_hasPDF(items) {
		for (let item of items) {
			if (item.isNote()) continue;

			if (item.isAttachment()) {
				if (this._isPDFAttachment(item)) return true;
				continue;
			}

			if (typeof item.getAttachments !== "function") continue;
			for (let attID of item.getAttachments(false)) {
				let attachment = Zotero.Items.get(attID);
				if (attachment && this._isPDFAttachment(attachment)) {
					return true;
				}
			}
		}
		return false;
	},

	/**
	 * Zotero's attachmentFilename getter can throw for attachments with an
	 * unusual stored path, and this runs while a menu is opening, so the whole
	 * check is defensive.
	 */
	_isPDFAttachment(item) {
		try {
			if (
				typeof item.isPDFAttachment === "function" &&
				item.isPDFAttachment()
			) {
				return true;
			}
			// Attachments stored without a content type still carry a filename
			let name = item.attachmentFilename || "";
			return name.toLowerCase().endsWith(".pdf");
		} catch (e) {
			this.log("Could not inspect attachment: " + e);
			return false;
		}
	},

	// ── QuickLook open/close ──────────────────────────────────────────

	/**
	 * Serialises preview requests. The guard has to cover path resolution and
	 * contact sheet generation as well, not just the spawn: those steps await
	 * (syncing a file, rendering a PDF) and a second key press during that
	 * window would start a competing pipeline and orphan the first process.
	 */
	async _withLaunchGuard(fn) {
		if (this._launching) return false;
		this._launching = true;
		try {
			return await fn();
		} catch (e) {
			this.log("Preview failed: " + e);
			return false;
		} finally {
			this._launching = false;
		}
	},

	async _openQuickLook(items) {
		return this._withLaunchGuard(async () => {
			let paths = await this._getPreviewPath(items);
			if (paths.length === 0) {
				this.log("No files to preview");
				return false;
			}

			await this._launchPreview(paths);
			return true;
		});
	},

	async _openNotePreview(items) {
		return this._withLaunchGuard(async () => {
			let paths = await this._getNotePaths(items);
			if (paths.length === 0) {
				this.log("No notes to preview");
				return false;
			}

			await this._launchPreview(paths);
			return true;
		});
	},

	async _openContactSheet(items) {
		return this._withLaunchGuard(async () => {
			let sheet = await this._buildContactSheet(items);
			if (!sheet) return false;
			await this._launchPreview([sheet]);
			return true;
		});
	},

	/**
	 * The same contact sheet, shown in Zotero's own viewer window instead of
	 * QuickLook.
	 *
	 * The per-page links work in both, by different routes. Quick Look
	 * refuses ordinary navigation but hands a new-window request to the
	 * system handler, so a click there opens the reader and closes the
	 * preview as it goes. This window keeps the sheet up alongside the
	 * reader, which is the reason to have it. See the comment in
	 * ZotLookSheet.html for what the target attribute is doing.
	 */
	async _openContactSheetInViewer(items) {
		return this._withLaunchGuard(async () => {
			let sheet = await this._buildContactSheet(items);
			if (!sheet) return false;
			try {
				Zotero.openInViewer(PathUtils.toFileURI(sheet));
			} catch (e) {
				this.log("Could not open the contact sheet in a window: " + e);
				return false;
			}
			return true;
		});
	},

	/**
	 * Renders the contact sheet and returns the path to its HTML, or null.
	 */
	async _buildContactSheet(items) {
		if (!this._contactSheetSupported()) {
			this.log("No page renderer is available on this platform");
			return null;
		}

		// Resolve to an attachment item rather than a bare path: the reader
		// links in the sheet need the item's key and library
		let chosen = await this._pickPdfAttachment(items);
		if (!chosen) {
			this.log("No PDF files for contact sheet");
			return null;
		}

		// Render the annotated copy where there is one: on a sheet of every
		// page, the marked-up ones are exactly what makes it worth scanning.
		let pdfPath = (await this._annotatedCopy(chosen.item)) || chosen.path;

		let maxColumns = this._contactSheetColumns();
		let maxPages = this._maxContactSheetPages();

		// Kept sheets live apart from the working directory, which is emptied
		// on every start. With keeping switched off nothing is meant to
		// survive the session, so the sheet is built where that clearing
		// reaches it.
		let keep = this._pref("cacheContactSheet", true);
		let baseDir = keep ? this._sheetCacheDirPath() : this._getTempDirPath();
		await IOUtils.makeDirectory(baseDir, { ignoreExisting: true });

		// Named after the source rather than after what is rendered, so the
		// sheet keeps one name whether or not annotations were drawn in, and
		// a second sheet does not overwrite one still open in QuickLook
		let sheetName =
			"contactsheet_" +
			ZotLookUtil.safeName(PathUtils.filename(chosen.path), 60);
		let outputPath = PathUtils.join(baseDir, sheetName + ".html");
		let imageDirName = sheetName + "_pages";
		let imageDir = PathUtils.join(baseDir, imageDirName);
		let keyPath = PathUtils.join(baseDir, sheetName + ".key");

		let key = keep
			? await this._sheetCacheKey(chosen.item, chosen.path, maxColumns,
				maxPages)
			: null;
		if (keep) {
			let kept = await this._cachedSheet(keyPath, key, outputPath);
			if (kept) {
				this.log("Reusing the contact sheet built earlier: " + kept);
				// Rewritten so its modification time says "last used", which
				// is what the age-based clearing goes by
				try {
					await IOUtils.writeUTF8(keyPath, key);
				} catch (e) {
					// Not worth failing a hit over
				}
				return kept;
			}
		}

		this.log("Generating contact sheet for: " + pdfPath);
		let started = Date.now();

		// Rendering is CPU-bound and can run for many seconds on a long PDF,
		// so tell the user something is happening
		let progress = this._showProgress(
			this._string(
				"zotlook-progress-contactsheet",
				"Generating contact sheet…"
			)
		);

		try {
			// Clear first: a previous run with a higher page cap would leave
			// thumbnails behind that this sheet does not reference
			await IOUtils.remove(imageDir, {
				recursive: true,
				ignoreAbsent: true,
			});
			await IOUtils.makeDirectory(imageDir, { ignoreExisting: true });

			let manifest = await this._renderPagesWithPdfjs(
				pdfPath,
				imageDir,
				maxColumns,
				maxPages,
				(done, total) => this._setProgress(progress, done, total)
			);

			if (!manifest || !manifest.pages.length) {
				this.log("No pages could be rendered");
				await this._writeFailureReport("the contact sheet drew nothing");
				return null;
			}

			// Worth having in the log: it is the only figure that says
			// whether rendering is fast enough on this machine
			this.log(
				"Rendered " + manifest.pages.length + " pages in " +
				(Date.now() - started) + " ms"
			);

			let rendered = manifest.pages.length;
			let notice = rendered < manifest.pageCount
				? await this._formatString(
					"zotlook-sheet-truncated",
					{ shown: rendered, total: manifest.pageCount },
					"Showing the first " + rendered + " of " +
						manifest.pageCount + " pages."
				)
				: "";

			await IOUtils.writeUTF8(
				outputPath,
				ZotLookSheet.html({
					pages: manifest.pages,
					columns: manifest.columns,
					width: manifest.width,
					imageDir: imageDirName,
					pageCount: manifest.pageCount,
					linkBase: this._readerLink(chosen.item),
					notice: notice,
				})
			);

			// Written last, and only now: a key beside a sheet that was never
			// finished would hand back a half-built one for ever after.
			if (keep && key) {
				await IOUtils.writeUTF8(keyPath, key);
			}
		} catch (e) {
			this.log("Contact sheet generation error: " + e);
			await this._writeFailureReport("the contact sheet threw: " + e);
			return null;
		} finally {
			this._closeProgress(progress);
		}

		return outputPath;
	},

	/**
	 * Where a kept contact sheet lives.
	 *
	 * Beside the working directory rather than in it, because that one is
	 * emptied on startup and on shutdown — a sheet left there could never
	 * survive a restart. This sits in the system's temp area all the same, so
	 * it is not backed up with the library and the system clears it eventually.
	 */
	_sheetCacheDirPath() {
		if (!this._sheetCacheDir) {
			this._sheetCacheDir = PathUtils.join(
				Zotero.getTempDirectory().path,
				"zotLook-cache"
			);
		}
		return this._sheetCacheDir;
	},

	/**
	 * Everything that would make a kept sheet the wrong answer.
	 *
	 * The file itself by size and modification time rather than by a digest of
	 * its contents: reading a hundred megabytes to decide whether to skip
	 * seven seconds of rendering can cost more than it saves, and Zotero
	 * rewrites an attachment rather than editing it in place.
	 *
	 * The annotations belong in it because the sheet renders the exported copy
	 * rather than the stored file, and so do the settings that shape the
	 * output — a sheet drawn in five columns is not the sheet the reader gets
	 * after asking for three.
	 */
	async _sheetCacheKey(item, path, columns, maxPages) {
		let stat;
		try {
			stat = await IOUtils.stat(path);
		} catch (e) {
			return null;
		}
		let annotations = this._pref("previewAnnotations", true)
			? this._annotationSignature(item) || "none"
			: "off";
		return [
			this.version,
			path,
			stat.size,
			Number(stat.lastModified),
			annotations,
			columns,
			maxPages,
		].join("|");
	},

	/** The kept sheet for this key, or null. */
	async _cachedSheet(keyPath, key, sheetPath) {
		if (!key) return null;
		try {
			if (!(await IOUtils.exists(keyPath))) return null;
			if ((await IOUtils.readUTF8(keyPath)) !== key) return null;
			if (!(await IOUtils.exists(sheetPath))) return null;
			return sheetPath;
		} catch (e) {
			return null;
		}
	},

	/**
	 * How long a kept sheet may go unused. Zero keeps them until the system
	 * clears its temp area — which macOS and Linux do on their own, and
	 * Windows rarely.
	 */
	_sheetKeepDays() {
		let value = Number(this._pref("contactSheetKeepDays", 30));
		if (!Number.isFinite(value) || value < 0) return 30;
		return Math.floor(value);
	},

	/**
	 * The kept sheets, as {sheet, key, images, bytes, used} — one entry per
	 * key file, since that is written last and so marks a finished sheet.
	 */
	async _keptSheets() {
		let dir = this._sheetCacheDirPath();
		let out = [];
		let names;
		try {
			names = await IOUtils.getChildren(dir);
		} catch (e) {
			return out;
		}
		for (let path of names) {
			if (!path.endsWith(".key")) continue;
			let base = path.slice(0, -4);
			let entry = {
				key: path,
				sheet: base + ".html",
				images: base + "_pages",
				bytes: 0,
				used: 0,
			};
			try {
				let stat = await IOUtils.stat(path);
				entry.used = Number(stat.lastModified) || 0;
			} catch (e) {
				continue;
			}
			for (let file of [path, entry.sheet]) {
				try {
					entry.bytes += (await IOUtils.stat(file)).size || 0;
				} catch (e) {
					// A missing half is what makes an entry incomplete, not an
					// error; the size is then simply smaller.
				}
			}
			try {
				for (let image of await IOUtils.getChildren(entry.images)) {
					entry.bytes += (await IOUtils.stat(image)).size || 0;
				}
			} catch (e) {
				// no images directory
			}
			out.push(entry);
		}
		return out;
	},

	/** What the kept sheets occupy, in bytes. */
	async _keptSheetsSize() {
		let total = 0;
		for (let entry of await this._keptSheets()) total += entry.bytes;
		return total;
	},

	/** Throws away one kept sheet: its key first, so a half-removed one is
	 *  never mistaken for a finished one. */
	async _dropSheet(entry) {
		try {
			await IOUtils.remove(entry.key, { ignoreAbsent: true });
			await IOUtils.remove(entry.sheet, { ignoreAbsent: true });
			await IOUtils.remove(entry.images, {
				recursive: true,
				ignoreAbsent: true,
			});
			return true;
		} catch (e) {
			this.log("Could not remove a kept sheet: " + e);
			return false;
		}
	},

	/** Every kept sheet. Returns how many went and what they occupied. */
	async _purgeSheets() {
		let entries = await this._keptSheets();
		let bytes = 0;
		let count = 0;
		for (let entry of entries) {
			if (await this._dropSheet(entry)) {
				bytes += entry.bytes;
				count++;
			}
		}
		if (count) this.log("Removed " + count + " kept contact sheets");
		return { count, bytes };
	},

	/**
	 * The ones nobody has looked at for a while.
	 *
	 * By last use rather than by age: a book opened every week should stay,
	 * and one opened once in March should not. The key file is rewritten on
	 * every hit, which is what makes its modification time mean "last used".
	 *
	 * Run at startup rather than on a timer. A directory listing costs
	 * nothing, and a clearing that happened while the user was working would
	 * make the same sheet appear at once one moment and not the next.
	 */
	async _expireSheets() {
		let days = this._sheetKeepDays();
		if (!days) return { count: 0, bytes: 0 };

		let cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		let bytes = 0;
		let count = 0;
		for (let entry of await this._keptSheets()) {
			if (entry.used >= cutoff) continue;
			if (await this._dropSheet(entry)) {
				bytes += entry.bytes;
				count++;
			}
		}
		if (count) {
			this.log("Removed " + count + " contact sheets unused for " +
				days + " days");
		}
		return { count, bytes };
	},

	/**
	 * How many renderers to run at once. The engine is about a third slower
	 * per page than the bundled one, so concurrency is what closes the gap —
	 * measured single-threaded, 30 pages took 0.72 s against the binary's 0.12
	 * across ten cores.
	 *
	 * Each worker holds its own copy of the document, so a large PDF buys
	 * fewer of them: four copies of a 200 MB scan is not a trade worth making
	 * for a sheet nobody is watching the clock on.
	 */
	_rendererWorkerCount(byteLength, pageCount) {
		const MOST = 4;
		const MEMORY_BUDGET = 256 * 1024 * 1024;

		let cores = 4;
		try {
			cores = Number(Services.sysinfo.getProperty("cpucount")) || 4;
		} catch (e) {
			// Not worth failing over; four is a reasonable guess
		}

		let affordable = Math.floor(MEMORY_BUDGET / Math.max(1, byteLength));
		// A page cap below the worker count would leave workers with nothing
		// to do; without a cap the page count is not known yet and does not
		// constrain anything.
		let useful = pageCount > 0 ? pageCount : MOST;
		return Math.max(1, Math.min(MOST, cores, affordable, useful));
	},

	/**
	 * Pages dealt out round-robin rather than in blocks: a document's heavy
	 * pages tend to sit together — plates, scanned inserts — and a block
	 * split would hand one worker all of them while the others idle.
	 */
	_pageSlices(renderCount, workerCount) {
		let slices = [];
		for (let w = 0; w < workerCount; w++) {
			let pages = [];
			for (let page = w + 1; page <= renderCount; page += workerCount) {
				pages.push(page);
			}
			slices.push(pages);
		}
		return slices;
	},

	/**
	 * Renders through the pdf.js build Zotero ships, for the platforms the
	 * binary cannot be built for. Pages arrive one at a time and are written
	 * as they come, so a long book is never held in memory whole.
	 */
	async _renderPagesWithPdfjs(
		pdfPath,
		imageDir,
		maxColumns,
		maxPages,
		onProgress
	) {
		let prefix = this._resourceAlias();
		if (!prefix) {
			this.log("Cannot start the renderer without the resource alias");
			return null;
		}

		let bytes = await IOUtils.read(pdfPath);

		return new Promise((resolve) => {
			let workers = [];
			let manifest = null;
			let opened = 0;
			let done = 0;
			let settled = false;

			// Writing a page is asynchronous and the message saying a worker
			// has finished is not, so the last writes are still in flight when
			// it arrives. Without waiting for them, pages drop out of the
			// sheet with nothing said — and the ones that survive come out in
			// whatever order they landed.
			let writing = [];
			let drawn = 0;

			let finish = (value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				for (let worker of workers) worker.terminate();
				if (value) value.pages.sort((a, b) => a.page - b.page);
				resolve(value);
			};

			let timer = setTimeout(async () => {
				this.log("The renderer did not finish in time");
				await Promise.all(writing);
				// Whatever was drawn by now still makes a usable sheet
				finish(manifest && manifest.pages.length ? manifest : null);
			}, this.CONTACT_SHEET_TIMEOUT_MS);

			// The page count decides the column count, which decides the width
			// to render at — so every worker opens first and is told the width
			// once they all have. Opening cost about 59 ms in measurement.
			let handOutPages = () => {
				this.log("Handing out " + manifest.renderCount +
					" pages at " + manifest.width + " px");
				let slices = this._pageSlices(manifest.renderCount, workers.length);
				workers.forEach((worker, index) => {
					worker.postMessage({
						type: "render",
						pages: slices[index],
						width: manifest.width,
						quality: 0.7,
					});
				});
			};

			let onMessage = async (event) => {
				let message = event.data;

				if (message.type === "opened") {
					this.log("Renderer opened the document: " +
						message.pageCount + " pages");
					if (!manifest) {
						let count = maxPages > 0
							? Math.min(message.pageCount, maxPages)
							: message.pageCount;
						manifest = {
							pageCount: message.pageCount,
							renderCount: count,
							columns: ZotLookSheet.columnsFor(count, maxColumns),
							width: ZotLookSheet.widthFor(count, maxColumns),
							pages: [],
						};
					}
					if (++opened === workers.length) handOutPages();
					return;
				}

				if (message.type === "page") {
					writing.push((async () => {
						try {
							await IOUtils.write(
								PathUtils.join(
									imageDir,
									"p" + message.page + ".jpg"
								),
								new Uint8Array(message.buffer)
							);
							manifest.pages.push({
								page: message.page,
								height: message.height,
							});
						} catch (e) {
							this.log(
								"Could not write page " + message.page + ": " + e
							);
						}
					})());
					// Counted as it arrives rather than as it lands: the write
					// is what the count is waiting on, and a figure that only
					// moved after the disk did would lag behind the work.
					if (onProgress) onProgress(++drawn, manifest.renderCount);
					return;
				}

				if (message.type === "page-failed") {
					this.log("Page " + message.page + " failed: " + message.error);
					return;
				}

				if (message.type === "failed") {
					this.log("Rendering failed: " + message.error);
					finish(null);
					return;
				}

				if (message.type === "done" && ++done === workers.length) {
					// Every worker has stopped sending, so no further writes
					// will be started — only the ones already going out
					await Promise.all(writing);
					finish(manifest);
				}
			};

			let count = this._rendererWorkerCount(
				bytes.byteLength,
				maxPages > 0 ? maxPages : 0
			);
			for (let i = 0; i < count; i++) {
				let worker;
				try {
					worker = new ChromeWorker(prefix + "render.worker.js", {
						type: "module",
					});
				} catch (e) {
					this.log("Could not start the renderer: " + e);
					break;
				}
				worker.addEventListener("message", onMessage);
				worker.addEventListener("error", (e) => {
					this.log("Renderer error: " + (e.message || e.filename));
					finish(null);
				});
				workers.push(worker);
			}

			if (!workers.length) {
				this.log("No renderer could be started at all");
				finish(null);
				return;
			}
			this.log("Started " + workers.length + " pdf.js renderers");

			// Structured cloning rather than a transfer: every worker parses
			// the document for itself, so every worker needs its own copy
			for (let worker of workers) {
				worker.postMessage({ type: "open", data: bytes.buffer });
			}
		});
	},

	/**
	 * The PDF attachments in a selection, paired with their resolved paths.
	 *
	 * Returns the items rather than only the paths so the contact sheet can
	 * build a link back into Zotero's reader for each page.
	 *
	 * @returns {Promise<Array<{item: Zotero.Item, path: string}>>}
	 */
	async _pickPdfAttachment(items) {
		let candidates = [];

		for (let item of items) {
			if (item.isNote()) continue;

			let attachments = item.isAttachment()
				? [item]
				: (typeof item.getAttachments === "function"
					? item.getAttachments(false).map((id) => Zotero.Items.get(id))
					: []);

			for (let attachment of attachments) {
				if (attachment && this._isPDFAttachment(attachment)) {
					candidates.push(attachment);
				}
			}
		}

		if (candidates.length === 0) return null;
		if (candidates.length > 1) {
			this.log(
				"Contact sheet uses the first of " +
					candidates.length +
					" candidate PDFs"
			);
		}

		// Resolve one path at a time and stop at the first that works.
		// Resolving them all would download every synced attachment of every
		// selected item only to discard all but one.
		for (let attachment of candidates) {
			let path = await this._getAttachmentPath(attachment);
			if (path) return { item: attachment, path: path };
		}

		return null;
	},

	/**
	 * A zotero://open-pdf URL for an attachment, which the contact sheet turns
	 * into a per-page link. Returns "" when the item cannot be addressed, in
	 * which case the sheet is simply not clickable.
	 */
	_readerLink(item) {
		if (!item || !item.key) return "";
		try {
			let library = Zotero.Libraries.get(item.libraryID);
			if (library && library.isGroup) {
				return (
					"zotero://open-pdf/groups/" +
					library.groupID +
					"/items/" +
					item.key
				);
			}
		} catch (e) {
			this.log("Could not resolve library for reader link: " + e);
		}
		return "zotero://open-pdf/library/items/" + item.key;
	},

	/**
	 * Column count for the contact sheet grid.
	 */
	_contactSheetColumns() {
		let value = Number(this._pref("contactSheetColumns", 5));
		if (!Number.isFinite(value) || value < 1) return 5;
		return Math.min(Math.floor(value), 20);
	},

	/**
	 * Page limit for the contact sheet, where 0 means no limit. A negative or
	 * non-numeric preference falls back to the shipped default rather than
	 * being read as "render nothing".
	 */
	_maxContactSheetPages() {
		let value = Number(this._pref("contactSheetMaxPages", 0));
		if (!Number.isFinite(value) || value < 0) return 0;
		return Math.floor(value);
	},

	// ── Subprocess helpers ────────────────────────────────────────────

	_subprocess() {
		return ChromeUtils.importESModule(
			"resource://gre/modules/Subprocess.sys.mjs"
		);
	},

	/**
	 * Runs a command to completion and resolves with its exit status.
	 * With timeoutMs the process is killed once the deadline passes and the
	 * result carries exitCode -1, so a runaway render cannot hang the plugin.
	 */
	async _runProcess(command, args, { timeoutMs = 0 } = {}) {
		const { Subprocess } = this._subprocess();
		let proc = await Subprocess.call({
			command: command,
			arguments: args,
		});

		if (!timeoutMs) return proc.wait();

		let timer = null;
		let timedOut = false;
		try {
			return await Promise.race([
				proc.wait(),
				new Promise((resolve) => {
					timer = setTimeout(() => {
						timedOut = true;
						this.log(
							command + " exceeded " + timeoutMs + " ms, killing"
						);
						try {
							proc.kill();
						} catch (e) {
							// Already gone
						}
						resolve({ exitCode: -1 });
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timer !== null) clearTimeout(timer);
			if (timedOut) this.log("Killed " + command + " after timeout");
		}
	},

	// ── Progress feedback ─────────────────────────────────────────────

	/**
	 * Fluent strings for places that need a resolved string rather than an
	 * l10n id, such as the progress window. Falls back to English if the
	 * bundle cannot be loaded, so a missing translation never breaks a
	 * preview.
	 */
	/**
	 * A translated string, or the English fallback shipped alongside it.
	 *
	 * Cache-only by design: this must never perform I/O. It is called while
	 * the context menu is being built, and a synchronous Localization does
	 * synchronous file access on the main thread — during startup that is
	 * exactly the wrong thing to do.
	 */
	_string(id, fallback) {
		let value = this._strings && this._strings.get(id);
		return value || fallback;
	},

	/**
	 * A string whose wording depends on numbers, so it cannot be preloaded
	 * with the fixed ones. Falls back to English if the bundle will not load.
	 */
	async _formatString(id, args, fallback) {
		try {
			let l10n = new Localization([this.L10N_FILE]);
			return (await l10n.formatValue(id, args)) || fallback;
		} catch (e) {
			this.log("Could not format " + id + ": " + e);
			return fallback;
		}
	},

	/**
	 * Loads the bundle in the background and relabels anything already on
	 * screen. Until it resolves, the English fallbacks are shown.
	 */
	async _loadStrings() {
		let ids = this.MENU_ITEMS.map((entry) => entry.l10nID).concat(
			this.PROGRESS_STRINGS
		);
		try {
			let l10n = new Localization([this.L10N_FILE]);
			let values = await l10n.formatValues(ids.map((id) => ({ id: id })));
			this._strings = new Map();
			ids.forEach((id, i) => {
				if (values[i]) this._strings.set(id, values[i]);
			});
			this._relabelMenus();
			// The converter builds the page on its own and has no Fluent
			// context; it is handed the one string it shows.
			ZotLookEpub.TOC_LABEL = this._string(
				"zotlook-epub-contents",
				ZotLookEpub.TOC_LABEL
			);
		} catch (e) {
			this.log("Could not load localization: " + e);
		}
	},

	/** Applies loaded translations to menus that are already inserted. */
	_relabelMenus() {
		for (let window of this._windowListeners.keys()) {
			let doc = window.document;
			for (let entry of this.MENU_ITEMS) {
				let el = doc.getElementById(entry.id);
				if (el) {
					el.setAttribute(
						"label",
						this._string(entry.l10nID, entry.fallback)
					);
				}
			}
		}
	},

	/**
	 * A progress window, with a line that can be advanced as work proceeds.
	 *
	 * Zotero's ItemProgress is the only thing here that shows progress at all,
	 * and it does so with a twenty-step circular indicator rather than a bar —
	 * so the count goes in the text beside it, where an exact figure is more
	 * use than a bar's position anyway. Where ItemProgress cannot be built,
	 * the plain description it replaces still appears.
	 */
	_showProgress(text) {
		try {
			let pw = new Zotero.ProgressWindow();
			pw.changeHeadline(
				this._string("zotlook-progress-headline", "Quick Look")
			);
			let line = null;
			try {
				line = new pw.ItemProgress("attachment-pdf", text);
			} catch (e) {
				pw.addDescription(text);
			}
			pw.show();
			return { window: pw, line: line, text: text };
		} catch (e) {
			this.log("Could not show progress window: " + e);
			return null;
		}
	},

	/**
	 * Moves the indicator on and names the page count. Called once per page,
	 * so it stays cheap and never throws into the render loop: a window the
	 * user dismissed mid-run would otherwise take the sheet down with it.
	 */
	_setProgress(progress, done, total) {
		if (!progress || !progress.line || !total) return;
		try {
			progress.line.setText(progress.text + "  " + done + " / " + total);
			// Never 100: that ends the indicator, and the last page still has
			// to be written and the sheet assembled around it.
			progress.line.setProgress(
				Math.max(1, Math.min(99, Math.round((done / total) * 100)))
			);
		} catch (e) {
			// The window can be dismissed while this runs
		}
	},

	_closeProgress(progress) {
		if (!progress) return;
		try {
			progress.window.close();
		} catch (e) {
			// Window may already be gone
		}
	},

	/**
	 * Copies one of the bundled binaries out of the XPI so it can be executed,
	 * and returns its path.
	 *
	 * The deployed name carries the plugin version: an upgrade can change a
	 * binary's argument contract, and silently reusing the copy an earlier
	 * version left behind is the same stale-code trap as caching the scripts.
	 */
	/**
	 * Maps resource://zotlook/ onto the plugin directory, so a worker can be
	 * started from a privileged URL. The worker constructor rejects both jar:
	 * and file:, which leaves this as the only way to run one from an XPI.
	 * Returns the prefix, or null if the alias could not be registered.
	 */
	_resourceAlias() {
		if (this._resourcePrefix !== undefined) return this._resourcePrefix;
		this._resourcePrefix = null;
		try {
			let handler = Services.io
				.getProtocolHandler("resource")
				.QueryInterface(Components.interfaces.nsIResProtocolHandler);
			handler.setSubstitution("zotlook", Services.io.newURI(this.rootURI));
			this._resourcePrefix = "resource://zotlook/";
			this.log("Registered " + this._resourcePrefix);
		} catch (e) {
			this.log("Could not register the resource alias: " + e);
		}
		return this._resourcePrefix;
	},

	_dropResourceAlias() {
		if (!this._resourcePrefix) return;
		try {
			Services.io
				.getProtocolHandler("resource")
				.QueryInterface(Components.interfaces.nsIResProtocolHandler)
				.setSubstitution("zotlook", null);
		} catch (e) {
			this.log("Could not drop the resource alias: " + e);
		}
		this._resourcePrefix = undefined;
	},

	/**
	 * Copies a script out of the XPI so a worker can be started from it.
	 * A jar: URL is refused by the worker constructor; a file: URL is not.
	 */
	async _ensureWorkerScript(name) {
		let tempDir = this._getTempDirPath();
		let target = PathUtils.join(
			tempDir,
			ZotLookUtil.safeName(this.version || "0", 20) + "-" + name
		);
		if (await IOUtils.exists(target)) return target;

		try {
			await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
			let response = await fetch(this.rootURI + name);
			await IOUtils.writeUTF8(target, await response.text());
			return target;
		} catch (e) {
			this.log("Failed to unpack " + name + ": " + e);
			return null;
		}
	},

	async _ensureBinary(name) {
		let cached = this._binaries.get(name);
		if (cached && (await IOUtils.exists(cached))) return cached;

		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

		let binaryPath = PathUtils.join(
			tempDir,
			name + "-" + ZotLookUtil.safeName(this.version || "0", 20)
		);

		if (await IOUtils.exists(binaryPath)) {
			this._binaries.set(name, binaryPath);
			return binaryPath;
		}

		this.log("Deploying " + name + "…");
		try {
			let response = await fetch(this.rootURI + name);
			let data = await response.arrayBuffer();
			await IOUtils.write(binaryPath, new Uint8Array(data));
			await IOUtils.setPermissions(binaryPath, 0o755);
			this.log(name + " deployed");
			this._binaries.set(name, binaryPath);
			return binaryPath;
		} catch (e) {
			this.log("Failed to deploy " + name + ": " + e);
			return null;
		}
	},

	/**
	 * Shows the files in macOS' Quick Look.
	 *
	 * Uses the bundled qlpreview helper, which drives QLPreviewPanel — the same
	 * panel the Finder shows. The obvious alternative, `qlmanage -p`, is a
	 * debugging tool: Apple's own movie generator crashes inside it because
	 * AVKit refuses one of its calls there, so videos could not be previewed at
	 * all. qlmanage remains only as a fallback for the case where the helper
	 * cannot be deployed.
	 */
	async _launchPreview(filePaths) {
		// Callers run inside _withLaunchGuard, so no guard of our own here.
		// A preview opened from the context menu can arrive while another one
		// is still up; replace it rather than orphaning the process.
		this._closeQuickLook();

		let plan = await this._previewCommand(filePaths);
		if (!plan) {
			this.log("No preview mechanism on this platform");
			return;
		}

		// A pipe plan is delivered from this very process — a few Win32
		// calls, no subprocess — and QuickLook itself provides the toggle,
		// so like the D-Bus route it leaves nothing to track or kill.
		if (plan.pipePath) {
			await this._postPipeMessage(plan);
			return;
		}

		const { Subprocess } = this._subprocess();
		this.log("Launching: " + plan.command + " " + plan.arguments.join(" "));

		try {
			let call = {
				command: plan.command,
				arguments: plan.arguments,
			};
			// The one-shot request's stderr is read, for the reason it gives
			// when it fails. A viewer held open for the length of a preview
			// gets none: nothing would drain that pipe, and a chatty helper
			// would eventually block on a full one.
			if (!plan.holdsProcess) call.stderr = "pipe";

			let proc = await Subprocess.call(call);

			// Only a viewer that stays running for as long as the preview is
			// visible can be tracked and dismissed. A one-shot request hands
			// the toggling to the viewer itself — but it is still waited for,
			// because it is a D-Bus call whose delivery depends on the sender
			// staying connected until it has been answered.
			if (!plan.holdsProcess) {
				await this._awaitPreviewRequest(proc);
				return;
			}

			this._proc = proc;
			this._isActive = true;

			// Monitor process exit (the user may close the panel themselves).
			// Compare identity first: a later preview may already have taken
			// over _proc, and this handler must not clear its state.
			proc.wait().then(() => {
				this.log("Preview closed");
				if (this._proc === proc) {
					this._isActive = false;
					this._proc = null;
				}
			});
		} catch (e) {
			this.log("Failed to launch the preview: " + e);
			this._isActive = false;
			this._proc = null;
		}
	},

	/**
	 * How this platform shows a preview.
	 *
	 * macOS drives QLPreviewPanel through the bundled helper. GNOME's Sushi is
	 * the closest equivalent elsewhere and is reached over D-Bus; its ShowFile
	 * takes a "close if already shown" flag, which gives the same toggle Space
	 * has on macOS without a process to hold open. On Windows the equivalent
	 * is QuickLook (QL-Win), whose named pipe is written to directly — its
	 * Toggle verb closes on the same file and switches on a different one, so
	 * this route too holds no process. KDE has no comparable system-wide
	 * preview service, so there is nothing to drive there.
	 *
	 * A subprocess plan carries {command, arguments}; a pipe plan carries
	 * {pipePath, pipeLine} instead and is delivered in-process. The pipe is
	 * the way while ctypes exists; the day Gecko drops it, the PowerShell
	 * fallback does the same write from a shell that can read the user's SID.
	 *
	 * @returns {Promise<{command: string, arguments: string[],
	 *          holdsProcess: boolean} | {pipePath: string, pipeLine: string,
	 *          holdsProcess: boolean} | null>}
	 */
	async _previewCommand(filePaths) {
		if (Zotero.isMac) {
			let helper = await this._ensureBinary("qlpreview");
			if (helper) {
				return {
					command: helper,
					arguments: [...filePaths],
					holdsProcess: true,
				};
			}
			this.log("qlpreview unavailable, falling back to qlmanage");
			return {
				command: "/usr/bin/qlmanage",
				arguments: ["-p", ...filePaths],
				holdsProcess: true,
			};
		}

		if (Zotero.isLinux) {
			if (filePaths.length > 1) {
				this.log(
					"Sushi previews one file; showing the first of " +
						filePaths.length
				);
			}
			return {
				command: await this._dbusSend(),
				arguments: [
					"--session",
					// --print-reply is not here for its output. Without it
					// dbus-send writes the message and exits within
					// milliseconds. Sushi is started by D-Bus on demand and
					// takes about a second to come up, and dbus-daemon
					// discards a message queued for activation as soon as the
					// connection that sent it goes away — so the service
					// starts, never receives ShowFile, and quits again on its
					// idle timeout. Nothing is logged anywhere and no window
					// ever appears. Waiting for the reply keeps the connection
					// open until the call has actually been delivered.
					"--print-reply",
					"--reply-timeout=" + this.PREVIEW_REPLY_TIMEOUT_MS,
					"--dest=org.gnome.NautilusPreviewer",
					"/org/gnome/NautilusPreviewer",
					"org.gnome.NautilusPreviewer.ShowFile",
					"string:" + PathUtils.toFileURI(filePaths[0]),
					"int32:0",
					"boolean:true",
				],
				holdsProcess: false,
			};
		}

		if (Zotero.isWin) {
			if (filePaths.length > 1) {
				this.log(
					"QuickLook previews one file; showing the first of " +
						filePaths.length
				);
			}
			let line = ZotLookUtil.quickLookPipeLine("Toggle", filePaths[0]);
			try {
				return {
					pipePath: this._winPreview().pipePath(),
					pipeLine: line,
					holdsProcess: false,
				};
			} catch (e) {
				this.log(
					"Falling back to PowerShell for the pipe write: " + e
				);
			}
			return {
				command: await this._powershell(),
				arguments: [
					"-NoProfile",
					"-NonInteractive",
					"-EncodedCommand",
					ZotLookUtil.encodePowerShell(
						ZotLookUtil.quickLookFallbackScript(line)
					),
				],
				holdsProcess: false,
			};
		}

		return null;
	},

	/** Overridable for tests, like _subprocess. */
	_winPreview() {
		return ZotLookWinPreview;
	},

	/**
	 * Where powershell.exe is. Looked up on PATH rather than assumed under
	 * System32; the conventional location remains the fallback, so a
	 * stripped-down PATH does not by itself break the preview.
	 */
	async _powershell() {
		const { Subprocess } = this._subprocess();
		if (Subprocess && typeof Subprocess.pathSearch === "function") {
			try {
				return await Subprocess.pathSearch("powershell.exe");
			} catch (e) {
				this.log("powershell.exe is not on PATH: " + e);
			}
		}
		return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
	},

	/**
	 * Delivers a pipe plan: one complete line into QuickLook's named pipe,
	 * from this process. The failure worth naming is the pipe not existing —
	 * QuickLook simply is not running — which postLine marks on the error.
	 */
	async _postPipeMessage(plan) {
		try {
			this._winPreview().postLine(plan.pipePath, plan.pipeLine);
			this.log("Preview request delivered");
		} catch (e) {
			this.log("The preview request was refused: " + e);
			if (e && e.quickLookAbsent) this._logQuickLookMissing();
			await this._writeFailureReport("the preview request was refused");
		}
	},

	_logQuickLookMissing() {
		this.log(
			"QuickLook does not appear to be running. Start it — or install " +
				"it from https://github.com/QL-Win/QuickLook — to preview " +
				"outside Zotero; the contact sheet in a window works " +
				"without it."
		);
	},

	/**
	 * Where dbus-send is. Looked up on PATH rather than assumed at
	 * /usr/bin/dbus-send, which is where Debian and Fedora put it but not
	 * every distribution does. The conventional location remains the fallback,
	 * so a stripped-down PATH does not by itself break the preview.
	 */
	async _dbusSend() {
		const { Subprocess } = this._subprocess();
		if (Subprocess && typeof Subprocess.pathSearch === "function") {
			try {
				return await Subprocess.pathSearch("dbus-send");
			} catch (e) {
				this.log("dbus-send is not on PATH: " + e);
			}
		}
		return "/usr/bin/dbus-send";
	},

	/**
	 * Waits for a one-shot preview request and says what went wrong when it
	 * fails.
	 *
	 * Waiting is what makes the request arrive at all — see _previewCommand —
	 * and the exit status is the only sign the plugin gets that the preview
	 * service answered. Without this, every failure looks identical from the
	 * outside: nothing happens.
	 */
	async _awaitPreviewRequest(proc) {
		let complaint = "";
		try {
			complaint = (await proc.stderr.readString()) || "";
		} catch (e) {
			// A pipe that is already at end of file is not itself a failure
		}

		let { exitCode } = await proc.wait();
		if (exitCode === 0) {
			this.log("Preview request delivered");
			return;
		}

		complaint = complaint.trim();
		this.log(
			"The preview request was refused (exit " + exitCode + ")" +
				(complaint ? ": " + complaint : "")
		);
		// The one failure worth naming: the service is simply not there.
		if (/ServiceUnknown|not provided by any/.test(complaint)) {
			this.log(
				"GNOME Sushi does not appear to be installed. Install it " +
					"(package gnome-sushi) to preview outside Zotero; the " +
					"contact sheet in a window works without it."
			);
		}
		// The marker the PowerShell fallback prints when the pipe never
		// answered — its own exception text is localised.
		if (/QuickLookUnreachable/.test(complaint)) {
			this._logQuickLookMissing();
		}
		await this._writeFailureReport("the preview request was refused");
	},

	_closeQuickLook() {
		if (this._proc) {
			this.log("Closing the preview");
			this._proc.kill();
			this._proc = null;
			this._isActive = false;
		}
	},

	// ── File path resolution ──────────────────────────────────────────

	/**
	 * Resolves the selection into files QuickLook can display.
	 */
	async _getPreviewPath(items) {
		let paths = [];

		for (let item of items) {
			let path = null;

			if (item.isNote()) {
				path = await this._writeNoteToTempFile(item);
				if (path) paths.push(path);
				continue;
			}

			let attachment = null;
			if (item.isAttachment()) {
				attachment = item;
				path = await this._getAttachmentPath(item);
			} else {
				let chosen = await this._pickBestAttachment(item);
				if (chosen) ({ item: attachment, path } = chosen);
			}

			if (!path) continue;
			path = await this._normalizeForPreview(path, attachment);
			if (path) paths.push(path);
		}

		return paths;
	},

	/**
	 * Picks the attachment worth previewing for a regular item: a PDF if there
	 * is one, otherwise an EPUB, otherwise whatever came first.
	 *
	 * @returns {Promise<string|null>} file path
	 */
	async _pickBestAttachment(item) {
		let attachments = this._attachmentsOf(item);
		if (attachments.length === 0) return null;

		// Order the candidates first, then resolve them one at a time and stop
		// at the first that works. Resolving them all would download every
		// synced attachment only to discard all but one.
		for (let attachment of this._orderAttachments(attachments)) {
			let path = await this._getAttachmentPath(attachment);
			if (path) return { item: attachment, path: path };
		}
		return null;
	},

	_attachmentsOf(item) {
		if (typeof item.getAttachments !== "function") return [];
		return item
			.getAttachments(false)
			.map((id) => Zotero.Items.get(id))
			.filter((a) => a && !a.isNote());
	},

	/**
	 * Sorts attachments by the configured preference.
	 *
	 * In "first" mode the item's own order is kept. Otherwise the configured
	 * type order decides. Every type stays eligible: the setting is a ranking,
	 * so a type near the bottom is still used when nothing above it is there.
	 */
	_orderAttachments(attachments) {
		if (this._pref("attachmentMode", "type") === "first") {
			return attachments;
		}

		let order = ZotLookUtil.attachmentOrder(this._pref("attachmentOrder", ""));

		let ordered = [];
		for (let type of order) {
			for (let attachment of attachments) {
				if (this._attachmentType(attachment) === type) {
					ordered.push(attachment);
				}
			}
		}
		return ordered;
	},

	/**
	 * Which of the configurable categories an attachment falls into.
	 * Defensive throughout: this runs while a menu or preview is opening.
	 */
	_attachmentType(item) {
		try {
			if (this._isPDFAttachment(item)) return "pdf";
			if (typeof item.isEPUBAttachment === "function" && item.isEPUBAttachment()) {
				return "epub";
			}
			if (typeof item.isSnapshotAttachment === "function" && item.isSnapshotAttachment()) {
				return "html";
			}
			if (typeof item.isImageAttachment === "function" && item.isImageAttachment()) {
				return "image";
			}
			if (typeof item.isVideoAttachment === "function" && item.isVideoAttachment()) {
				return "video";
			}
		} catch (e) {
			this.log("Could not classify attachment: " + e);
		}
		return "other";
	},

	/**
	 * Turns a file into something Quick Look can show, where that is needed.
	 *
	 * Only EPUB gets special treatment, and only when asked: stock macOS shows
	 * no EPUB preview, but a Quick Look extension that handles EPUB renders it
	 * better than this plugin's own conversion can. Whether such an extension
	 * is installed is not reliably detectable, so it is a setting.
	 */
	async _normalizeForPreview(path, attachment) {
		if (!path) return path;

		if (
			path.toLowerCase().endsWith(".epub") &&
			this._pref("epubOwnRenderer", true)
		) {
			let html = await ZotLookEpub.convert(path, this._epubEnv());
			return html || path;
		}

		let annotated = await this._annotatedCopy(attachment);
		return annotated || path;
	},

	/**
	 * A copy of a PDF with the item's Zotero annotations drawn into it.
	 *
	 * The stored file holds none of them — Zotero keeps annotations in its
	 * database and only bakes them in on export — so a plain preview shows an
	 * unmarked document, which is the most frequently asked-for gap in this
	 * plugin.
	 *
	 * Costs nothing for the common case: an attachment without annotations is
	 * recognised before any work starts, and an export is reused until an
	 * annotation changes.
	 *
	 * @returns {Promise<string|null>} path to the exported copy, or null to
	 *          preview the file as it is
	 */
	async _annotatedCopy(attachment) {
		if (!attachment || !this._pref("previewAnnotations", true)) return null;
		if (!this._isPDFAttachment(attachment)) return null;
		if (!Zotero.PDFWorker || typeof Zotero.PDFWorker.export !== "function") {
			return null;
		}

		let signature = this._annotationSignature(attachment);
		if (!signature) return null;

		let cached = this._annotationCache.get(attachment.key);
		if (
			cached &&
			cached.signature === signature &&
			(await IOUtils.exists(cached.path))
		) {
			return cached.path;
		}

		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
		let outputPath = PathUtils.join(
			tempDir,
			"annotated_" + ZotLookUtil.safeName(attachment.key, 40) + ".pdf"
		);

		try {
			this.log("Exporting annotations for " + attachment.key);
			await Zotero.PDFWorker.export(attachment.id, outputPath, true);
		} catch (e) {
			this.log("Could not export annotations: " + e);
			return null;
		}

		this._annotationCache.set(attachment.key, {
			signature: signature,
			path: outputPath,
		});
		return outputPath;
	},

	/**
	 * Identifies the current state of an attachment's annotations, or null when
	 * it has none worth drawing. External annotations are already part of the
	 * file, so they do not count.
	 */
	_annotationSignature(attachment) {
		let annotations;
		try {
			annotations = attachment
				.getAnnotations()
				.filter((a) => !a.annotationIsExternal);
		} catch (e) {
			this.log("Could not read annotations: " + e);
			return null;
		}
		if (annotations.length === 0) return null;

		let latest = "";
		for (let annotation of annotations) {
			let modified = annotation.dateModified || "";
			if (modified > latest) latest = modified;
		}
		return annotations.length + "@" + latest;
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

		let html = this._buildNoteHtml(title, noteContent);
		if (!html) {
			this.log("Could not render note " + item.id);
			return null;
		}

		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

		// Key the file on the item so repeated previews of the same note
		// overwrite one file instead of piling up
		let filePath = PathUtils.join(
			tempDir,
			ZotLookUtil.safeName(title, 100) + "_" + item.id + ".html"
		);

		await IOUtils.writeUTF8(filePath, html);
		this.log("Wrote note to: " + filePath);

		return filePath;
	},

	/**
	 * Wraps a note's stored HTML in a styled page.
	 *
	 * The note is parsed and sanitised as a tree rather than pasted into a
	 * string, so nothing in it can escape into the surrounding document and
	 * nothing in it executes once QuickLook renders the page in its WebKit
	 * view — notes can arrive from imports and group libraries.
	 */
	_buildNoteHtml(title, noteContent) {
		let out = ZotLookUtil.newHtmlDocument();
		let noteBody = ZotLookUtil.parseBodyFragment(noteContent);
		if (!out || !noteBody) return null;

		out.title = title;

		let style = out.createElement("style");
		style.textContent = [
			"body {",
			"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
			"  padding: 20px;",
			"  max-width: 800px;",
			"  margin: 0 auto;",
			"}",
		].join("\n");
		out.head.appendChild(style);

		ZotLookUtil.sanitize(noteBody);
		for (let node of [...noteBody.childNodes]) {
			out.body.appendChild(out.importNode(node, true));
		}

		return ZotLookUtil.serializeHtmlDocument(out);
	},

	_getTempDirPath() {
		if (!this._tempDir) {
			let base = Zotero.getTempDirectory().path;
			this._tempDir = PathUtils.join(base, "zotLook");
		}
		return this._tempDir;
	},

	/**
	 * What ZotLookEpub needs from us: somewhere to work, and a way to run
	 * a subprocess under a deadline.
	 */
	_epubEnv() {
		return {
			tempDir: this._getTempDirPath(),
			runProcess: (command, args, opts) =>
				this._runProcess(command, args, opts),
		};
	},

	// ── Shutdown ──────────────────────────────────────────────────────

	shutdown() {
		this._closeQuickLook();
		this._dropResourceAlias();
		this._unregisterPreferencePane();
		this._unwatchPreferences();
		this._cleanTempDir().catch((e) =>
			this.log("Shutdown cleanup failed: " + e)
		);
		this.initialized = false;
	},

	async _cleanTempDir() {
		// Drop the caches before awaiting anything. On shutdown bootstrap.js
		// releases the module globals as soon as this returns, so a
		// continuation that ran after the await would find ZotLookEpub gone.
		ZotLookEpub.clearCache();
		this._binaries.clear();
		this._annotationCache.clear();

		// Resolve the path rather than reading _tempDir: on startup nothing has
		// populated it yet, and the point of this call is to clear leftovers
		// from a previous session.
		let dir = this._getTempDirPath();
		try {
			await IOUtils.remove(dir, { recursive: true });
			this.log("Cleaned temp directory: " + dir);
		} catch (e) {
			// Nothing to clean — the directory may not exist yet
		}
	},
};
