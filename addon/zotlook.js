/* eslint-disable no-unused-vars */
/* global Zotero, ChromeUtils, PathUtils, IOUtils, Services, Localization */
/* global setTimeout, clearTimeout */
/* global ChromeWorker, Components, OffscreenCanvas */
/* global ZotLookUtil, ZotLookEpub */

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

	// Per-window cleanup tracking
	_windowListeners: new Map(),

	// id -> translated text, filled in asynchronously; until then the English
	// fallbacks in MENU_ITEMS stand in
	_strings: null,

	PROGRESS_STRINGS: [
		"zotlook-progress-headline",
		"zotlook-progress-contactsheet",
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
			macOnly: true,
		},
		{
			id: "zotlook-contactsheet-window-menu-item",
			l10nID: "zotlook-menu-contactsheet-window",
			fallback: "Contact Sheet in a Window (clickable)",
			open: "_openContactSheetInViewer",
			needsPDF: true,
			macOnly: true,
		},
		// TEMPORARY: measurement entry, removed once the numbers are in
		{
			id: "zotlook-bench-menu-item",
			l10nID: "zotlook-menu-bench",
			fallback: "zotLook: measure the pdf.js renderer (test)",
			open: "_benchmarkPdfjs",
			needsPDF: true,
		},
	],

	log(msg) {
		Zotero.debug("zotLook: " + msg);
	},

	/** Whether this platform has a preview mechanism to drive at all. */
	_platformSupported() {
		return !!(Zotero.isMac || Zotero.isLinux);
	},

	/** The contact sheet needs the bundled renderer, which is macOS-only. */
	_contactSheetSupported() {
		return !!Zotero.isMac;
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
		if (entry.macOnly && !this._contactSheetSupported()) return false;
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
	 * QuickLook renders previews with JavaScript disabled and does not act on
	 * links, so the per-page links are inert there — but they are not wasted:
	 * QuickLook offers to open an HTML preview in the browser, and from there
	 * they work, as they do in this window.
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
			this.log("The contact sheet renderer is only available on macOS");
			return null;
		}

		// Resolve to an attachment item rather than a bare path: the reader
		// links in the sheet need the item's key and library
		let chosen = await this._pickPdfAttachment(items);

		if (!chosen) {
			this.log("No PDF files for contact sheet");
			return null;
		}

		// Ensure the contact sheet binary is deployed
		let binary = await this._ensureBinary("contactsheet");
		if (!binary) {
			this.log("Contact sheet binary not available");
			return null;
		}

		// Render the annotated copy where there is one: on a sheet of every
		// page, the marked-up ones are exactly what makes it worth scanning.
		let pdfPath = (await this._annotatedCopy(chosen.item)) || chosen.path;
		let tempDir = this._getTempDirPath();
		await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

		// Name the output after the source so a second contact sheet does not
		// overwrite one that QuickLook may still have open
		// Named after the source rather than after what is rendered, so the
		// sheet keeps one name whether or not annotations were drawn in
		let outputPath = PathUtils.join(
			tempDir,
			"contactsheet_" +
				ZotLookUtil.safeName(PathUtils.filename(chosen.path), 60) +
				".html"
		);

		this.log("Generating contact sheet for: " + pdfPath);

		// Rendering is CPU-bound and can run for many seconds on a long PDF,
		// so tell the user something is happening
		let progress = this._showProgress(
			this._string(
				"zotlook-progress-contactsheet",
				"Generating contact sheet…"
			)
		);

		try {
			let result = await this._runProcess(
				binary,
				[
					pdfPath,
					outputPath,
					String(this._contactSheetColumns()),
					String(this._maxContactSheetPages()),
					this._readerLink(chosen.item),
				],
				{ timeoutMs: this.CONTACT_SHEET_TIMEOUT_MS }
			);
			if (result.exitCode !== 0) {
				this.log(
					"Contact sheet generation failed with code " +
						result.exitCode
				);
				return null;
			}
		} catch (e) {
			this.log("Contact sheet generation error: " + e);
			return null;
		} finally {
			this._closeProgress(progress);
		}

		return outputPath;
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

	// ── Renderer benchmark (temporary) ────────────────────────────────

	/**
	 * TEMPORARY. Measures the pdf.js build Zotero ships against the bundled
	 * Swift renderer, which does 300 pages in about 6 s across ten cores.
	 *
	 * pdf.js would render on every platform and draw annotations without an
	 * export, but only a measurement can say whether it is fast enough to
	 * replace the native path or should only fill in where that cannot run.
	 * Results go to the debug output; remove this once the numbers are in.
	 */
	async _benchmarkPdfjs(items) {
		const MAX_PAGES = 30;
		const WIDTH = 500;

		// The debug output cannot carry this: other plugins flood it and the
		// viewer truncates. Every path through here leaves a file behind, so
		// a run that produces nothing at all means it never started.
		let writeReport = async (report) => {
			try {
				let dir = this._getTempDirPath();
				await IOUtils.makeDirectory(dir, { ignoreExisting: true });
				await IOUtils.writeUTF8(
					PathUtils.join(dir, "bench-result.json"),
					JSON.stringify(report, null, 2)
				);
			} catch (e) {
				this.log("BENCH: could not write the report: " + e);
			}
		};

		let chosen = await this._pickPdfAttachment(items);
		if (!chosen) {
			this.log("BENCH: no PDF selected");
			await writeReport({ ok: false, error: "no PDF among the selection" });
			return false;
		}

		let source = (await this._annotatedCopy(chosen.item)) || chosen.path;
		this.log("BENCH: rendering " + source);

		let bytes;
		try {
			bytes = await IOUtils.read(source);
		} catch (e) {
			this.log("BENCH: could not read the file: " + e);
			await writeReport({ ok: false, error: "read failed: " + e });
			return false;
		}

		// The worker constructor rejects jar: and file: alike, so the script is
		// reachable only through a resource: alias. Whether that can be
		// registered decides whether a portable renderer could use a worker at
		// all, so it is part of what this measures.
		let prefix = this._resourceAlias();
		if (!prefix) {
			this.log("BENCH: no worker possible, measuring on this thread");
			return this._benchmarkOnMainThread(bytes, MAX_PAGES, WIDTH, writeReport);
		}

		return new Promise((resolve) => {
			let worker;
			try {
				worker = new ChromeWorker(prefix + "bench.worker.js", {
					type: "module",
				});
			} catch (e) {
				this.log("BENCH: could not start the worker: " + e);
				this._benchmarkOnMainThread(bytes, MAX_PAGES, WIDTH, writeReport)
					.then(resolve);
				return;
			}

			// A worker that answers nothing would otherwise leave no trace
			let timer = setTimeout(async () => {
				this.log("BENCH: the worker did not answer");
				await writeReport({
					ok: false,
					error: "no answer within 120 s",
					trail: trail,
				});
				worker.terminate();
				resolve(false);
			}, 120000);

			let started = Date.now();
			let trail = [];
			worker.addEventListener("message", async (event) => {
				let r = event.data || {};
				r.wallMs = Date.now() - started;

				// Progress messages are recorded and waited on; only the final
				// report ends the run. The trail is what tells us where a run
				// that never finishes gave up.
				trail.push({
					stage: r.stage || "?",
					ms: r.wallMs,
					detail: Object.keys(r)
						.filter((k) => !["stage", "wallMs", "sample", "pages"].includes(k))
						.reduce((o, k) => Object.assign(o, { [k]: r[k] }), {}),
				});
				await writeReport({
					ok: r.ok === true,
					trail: trail,
					error: r.error,
					version: r.version,
					pageCount: r.pageCount,
					steps: r.steps,
					wallMs: r.wallMs,
					pages: r.pages,
				});
				if (r.stage !== "done") return;

				clearTimeout(timer);
				if (!r.ok) {
					this.log("BENCH: FAILED — " + r.error);
					worker.terminate();
					resolve(false);
					return;
				}

				let times = r.pages.map((p) => p.ms).sort((a, b) => a - b);
				let median = times[Math.floor(times.length / 2)];
				let bytesTotal = r.pages.reduce((sum, p) => sum + p.bytes, 0);
				this.log(
					"BENCH: pdf.js " + r.version +
					" | import " + r.steps.importMs + " ms" +
					" | open " + r.steps.openMs + " ms" +
					" | " + r.pages.length + " of " + r.pageCount + " pages in " +
					r.steps.totalMs + " ms" +
					" | median/page " + median + " ms" +
					" | mean size " + Math.round(bytesTotal / r.pages.length / 1024) + " KB" +
					" | wall " + (Date.now() - started) + " ms" +
					" | extrapolated 300 pages, one thread: " +
					Math.round((median * 300) / 1000) + " s"
				);

				// Write the first page out so the annotations can be eyeballed
				if (r.sample) {
					try {
						let dir = this._getTempDirPath();
						await IOUtils.makeDirectory(dir, { ignoreExisting: true });
						let out = PathUtils.join(dir, "bench-page1.jpg");
						await IOUtils.write(out, new Uint8Array(r.sample));
						this.log("BENCH: first page written to " + out);
						await this._launchPreview([out]);
					} catch (e) {
						this.log("BENCH: could not write the sample: " + e);
					}
				}

				worker.terminate();
				resolve(true);
			});

			worker.addEventListener("error", async (e) => {
				clearTimeout(timer);
				let detail = (e.message || "") + " @ " + (e.filename || "") +
					":" + (e.lineno || "");
				this.log("BENCH: worker error — " + detail);
				await writeReport({
					ok: false,
					error: "worker error: " + detail,
					trail: trail,
				});
				worker.terminate();
				resolve(false);
			});

			worker.postMessage(
				{ data: bytes.buffer, maxPages: MAX_PAGES, width: WIDTH, quality: 0.7 },
				[bytes.buffer]
			);
		});
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

	_showProgress(text) {
		try {
			let pw = new Zotero.ProgressWindow();
			pw.changeHeadline(
				this._string("zotlook-progress-headline", "Quick Look")
			);
			pw.addDescription(text);
			pw.show();
			return pw;
		} catch (e) {
			this.log("Could not show progress window: " + e);
			return null;
		}
	},

	_closeProgress(pw) {
		if (!pw) return;
		try {
			pw.close();
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
	 * TEMPORARY. The same measurement without a worker: pdf.js parses in a
	 * worker of its own, which is loaded from resource:// and therefore
	 * allowed, so only the rasterising happens here. It blocks the interface,
	 * which is why this is a fallback and not the plan — but the per-page cost
	 * it reports is the number the decision turns on.
	 */
	async _benchmarkOnMainThread(bytes, maxPages, width, writeReport) {
		let report = { ok: false, where: "main thread", steps: {}, pages: [] };
		try {
			let t0 = Date.now();
			let lib = await import(
				"resource://zotero/reader/pdf/build/pdf.mjs"
			);
			report.steps.importMs = Date.now() - t0;
			report.version = lib.version || "unknown";

			if (typeof OffscreenCanvas === "undefined") {
				throw new Error("no OffscreenCanvas in this scope");
			}

			let t1 = Date.now();
			let doc = await lib.getDocument({
				data: bytes,
				isEvalSupported: false,
			}).promise;
			report.steps.openMs = Date.now() - t1;
			report.pageCount = doc.numPages;

			let count = Math.min(doc.numPages, maxPages);
			for (let i = 1; i <= count; i++) {
				let tp = Date.now();
				let page = await doc.getPage(i);
				let viewport = page.getViewport({
					scale: width / page.getViewport({ scale: 1 }).width,
				});
				let canvas = new OffscreenCanvas(
					Math.ceil(viewport.width),
					Math.ceil(viewport.height)
				);
				let ctx = canvas.getContext("2d");
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				await page.render({
					canvasContext: ctx,
					viewport: viewport,
					intent: "print",
					annotationMode: 2,
				}).promise;
				let blob = await canvas.convertToBlob({
					type: "image/jpeg",
					quality: 0.7,
				});
				report.pages.push({
					page: i,
					ms: Date.now() - tp,
					bytes: blob.size,
				});
				if (i === 1) {
					let dir = this._getTempDirPath();
					await IOUtils.write(
						PathUtils.join(dir, "bench-page1.jpg"),
						new Uint8Array(await blob.arrayBuffer())
					);
				}
				page.cleanup();
			}
			report.steps.totalMs = Date.now() - t0;
			report.ok = true;
		} catch (e) {
			report.error = String(e && e.stack ? e.stack : e);
		}
		await writeReport(report);
		this.log("BENCH: " + JSON.stringify(report.steps));
		return report.ok;
	},

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

		const { Subprocess } = this._subprocess();

		let plan = await this._previewCommand(filePaths);
		if (!plan) {
			this.log("No preview mechanism on this platform");
			return;
		}
		this.log("Launching: " + plan.command + " " + plan.arguments.join(" "));

		try {
			let proc = await Subprocess.call({
				command: plan.command,
				arguments: plan.arguments,
			});

			// Only a viewer that stays running for as long as the preview is
			// visible can be tracked and dismissed. A one-shot request hands
			// the toggling to the viewer itself.
			if (!plan.holdsProcess) return;

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
	 * has on macOS without a process to hold open. KDE has no comparable
	 * system-wide preview service, so there is nothing to drive there.
	 *
	 * @returns {Promise<{command: string, arguments: string[],
	 *          holdsProcess: boolean}|null>}
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
				command: "/usr/bin/dbus-send",
				arguments: [
					"--session",
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

		return null;
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
