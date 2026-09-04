/* eslint-disable no-unused-vars */
/* global Zotero, ChromeUtils, PathUtils, IOUtils, Services, Localization */
/* global setTimeout, clearTimeout */
/* global ChromeWorker, Components, OffscreenCanvas */
/* global zotLookUtil, zotLookEpub, zotLookSheet, zotLookWinPreview */

// Sealed rather than frozen, and the difference is the point.
//
// In a .js file TypeScript treats an object literal as open — a property it
// has never seen is assumed to be one somebody adds later — so a misspelt
// method name here was not an error, in a module with a hundred and sixty of
// them. Sealing closes it for the checker exactly as freezing does.
//
// Freezing would not do: this object is state as well as behaviour. Startup
// writes id, version and rootURI into it, the caches above fill in as they
// are worked out, and the tests stand methods aside to drive one path at a
// time. Sealing allows all of that and forbids only what nothing here does,
// which is to invent a property that was never declared.
var zotLook = Object.seal({
	id: null,
	version: null,
	rootURI: null,
	initialized: false,

	// Worked out once and kept. These were created on first use and never
	// declared, which reads as if they did not exist until they do; sealing
	// the object below makes that unworkable anyway, because a property a
	// sealed object has never had cannot be added and the attempt says
	// nothing about itself outside strict mode.
	_buildTag: null,
	_keptRoot: null,
	// undefined rather than null on purpose: _resourceAlias uses "!== undefined"
	// to tell "not worked out yet" from "worked out, and there is none"
	_resourcePrefix: undefined,

	// Process state
	_proc: null,
	_isActive: false,
	// Set by a refused preview request whose reason is that the previewer
	// is not there at all; read once by _launchPreview for the fallback
	_previewerAbsent: false,
	// What the last press put up, for the arrows to walk: the files in
	// order, and which of them is showing. Quick Look walks the list on
	// its own; Sushi and QuickLook show one file at a time and are told
	// the next by the plugin.
	_previewList: { paths: [], index: 0 },
	// Whether a request that shows something has gone down QuickLook's pipe
	// since the last one that closed it. QuickLook toggles on its own, so
	// this can be stale in one direction — set while nothing is showing any
	// more — and a Close sent then is a harmless no-op.
	_pipeShown: false,
	// Its Sushi counterpart: a ShowFile went out and may still be showing
	_sushiShown: false,
	// The long-running listener for what Sushi says back — see
	// _ensureSushiMonitor
	_sushiMonitor: null,
	_sushiPreviewTimer: null,
	// The Zotero window holding a contact sheet, while one is open
	_viewer: null,
	_viewerKeyHandler: null,
	// Takes the loading hint off the window, while one is up
	_viewerLoadingClear: null,
	// The item pane section's id, while it is registered
	_sectionID: null,
	// Zotero.Reader.open, unwrapped — held only while the window lives
	_readerOpenOriginal: null,
	_readerOpenPatched: null,
	// The attachment the sheet in the window was drawn from, so a reader
	// opening for it can be recognised as that sheet's own handoff
	_viewerItemID: null,
	// What the sheet just built was drawn from, for the line above to take
	_lastSheetItemID: null,
	// A collection sheet is drawn from several; the reader opening for any
	// of them is that sheet's handoff
	_lastSheetItemIDs: [],
	_viewerItemIDs: [],
	_launching: false,
	_tempDir: null,
	// binary name -> deployed path
	_binaries: new Map(),
	// attachment key -> { signature, path } for exported annotated copies

	// Pages render concurrently into files beside the HTML, so the page count
	// is a safety limit rather than a performance ceiling; it is configurable
	// under extensions.zotlook.contactSheetMaxPages. The deadline still applies.
	CONTACT_SHEET_TIMEOUT_MS: 60000,

	// How long to wait for Sushi to answer a preview request. The call itself
	// returns as soon as the window has been handed its file, so this only has
	// to cover starting the service, which D-Bus does on the first request.
	PREVIEW_REPLY_TIMEOUT_MS: 10000,

	// How long the preview waits behind a moving selection. Arrows move the
	// selection at once; the preview follows when the keys come to rest, so a
	// held key walks the list without a ShowFile for every row passed.
	SUSHI_STEP_PREVIEW_DELAY_MS: 150,

	// Gtk.DirectionType, as Sushi's SelectionEvent reports it: TAB_FORWARD 0,
	// TAB_BACKWARD 1, UP 2, DOWN 3, LEFT 4, RIGHT 5.
	SUSHI_NEXT_DIRECTIONS: [0, 3, 5],

	// Per-window cleanup tracking
	_windowListeners: new Map(),

	// id -> translated text, filled in asynchronously; until then the English
	// fallbacks in MENU_ITEMS stand in
	_strings: null,

	/**
	 * Every string asked for by id rather than through a data-l10n-id: the
	 * progress window's, and the two labels the EPUB conversion prints.
	 *
	 * They have to be fetched to exist. A caller of _string() whose id is
	 * missing here gets the English fallback and no complaint — which is how
	 * the annotations button stayed English in a German Zotero.
	 */
	LOADED_STRINGS: [
		"zotlook-progress-headline",
		"zotlook-progress-contactsheet",
		"zotlook-progress-download",
		"zotlook-epub-contents",
		"zotlook-epub-annotations",
		"zotlook-epub-goto",
		"zotlook-epub-nopages",
		"zotlook-epub-nopages-hint",
		"zotlook-epub-frontmatter",
		"zotlook-sheet-page",
		"zotlook-sheet-note",
		"zotlook-sheet-image",
		"zotlook-sheet-ink",
		"zotlook-sheet-text",
		"zotlook-sheet-loading",
		"zotlook-sheet-title",
		"zotlook-sheet-open",
		"zotlook-sheet-collection-title",
		"zotlook-sheet-nopage",
		"zotlook-progress-collection",
		"zotlook-pane-preview",
		"zotlook-pane-sheet",
		"zotlook-pane-window",
		"zotlook-sheet-search",
		"zotlook-sheet-search-none",
		"zotlook-sheet-pages",
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
			needsPages: false,
		},
		{
			id: "zotlook-contactsheet-menu-item",
			l10nID: "zotlook-menu-contactsheet",
			fallback: "Quick Look Contact Sheet",
			open: "_openContactSheet",
			needsPages: true,
			needsSystemPreview: true,
		},
		{
			id: "zotlook-contactsheet-window-menu-item",
			l10nID: "zotlook-menu-contactsheet-window",
			fallback: "Contact Sheet in a Window (clickable)",
			open: "_openContactSheetInViewer",
			needsPages: true,
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

		// The preference pane runs in the preferences window and is handed
		// only the scripts named in the registration below — util.js and
		// prefs-pane.js. Anything of the plugin it needs has to be reachable
		// from there, and Zotero is the one object both scopes share. This
		// is how the pane gets at the kept sheets to measure and clear them.
		Zotero.zotLook = this;
		// Said out loud rather than assumed: an assignment onto an object
		// from another compartment can fail without throwing, and the only
		// symptom would be a control in the pane that quietly does nothing.
		if (Zotero.zotLook !== this) {
			this.log(
				"Could not publish the plugin on Zotero; the preference " +
					"pane will not find the kept sheets"
			);
		}

		this._carryOverRenamedPrefs();

		// Read before anything is kept or reused: the tag is what says which
		// build made an entry
		this._readBuildTag()
			.then(() =>
				this._dropStaleEntries().catch((e) =>
					this.log("Could not clear entries of other builds: " + e)
				)
			)
			.catch((e) => this.log("Could not read the build stamp: " + e));

		this._registerPreferencePane();
		this._registerItemPaneSection();
		this._watchPreferences();
		this._loadStrings().catch((e) =>
			this.log("String loading failed: " + e)
		);

		// Clean up any leftover temp files from previous sessions
		this._cleanTempDir().catch((e) =>
			this.log("Startup cleanup failed: " + e)
		);

		// Kept previews are not leftovers, so they survive that — but the
		// ones nobody has opened in a long time are dropped here
		this._expireKept().catch((e) =>
			this.log("Could not clear old previews: " + e)
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

		// The window's own strings, for what Zotero labels by id: the item
		// pane section's header and its sidenav button
		try {
			if (window.MozXULElement && typeof window.MozXULElement.insertFTLIfNeeded === "function") {
				window.MozXULElement.insertFTLIfNeeded(this.L10N_FILE);
			}
		} catch (e) {
			this.log("Could not add the strings to the window: " + e);
		}

		// Keyboard listener on items tree (capture phase to intercept
		// before VirtualizedTable's bubble-phase Space handler)
		let itemsTree = doc.getElementById("zotero-items-tree");
		if (!itemsTree) {
			this.log("Could not find zotero-items-tree");
			return;
		}

		let keydownHandler = (event) => this._onKeyDown(event, window);
		itemsTree.addEventListener("keydown", keydownHandler, true);

		// A second listener on the window itself, for closing only. The one
		// on the tree opens a preview and needs the tree's focus to beat its
		// find-as-you-type; but the press that closes one can come from
		// anywhere in the window — Escape after a context-menu command lands
		// on whatever the menu left focused, not on the tree — so closing is
		// caught a level up. It runs first, being the ancestor, and stops the
		// event only when it actually closes something, so the tree listener
		// and Zotero's own Escape are untouched the rest of the time.
		let closeHandler = (event) => this._onCloseKey(event);
		if (typeof window.addEventListener === "function") {
			window.addEventListener("keydown", closeHandler, true);
		}

		let listeners = { keydownHandler, itemsTree, closeHandler, window };

		this._addMenuToWindow(window, doc, listeners);

		this._windowListeners.set(window, listeners);
		this.log("Added to window");
	},

	removeFromWindow(window) {
		let listeners = this._windowListeners.get(window);
		if (!listeners) return;

		// Remove keyboard listeners
		listeners.itemsTree.removeEventListener(
			"keydown",
			listeners.keydownHandler,
			true
		);
		if (
			listeners.closeHandler &&
			listeners.window &&
			typeof listeners.window.removeEventListener === "function"
		) {
			listeners.window.removeEventListener(
				"keydown",
				listeners.closeHandler,
				true
			);
		}

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
		// The window is the one thing here that stays open on its own, so
		// its shortcut has a second half: pressed again, it closes it
		{
			pref: "key.contactSheetWindow",
			open: "_openContactSheetInViewer",
			close: "_closeViewer",
		},
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
				let shortcut = zotLookUtil.parseShortcut(raw);
				if (!shortcut) {
					this.log("Unusable shortcut for " + action.pref + ": " + raw);
					return null;
				}
				return Object.assign({}, shortcut, {
					open: action.open,
					close: action.close || null,
				});
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
			if (!this._isActive && !this._pipeShown && !this._sushiShown) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this._closeQuickLook();
			return;
		}

		// A one-file previewer up and the keyboard still in Zotero, which is
		// how QuickLook for Windows runs: left and right walk the files of
		// the press, up and down move the selection and the preview follows
		if (this._pipeShown && !event.ctrlKey && !event.metaKey && !event.altKey) {
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				if (this._previewList.paths.length > 1) {
					event.preventDefault();
					event.stopPropagation();
					this._stepPreviewList(event.key === "ArrowRight" ? 1 : -1);
					return;
				}
			} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				this._followSelection(window);
				return;
			}
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

		// A window an earlier press opened is closed by the same press again
		if (binding.close && this[binding.close]()) return;

		let items = window.ZoteroPane && window.ZoteroPane.getSelectedItems();
		if (items && items.length > 0) {
			this[binding.open](items);
		}
	},

	/**
	 * Closing, caught at the window rather than at the item tree.
	 *
	 * Opening a preview needs the tree's focus, to get in front of its
	 * find-as-you-type; closing one does not, and the press that closes it
	 * often comes from elsewhere — Escape right after a context-menu command
	 * lands on whatever the menu left focused, not on the tree, so a listener
	 * only on the tree never sees it. This one sits on the window, runs
	 * before the tree's (it is the ancestor in the capture phase), and stops
	 * the event only when it actually closes something, so nothing else about
	 * Escape or the shortcuts changes.
	 */
	_onCloseKey(event) {
		if (event.key === "Escape") {
			if (this._isActive || this._pipeShown || this._sushiShown) {
				event.preventDefault();
				event.stopPropagation();
				this._closeQuickLook();
			} else if (this._viewer && this._closeViewer()) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		// The windowed sheet's own shortcut, pressed again to close it. Only
		// a press that closed something is taken: a window the reader shut
		// by hand may still be remembered here for a moment, and the press
		// that finds it gone must go on to the item list, which opens a
		// fresh one — swallowed instead, it took a second press to do so.
		if (this._viewer) {
			let own = this.bindings.find((b) => b.close === "_closeViewer");
			if (own && this._matchesBinding(event, own) && this._closeViewer()) {
				event.preventDefault();
				event.stopPropagation();
			}
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

	/**
	 * A section of the item pane with the three actions as buttons.
	 *
	 * The shortcuts are the quickest way in and the least findable: nothing
	 * in Zotero's window says that Space does anything. Beside the
	 * attachment preview Zotero draws itself, a small section names the
	 * three — preview, sheet, window — for the item shown, and a click
	 * does what the key would. Registered through Zotero's item pane API
	 * where it exists; an older Zotero simply has no section.
	 */
	_registerItemPaneSection() {
		let manager = Zotero.ItemPaneManager;
		if (!manager || typeof manager.registerSection !== "function") return;
		if (this._sectionID) return;
		let icon = this.rootURI + "icon/zotlook-24.svg";
		let actions = [
			{ open: "_openQuickLook",
				label: () => this._string("zotlook-pane-preview", "Preview") },
			{ open: "_openContactSheet",
				label: () => this._string("zotlook-pane-sheet", "Contact sheet") },
			{ open: "_openContactSheetInViewer",
				label: () => this._string("zotlook-pane-window", "Sheet in a window") },
		];
		try {
			this._sectionID = manager.registerSection({
				paneID: "zotlook-actions",
				pluginID: this.id,
				// The header's message carries its text as .label, as Zotero's
				// own sections do: a value there would be written over the
				// section's whole content, buttons and all
				header: { l10nID: "zotlook-pane-header", icon: icon },
				sidenav: { l10nID: "zotlook-pane-sidenav", icon: icon },
				onItemChange: ({ item, setEnabled }) => {
					let shown = false;
					try {
						shown = !!item && (item.isRegularItem() || item.isAttachment());
					} catch (e) {
						shown = false;
					}
					setEnabled(shown);
				},
				onRender: ({ doc, body, item }) => {
					while (body.firstChild) body.removeChild(body.firstChild);
					let row = doc.createElement("div");
					row.className = "zotlook-pane-row";
					row.setAttribute("style", "display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 6px;");
					for (let action of actions) {
						let button = doc.createElement("button");
						button.className = "zotlook-pane-button";
						button.textContent = action.label();
						button.addEventListener("click", (event) => {
							event.preventDefault();
							this[action.open]([item]);
						});
						row.appendChild(button);
					}
					body.appendChild(row);
				},
			});
			this.log("Registered the item pane section");
		} catch (e) {
			this.log("Could not add the item pane section: " + e);
			this._sectionID = null;
		}
	},

	_unregisterItemPaneSection() {
		let manager = Zotero.ItemPaneManager;
		if (!this._sectionID || !manager) return;
		try {
			manager.unregisterSection(this._sectionID);
		} catch (e) {
			this.log("Could not remove the item pane section: " + e);
		}
		this._sectionID = null;
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
		if (!entry.needsPages) return true;
		return this._hasPageable(items);
	},

	/** As defensive as the PDF check beside it, and for the same reason. */
	_isEPUBAttachment(item) {
		try {
			if (
				typeof item.isEPUBAttachment === "function" &&
				item.isEPUBAttachment()
			) {
				return true;
			}
			let name = item.attachmentFilename || "";
			return name.toLowerCase().endsWith(".epub");
		} catch (e) {
			this.log("Could not inspect attachment: " + e);
			return false;
		}
	},

	/**
	 * Whether the selection holds anything a page overview could be made of.
	 *
	 * A PDF, or a book: an EPUB gets a sheet cut at the printed page marks it
	 * carries, and where it carries none it gets a sheet saying so. Which is
	 * why a book counts here even though most books have no pagination — the
	 * menu entry that leads to the explanation must not be the one that is
	 * hidden.
	 *
	 * Deliberately synchronous: this runs while the context menu is opening,
	 * so it interrogates the items rather than resolving file paths.
	 */
	_hasPageable(items) {
		let pageable = (item) =>
			this._isPDFAttachment(item) || this._isEPUBAttachment(item);

		for (let item of items) {
			if (item.isNote()) continue;

			if (item.isAttachment()) {
				if (pageable(item)) return true;
				continue;
			}

			if (typeof item.getAttachments !== "function") continue;
			for (let attID of item.getAttachments(false)) {
				let attachment = Zotero.Items.get(attID);
				if (attachment && pageable(attachment)) return true;
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

			await this._launchPreview(paths, items);
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
	 * preview as it goes. This window does the same — the click hands over
	 * to the reader and the window closes behind it; see
	 * _hookReaderHandoff. What the window offers over the panel is a sheet
	 * that needs no system preview at all and scrolls under the keyboard.
	 * See the comment in zotLookSheet.html for what the target attribute is
	 * doing.
	 */
	async _openContactSheetInViewer(items) {
		return this._withLaunchGuard(() => this._showSheetInViewer(items));
	},

	/** The body of the above, for a caller already inside the guard. */
	async _showSheetInViewer(items) {
		let sheet = await this._buildContactSheet(items);
		if (!sheet) return false;
		let win = null;
		try {
			let uri = PathUtils.toFileURI(sheet);
			// What is in Zotero's search field goes along, as the sheet's
			// first search: the word the library was searched for is the
			// word to find in the document
			let query = this._quickSearchText();
			if (query) uri += "#zl-q=" + encodeURIComponent(query);
			win = Zotero.openInViewer(uri);
		} catch (e) {
			this.log("Could not open the contact sheet in a window: " + e);
			return false;
		}
		this._viewerItemID = this._lastSheetItemID;
		this._viewerItemIDs = this._lastSheetItemIDs.slice();
		this._adoptViewer(win);
		return true;
	},

	/** The text in the main window's quick search, or "". */
	_quickSearchText() {
		try {
			let main = Zotero.getMainWindow && Zotero.getMainWindow();
			let box = /** @type {any} */ (main && main.document && main.document.getElementById("zotero-tb-search"));
			let value = box && (box.value || (box.searchTextbox && box.searchTextbox.value));
			return String(value || "").trim();
		} catch (e) {
			return "";
		}
	},

	/**
	 * Space with no system preview to answer it: the sheet in the window
	 * instead, which needs none and is the fuller of the two anyway. Only
	 * where the previewer is missing outright — Sushi not installed,
	 * QuickLook not running — not on any other refusal, and only for what
	 * a sheet can be made of; the preference turns it off.
	 */
	async _fallbackToWindow(items) {
		if (!this._pref("windowFallback", true)) return false;
		this.log("No system preview to answer; the sheet in a window instead");
		try {
			return await this._showSheetInViewer(items);
		} catch (e) {
			this.log("The window could not stand in either: " + e);
			return false;
		}
	},

	/**
	 * Takes charge of the window the sheet was opened in.
	 *
	 * The window has the keyboard from the moment it opens, so the press
	 * that would close it — its own shortcut again, or Escape — lands here
	 * and not in the item list. Both are answered in the window itself.
	 * Nothing else is: Space scrolls the sheet there, as it does on any
	 * page, and the other shortcuts belong to the item list.
	 */
	_adoptViewer(win) {
		if (!win || win === this._viewer) return;
		this._releaseViewer();
		this._viewer = win;

		// A keydown listener catches the closing press while the sheet is in
		// this same process. The window declares maychangeremoteness, though,
		// so it may load the file in a content process of its own — and then
		// this listener never hears the key. The <key> elements below are
		// heard whatever the process, being chrome-level shortcuts; keeping
		// both means the window closes on its shortcut, on Escape, and on
		// the system preview's own keys — Space and q — whether or not the
		// load went remote.
		let handler = (event) => this._onViewerKeyDown(event);
		this._viewerKeyHandler = handler;
		try {
			win.addEventListener("keydown", handler, true);
			// Only a real close should forget the window. An unload can also
			// arrive while the browser swaps its initial document for the
			// file — and forgetting the window then, but leaving the key
			// listener on it, left the listener firing against a null
			// reference and nothing ever closing. Guarded on win.closed so
			// the swap is ignored and only the close is heeded.
			//
			//
			// Not listened for once only: the swap sends the first unload,
			// and a listener spent on it never heard the close. A window
			// closed by hand — Cmd+W, the red button — sends its unload
			// while closed is still false, and only then goes away; so an
			// unload that finds the window open looks again a moment later,
			// when a closed window says so, or has become a dead wrapper
			// that says nothing at all. Left adopted, the closed window
			// swallowed the next shortcut, which tried to close it instead
			// of opening a fresh one.
			let forget = () => {
				try {
					win.removeEventListener("unload", onUnload);
				} catch (e) {
					// The window is beyond listening
				}
				if (this._viewer !== win) return;
				this._viewer = null;
				this._viewerKeyHandler = null;
				this._viewerItemID = null;
				this._syncReaderHook();
			};
			let onUnload = () => {
				let closed = this._viewerGone(win);
				this.log("Contact sheet window unload (closed=" + closed + ")");
				if (closed) {
					forget();
					return;
				}
				setTimeout(() => {
					if (this._viewerGone(win)) {
						this.log("Contact sheet window gone after its unload");
						forget();
					}
				}, 250);
			};
			win.addEventListener("unload", onUnload);
		} catch (e) {
			this.log("Could not listen to the contact sheet window: " + e);
		}

		// The document may not be built yet when openInViewer returns, so
		// the keys are installed now and again on load; the second is a
		// no-op once the first has taken.
		let install = (loaded) => {
			try {
				if (this._installViewerKeys(win)) {
					this.log("Contact sheet window keys installed");
				}
			} catch (e) {
				this.log("Could not add the contact sheet window's keys: " + e);
			}
			try {
				this._showViewerLoading(win);
			} catch (e) {
				this.log("Could not put up the loading hint: " + e);
			}
			if (loaded) {
				try {
					this._rememberViewerSize(win);
				} catch (e) {
					this.log("Could not size the contact sheet window: " + e);
				}
			}
			this._focusViewerContent(win);
		};
		install(false);
		try {
			win.addEventListener("load", () => install(true), { once: true });
		} catch (e) {
			// The window is already gone
		}
		this._syncReaderHook();
		this.log("Adopted the contact sheet window");
	},

	/**
	 * Closes the window once a click in it has done its work.
	 *
	 * The click itself cannot be listened for: the sheet may load in a
	 * content process of its own, where no chrome listener hears it. What
	 * every click ends in, from whichever process it started, is
	 * Zotero.Reader.open — so that is what is watched, for exactly as long
	 * as the window lives. Whether an opening came from this window is
	 * decided by who held the keyboard as the call began: the click that
	 * caused it focused the window first, and a reader opened from anywhere
	 * else finds the focus elsewhere and leaves the sheet alone.
	 */
	_hookReaderHandoff() {
		if (this._readerOpenOriginal) return;
		if (!Zotero.Reader || typeof Zotero.Reader.open !== "function") {
			this.log("No Zotero.Reader to watch; the window stays on click");
			return;
		}
		let plugin = this;
		let original = Zotero.Reader.open;
		this._readerOpenOriginal = original;
		this._readerOpenPatched = async function (...args) {
			// Two ways to know the window is the one handing over, because
			// the first alone was not enough. Asking who has the keyboard
			// reads the click that caused this — but the sheet's page links
			// carry target="_blank", and the window Gecko makes for that
			// takes the focus before the reader is asked for, so the answer
			// came back false exactly when it mattered. The item decides
			// instead: the sheet knows which attachment it was drawn from,
			// and its links lead to that one and nothing else.
			let fromViewer = false;
			if (plugin._viewer) {
				let opened = args.length ? args[0] : null;
				if (
					(plugin._viewerItemID !== null && opened === plugin._viewerItemID) ||
					plugin._viewerItemIDs.indexOf(opened) !== -1
				) {
					fromViewer = true;
				} else {
					try {
						fromViewer = !!(
							plugin._viewer.document &&
							plugin._viewer.document.hasFocus()
						);
					} catch (e) {
						// A window that cannot answer is not this window
					}
				}
			}
			// The system preview cannot be asked who has the keyboard — it
			// is another application, and a click in it never focuses a
			// Zotero window. But it shows one file, or a sheet whose only
			// links open the reader, so a reader opening while it is up is
			// that handoff: close it behind the reader, the same as the
			// window. Read before the open, in case it clears the flag.
			let pipeUp = plugin._pipeShown;
			let sushiUp = plugin._sushiShown;
			let result = await original.apply(this, args);
			if (fromViewer) {
				plugin.log(
					"Reader opened from the contact sheet window; handing over"
				);
				plugin._closeViewer();
			}
			if (pipeUp || sushiUp) {
				plugin.log(
					"Reader opened while the preview was up; closing it behind the handoff"
				);
				if (pipeUp) plugin._dismissPipePreview();
				if (sushiUp) plugin._dismissSushiPreview();
			}
			return result;
		};
		Zotero.Reader.open = this._readerOpenPatched;
	},

	/**
	 * Keeps the reader-open watch in place for exactly as long as some
	 * preview it would close is up — the window, the system panel, or Sushi —
	 * and lifts it once none is, so nothing else's reader opens are wrapped.
	 */
	_syncReaderHook() {
		if (this._viewer || this._pipeShown || this._sushiShown) {
			this._hookReaderHandoff();
		} else {
			this._unhookReaderHandoff();
		}
	},

	_unhookReaderHandoff() {
		if (!this._readerOpenOriginal) return;
		// Only our own wrapper is ours to remove: another plugin may have
		// wrapped on top of it since, and restoring would wipe their patch.
		if (Zotero.Reader && Zotero.Reader.open === this._readerOpenPatched) {
			Zotero.Reader.open = this._readerOpenOriginal;
		}
		this._readerOpenOriginal = null;
		this._readerOpenPatched = null;
	},

	_onViewerKeyDown(event) {
		let own = this.bindings.find((b) => b.close === "_closeViewer");
		let closes =
			event.key === "Escape" ||
			(own && this._matchesBinding(event, own)) ||
			this._isViewerCloseKey(event);
		if (!closes) return;
		event.preventDefault();
		event.stopPropagation();
		this.log(
			"Closing the contact sheet window from a key in it (viewer=" +
				!!this._viewer + ")"
		);
		this._closeViewer();
	},

	/**
	 * Puts the keyboard into the sheet itself.
	 *
	 * The window opens with its focus nowhere in particular, and a page
	 * without the keyboard answers no key: arrows and the Page keys scrolled
	 * nothing while the wheel — which needs no focus — worked. Focused when
	 * the window is adopted and again when its load lands, because the
	 * browser may not exist yet the first time.
	 */
	_focusViewerContent(win) {
		try {
			let browser =
				win.document && typeof win.document.querySelector === "function"
					? win.document.querySelector("browser")
					: null;
			if (browser && typeof browser.focus === "function") {
				browser.focus();
				return true;
			}
		} catch (e) {
			this.log("Could not focus the contact sheet window: " + e);
		}
		return false;
	},

	/**
	 * The keys the system preview answers, answered here too.
	 *
	 * Sushi and QuickLook both close on a bare Space and on q, and this
	 * window stands where they stand — a reader who has learnt the preview's
	 * reflexes should not need a second set for the window that replaces it.
	 * Bare presses only: a modifier means the press is someone else's, and a
	 * field that takes typing keeps its letters.
	 */
	_isViewerCloseKey(event) {
		if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
			return false;
		}
		let target = event.target;
		if (
			target &&
			(target.isContentEditable ||
				/^(input|textarea|select)$/i.test(target.tagName || ""))
		) {
			return false;
		}
		return event.code === "Space" || (event.key || "").toLowerCase() === "q";
	},

	/**
	 * Adds Escape and the windowed sheet's own shortcut to the viewer window
	 * as chrome-level <key>s, both firing the window's existing cmd_close
	 * (window.close()). This is what closes the window when the file loaded
	 * into a content process of its own, where a plain keydown listener is
	 * never reached.
	 *
	 * @returns {boolean} whether the keys are in place
	 */
	_installViewerKeys(win) {
		let doc = win.document;
		if (!doc || !doc.documentElement) return false;
		if (doc.getElementById("zotlook-viewer-keys")) return true;
		if (typeof doc.createXULElement !== "function") return false;

		let keyset = doc.createXULElement("keyset");
		keyset.id = "zotlook-viewer-keys";

		let addKey = (attrs) => {
			let key = doc.createXULElement("key");
			for (let name in attrs) {
				if (attrs[name] != null) key.setAttribute(name, attrs[name]);
			}
			// The window's own close command, defined in basicViewer.xhtml
			key.setAttribute("command", "cmd_close");
			keyset.appendChild(key);
		};

		addKey({ keycode: "VK_ESCAPE" });
		let own = this.bindings.find((b) => b.close === "_closeViewer");
		if (own) addKey(this._xulKeyAttrs(own));
		// The system preview's own keys — see _isViewerCloseKey. No
		// modifiers attribute means the bare key, and only the bare key.
		addKey({ keycode: "VK_SPACE" });
		addKey({ key: "q" });

		doc.documentElement.appendChild(keyset);
		return true;
	},

	/**
	 * The window's size, kept from one sheet to the next.
	 *
	 * Zotero's viewer sizes itself to its content on every load, which for
	 * a window holding nothing but a browser is its minimum, so a window
	 * the reader had pulled larger came back small the next time. Now the
	 * size it was last left at is written to the preferences as it changes
	 * and put back on the load. The viewer's own sizing runs from the
	 * window's onload attribute, which Gecko fires after the listeners a
	 * script added — so ours must wait a tick, or be undone by it; the tick
	 * is still ahead of the first paint. The place is the viewer's own
	 * business; it keeps that itself.
	 */
	_rememberViewerSize(win) {
		if (typeof win.resizeTo !== "function" || typeof win.addEventListener !== "function") {
			return false;
		}
		let width = Number(this._pref("windowWidth", 0)) || 0;
		let height = Number(this._pref("windowHeight", 0)) || 0;
		setTimeout(() => {
			if (this._viewerGone(win)) return;
			if (width >= 400 && height >= 300) {
				try {
					win.resizeTo(width, height);
					this.log("Contact sheet window sized to " + width + "×" + height);
				} catch (e) {
					this.log("Could not size the contact sheet window: " + e);
				}
			}
			// Only from here on is a resize the reader's doing
			win.addEventListener("resize", () => {
				let w = Number(win.outerWidth) || 0;
				let h = Number(win.outerHeight) || 0;
				if (w < 400 || h < 300) return;
				try {
					Zotero.Prefs.set(this.PREF_BRANCH + "windowWidth", w, true);
					Zotero.Prefs.set(this.PREF_BRANCH + "windowHeight", h, true);
				} catch (e) {
					this.log("Could not keep the contact sheet window's size: " + e);
				}
			});
		}, 0);
		return true;
	},

	/**
	 * A word over the window while the sheet is still on its way.
	 *
	 * The window is up before its browser has the file: for a moment it
	 * stands empty, and on a sheet of many pages the moment is long enough
	 * to look like nothing happening. So a line is laid over the browser —
	 * in the window's own document, which is ours whatever process the
	 * file loads in — and taken away when the browser reports the sheet's
	 * title, the first thing a loading page announces. The title of the
	 * blank the browser starts with is not that report. A window that never
	 * reports is cleared after a while, and a released window at once.
	 */
	_showViewerLoading(win) {
		let doc = win.document;
		if (!doc || !doc.documentElement) return false;
		if (doc.getElementById("zotlook-viewer-loading")) return true;
		if (typeof doc.createElementNS !== "function") return false;
		let browser =
			typeof doc.querySelector === "function" ? doc.querySelector("browser") : null;
		if (!browser || typeof browser.addEventListener !== "function") return false;

		const XHTML = "http://www.w3.org/1999/xhtml";
		let dark = false;
		try {
			dark = !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches);
		} catch (e) {
			dark = false;
		}
		let hint = doc.createElementNS(XHTML, "div");
		hint.id = "zotlook-viewer-loading";
		hint.setAttribute(
			"style",
			"position: fixed; inset: 0; z-index: 10; display: flex;" +
				" align-items: center; justify-content: center;" +
				(dark ? " background: #1c1f24; color: #b8bcc2;" : " background: #f4f4f4; color: #4a4a4a;") +
				" font: 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;" +
				" pointer-events: none;"
		);
		hint.textContent = this._string(
			"zotlook-sheet-loading",
			"Laying out the contact sheet…"
		);
		doc.documentElement.appendChild(hint);

		let clear = () => {
			try {
				browser.removeEventListener("pagetitlechanged", onTitle);
			} catch (e) {
				// Already gone
			}
			if (timer !== null) clearTimeout(timer);
			timer = null;
			try {
				hint.remove();
			} catch (e) {
				// Likewise
			}
		};
		let onTitle = () => {
			let spec = "";
			try {
				spec = String(browser.currentURI && browser.currentURI.spec);
			} catch (e) {
				spec = "";
			}
			if (spec.indexOf("about:") === 0) return;
			clear();
		};
		let timer = setTimeout(clear, 8000);
		browser.addEventListener("pagetitlechanged", onTitle);
		this._viewerLoadingClear = clear;
		return true;
	},

	/**
	 * A shortcut binding as the attributes of a XUL <key>. Space is named by
	 * its key code, which sits in the same place on every layout; a letter or
	 * digit by the character it produces, as elsewhere in this plugin.
	 */
	_xulKeyAttrs(b) {
		let mods = [];
		if (b.ctrl) mods.push("control");
		if (b.alt) mods.push("alt");
		if (b.shift) mods.push("shift");
		if (b.meta) mods.push("meta");
		let attrs = { modifiers: mods.join(",") };
		if (b.code === "Space") attrs.keycode = "VK_SPACE";
		else if (b.code && b.code.indexOf("Key") === 0) {
			attrs.key = b.code.slice(3).toLowerCase();
		} else if (b.code && b.code.indexOf("Digit") === 0) {
			attrs.key = b.code.slice(5);
		} else if (b.key) attrs.key = b.key;
		else if (b.code) attrs.keycode = "VK_" + b.code.toUpperCase();
		return attrs;
	},

	/**
	 * Closes the sheet's window if one is open.
	 * @returns {boolean} whether there was one to close
	 */
	_closeViewer() {
		let win = this._viewer;
		if (!win) return false;
		let alreadyClosed = this._viewerGone(win);
		this._releaseViewer();
		// A window the user already closed by hand is not ours to close
		// again — and saying so lets the caller open a fresh one rather
		// than swallow the press.
		if (alreadyClosed) return false;
		// close() called on the reference openInViewer hands back is a
		// silent no-op here — the key handler fires, close() is reached, and
		// the window stays. The window's own cmd_close runs window.close() in
		// the window's own scope, which is the path Ctrl+W takes and the one
		// that actually closes it. close() stays as the fallback.
		let how = "none";
		try {
			let cmd =
				win.document && win.document.getElementById("cmd_close");
			if (cmd && typeof cmd.doCommand === "function") {
				cmd.doCommand();
				how = "command";
			} else if (typeof win.close === "function") {
				win.close();
				how = "close";
			}
		} catch (e) {
			this.log("Could not close the contact sheet window: " + e);
			try {
				win.close();
				how = "close-fallback";
			} catch (e2) {
				// Nothing more to try
			}
		}
		this.log("Closed the contact sheet window (" + how + ")");
		return true;
	},

	/**
	 * Whether the window is no longer there.
	 *
	 * A closed window says so through `closed` — for as long as it can be
	 * asked. Once Gecko has torn it down, the reference the plugin holds is
	 * a dead wrapper, and reading anything from it throws; that is the
	 * surest sign of all that the window is gone, and was once taken for
	 * the opposite.
	 */
	_viewerGone(win) {
		if (!win) return true;
		try {
			let cu = typeof Components !== "undefined" && Components.utils;
			if (cu && typeof cu.isDeadWrapper === "function" && cu.isDeadWrapper(win)) {
				return true;
			}
			return !!win.closed;
		} catch (e) {
			return true;
		}
	},

	/** Forgets the window without closing it: neither the listener nor the
	 *  injected keys must outlive the plugin, the window may. */
	_releaseViewer() {
		let win = this._viewer;
		if (this._viewerLoadingClear) {
			this._viewerLoadingClear();
			this._viewerLoadingClear = null;
		}
		if (win) {
			if (this._viewerKeyHandler) {
				try {
					win.removeEventListener(
						"keydown",
						this._viewerKeyHandler,
						true
					);
				} catch (e) {
					// The window is already gone
				}
			}
			try {
				let keyset =
					win.document &&
					win.document.getElementById("zotlook-viewer-keys");
				if (keyset) keyset.remove();
			} catch (e) {
				// Likewise
			}
		}
		this._viewer = null;
		this._viewerKeyHandler = null;
		this._viewerItemID = null;
		this._syncReaderHook();
	},

	/**
	 * Renders the contact sheet and returns the path to its HTML, or null.
	 */
	async _buildContactSheet(items) {
		// Several items at once are a collection to look over, not one
		// document to leaf through
		let regular = (items || []).filter((item) => {
			try {
				return !item.isNote() && !item.isAttachment();
			} catch (e) {
				return false;
			}
		});
		if (regular.length > 1) return this._buildCollectionSheet(regular);

		// Resolve to an attachment item rather than a bare path: the reader
		// links in the sheet need the item's key and library
		let chosen = await this._pickPdfAttachment(items);
		if (!chosen) {
			// No PDF, but a book may still be worth leafing through: an EPUB
			// published beside a print edition carries that edition's
			// pagination, and a sheet can be cut at it. One that carries none
			// gets a sheet saying so, which is why this returns rather than
			// falling through.
			let book = await this._pickEpubAttachment(items);
			if (book) {
				this._lastSheetItemID = book.item ? book.item.id : null;
				this._lastSheetItemIDs = [];
				return this._epubSheet(book.path, book.item);
			}
			this.log("No PDF or EPUB files for contact sheet");
			return null;
		}

		if (!this._contactSheetSupported()) {
			this.log("No page renderer is available on this platform");
			return null;
		}

		// Render the annotated copy where there is one: on a sheet of every
		// page, the marked-up ones are exactly what makes it worth scanning.
		let pdfPath = (await this._annotatedCopy(chosen.item)) || chosen.path;

		let maxColumns = this._contactSheetColumns();
		let maxPages = this._maxContactSheetPages();
		let showToc = this._pref("contactSheetContents", true);
		let showAnnotations = this._pref("contactSheetAnnotations", true);

		// Named after the source rather than after what is rendered, so the
		// sheet keeps one name whether or not annotations were drawn in, and
		// a second sheet does not overwrite one still open in QuickLook
		let sheetName =
			"contactsheet_" +
			zotLookUtil.safeName(PathUtils.filename(chosen.path), 60);

		let keep = this._keepPreviews();
		let entry = await this._derivedEntry(sheetName, keep);
		let outputPath = PathUtils.join(entry.dir, sheetName + ".html");
		let imageDirName = sheetName + "_pages";
		let imageDir = PathUtils.join(entry.dir, imageDirName);

		// What would make a kept sheet the wrong answer: the file itself, the
		// annotations — the sheet renders the exported copy, not the stored
		// file — and the settings that shape the output, since a sheet drawn
		// in five columns is not the sheet the reader asked for in three.
		// The annotations menu lists them whether or not they are drawn, so
		// it counts them on its own account.
		let key = keep
			? [
				this._tag(),
				chosen.path,
				await this._fileIdentity(chosen.path),
				this._annotationKeyPart(chosen.item),
				maxColumns,
				maxPages,
				showToc ? "contents" : "no-contents",
				showAnnotations
					? "list:" + (this._annotationSignature(chosen.item) || "none")
					: "no-list",
			].join("|")
			: null;

		this._lastSheetItemID = chosen.item ? chosen.item.id : null;
		this._lastSheetItemIDs = [];

		let kept = await this._derivedHit(entry, key, sheetName + ".html");
		if (kept) {
			this.log("Reusing the contact sheet built earlier: " + kept);
			return kept;
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
				zotLookSheet.html({
					pages: manifest.pages,
					columns: manifest.columns,
					width: manifest.width,
					imageDir: imageDirName,
					pageCount: manifest.pageCount,
					linkBase: this._readerLink(chosen.item),
					notice: notice,
					toc: showToc ? manifest.outline || [] : [],
					annotations: showAnnotations
						? this._pdfAnnotations(chosen.item)
						: [],
				})
			);

			// Written last, and only now: a key beside a sheet that was never
			// finished would hand back a half-built one for ever after.
			await this._derivedCommit(entry, key);
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
	 * The collection sheet: the first page of every selected item's PDF,
	 * one tile each, the title and creators under it.
	 *
	 * What the page sheet is to a document, this is to a selection: the
	 * documents at a glance, a click opening one in the reader, the
	 * keyboard walking them, the search finding one by title, author or
	 * first page. An item whose best attachment is not a PDF gets a tile
	 * without a page, so the selection is complete on the sheet even where
	 * it cannot be pictured.
	 *
	 * Kept like a page sheet, under a name made of the items' keys, and
	 * remade when one of the files changes or the columns do.
	 */
	async _buildCollectionSheet(items) {
		if (!this._contactSheetSupported()) {
			this.log("No page renderer is available on this platform");
			return null;
		}
		let maxColumns = this._contactSheetColumns();
		let entries = [];
		for (let item of items) {
			let best = null;
			try {
				best = await this._pickBestAttachment(item);
			} catch (e) {
				this.log("Could not resolve an attachment: " + e);
			}
			let pdf = best && this._isPDFAttachment(best.item) ? best : null;
			entries.push({ item: item, pdf: pdf });
		}
		let keys = items.map((item) => String(item.key || item.id));
		let sheetName = "collectionsheet_" + zotLookUtil.hashString(keys.join(","));
		let keep = this._keepPreviews();
		let entry = await this._derivedEntry(sheetName, keep);
		let outputPath = PathUtils.join(entry.dir, sheetName + ".html");
		let imageDirName = sheetName + "_pages";
		let imageDir = PathUtils.join(entry.dir, imageDirName);

		let parts = [this._tag(), keys.join(","), maxColumns];
		for (let e of entries) {
			if (!e.pdf) {
				parts.push("-");
				continue;
			}
			parts.push(e.pdf.path, await this._fileIdentity(e.pdf.path));
		}
		let key = keep ? parts.join("|") : null;

		this._lastSheetItemID = null;
		this._lastSheetItemIDs = entries
			.filter((e) => e.pdf && e.pdf.item)
			.map((e) => e.pdf.item.id);

		let kept = await this._derivedHit(entry, key, sheetName + ".html");
		if (kept) {
			this.log("Reusing the collection sheet built earlier: " + kept);
			return kept;
		}

		this.log("Generating a collection sheet for " + items.length + " items");
		let started = Date.now();
		let progress = this._showProgress(
			this._string("zotlook-progress-collection", "Laying out the collection…")
		);
		try {
			await IOUtils.remove(imageDir, { recursive: true, ignoreAbsent: true });
			await IOUtils.makeDirectory(imageDir, { ignoreExisting: true });
			let columns = zotLookSheet.columnsFor(entries.length, maxColumns);
			let width = zotLookSheet.widthFor(entries.length, maxColumns);
			let tiles = [];
			let index = 0;
			for (let e of entries) {
				index++;
				let tile = {
					index: index,
					title: this._itemTitle(e.item),
					meta: this._itemMeta(e.item),
					link: e.pdf ? this._readerLink(e.pdf.item) : this._selectLink(e.item),
				};
				if (e.pdf) {
					let dir = PathUtils.join(imageDir, String(index));
					await IOUtils.makeDirectory(dir, { ignoreExisting: true });
					let manifest = await this._renderPagesWithPdfjs(
						e.pdf.path, dir, maxColumns, 1, null, { width: width });
					let first = manifest && manifest.pages[0];
					if (first) {
						tile.image = imageDirName + "/" + index + "/p" + first.page + ".jpg";
						tile.height = first.height;
						tile.text = first.text || "";
					}
				}
				tiles.push(tile);
				this._setProgress(progress, index, entries.length);
			}
			this.log("Laid out " + tiles.length + " items in " + (Date.now() - started) + " ms");
			await IOUtils.writeUTF8(
				outputPath,
				zotLookSheet.collectionHtml({ tiles: tiles, columns: columns, width: width })
			);
			await this._derivedCommit(entry, key);
		} catch (e) {
			this.log("Collection sheet generation error: " + e);
			await this._writeFailureReport("the collection sheet threw: " + e);
			return null;
		} finally {
			this._closeProgress(progress);
		}
		return outputPath;
	},

	/** An item's title, for a tile's caption. */
	_itemTitle(item) {
		try {
			if (typeof item.getDisplayTitle === "function") return String(item.getDisplayTitle() || "");
			if (typeof item.getField === "function") return String(item.getField("title") || "");
		} catch (e) {
			// fall through
		}
		return "";
	},

	/** "Creator, Year" under a tile, whichever of the two the item has. */
	_itemMeta(item) {
		let parts = [];
		try {
			let creator = typeof item.firstCreator === "string" ? item.firstCreator : "";
			if (!creator && typeof item.getField === "function") creator = String(item.getField("firstCreator") || "");
			if (creator) parts.push(creator);
			let year = typeof item.getField === "function" ? String(item.getField("year") || "") : "";
			if (year) parts.push(year);
		} catch (e) {
			// a caption is not worth failing over
		}
		return parts.join(", ");
	},

	/** A zotero://select URL for an item, for a tile with no page to open. */
	_selectLink(item) {
		if (!item || !item.key) return "";
		try {
			let library = /** @type {any} */ (Zotero.Libraries.get(item.libraryID));
			if (library && library.isGroup) {
				return "zotero://select/groups/" + library.groupID + "/items/" + item.key;
			}
		} catch (e) {
			// the library alone
		}
		return "zotero://select/library/items/" + item.key;
	},

	// ── Derived files ─────────────────────────────────────────────────
	//
	// Three things here are made from an attachment and cost real time to
	// make: the contact sheet, the EPUB preview, and the copy of a PDF with
	// the annotations drawn in. Each had grown its own answer to the same two
	// questions — is this still the right file, and when does it go away —
	// and only one of the three answered them on disk. The other two answered
	// in a Map, which a restart forgets, so the work was done again on the
	// first press of every session.
	//
	// One store answers both questions for all three. An entry is a directory
	// holding whatever that kind of artefact consists of, plus a `.key` file
	// naming what it was made from. Written last and only on success, so a
	// half-built entry cannot be taken for a finished one; rewritten on every
	// hit, so its date means "last used" rather than "built".
	//
	// A directory per entry rather than files side by side is what makes the
	// clearing below general: it removes an entry without knowing whether
	// that entry is a sheet with its thumbnails or an unpacked book.

	/**
	 * Where entries live.
	 *
	 * The working directory is in the system's temp area and is emptied on
	 * startup and on shutdown — nothing there outlives the session, and
	 * nothing there is meant to.
	 *
	 * Kept entries must outlive it, and beside the working directory —
	 * where they first lived — they could not: that put them inside
	 * Zotero's own temp directory, and Zotero registers a shutdown blocker
	 * ("Removing temp directory") that deletes that whole directory at
	 * every exit. Kept sheets were gone at the next start on every
	 * platform, and the settings pane truthfully reported 0 B. They live
	 * in the local profile directory instead — AppData\Local on Windows,
	 * ~/Library/Caches on macOS — which is per-profile, survives
	 * restarts, is cleared by nobody else, and is still not backed up
	 * with the library.
	 */
	_derivedRoot(keep) {
		if (!keep) return this._getTempDirPath();
		if (!this._keptRoot) {
			this._keptRoot = PathUtils.join(
				this._cacheBase(),
				"zotLook-cache"
			);
		}
		return this._keptRoot;
	},

	/**
	 * The directory the kept entries' store may build on. The local
	 * profile directory, with Zotero's temp directory as the fallback —
	 * a copy that cannot look things up in dirsvc keeps working, it
	 * merely goes back to forgetting its previews at shutdown.
	 */
	_cacheBase() {
		try {
			return Services.dirsvc.get(
				"ProfLD",
				Components.interfaces.nsIFile
			).path;
		} catch (e) {
			this.log(
				"No local profile directory; kept previews will not " +
					"survive a restart: " + e
			);
			return Zotero.getTempDirectory().path;
		}
	},

	/**
	 * The entry for one derived artefact.
	 *
	 * @param {string} name Stable per source, not per version of it — a
	 *   changed file overwrites its own entry instead of leaving the old one
	 *   behind to be aged out.
	 * @param {boolean} keep Whether it may outlive the session.
	 */
	async _derivedEntry(name, keep) {
		let dir = PathUtils.join(this._derivedRoot(keep), name);
		await IOUtils.makeDirectory(dir, {
			ignoreExisting: true,
			createAncestors: true,
		});
		return { dir, keyPath: PathUtils.join(dir, ".key"), keep };
	},

	/**
	 * Whether this entry already holds the answer, and touching it if so.
	 *
	 * @returns {Promise<string|null>} the artefact's path, or null
	 */
	async _derivedHit(entry, key, fileName) {
		if (!key) return null;
		let file = PathUtils.join(entry.dir, fileName);
		try {
			if ((await IOUtils.readUTF8(entry.keyPath)) !== key) return null;
			if (!(await IOUtils.exists(file))) return null;
		} catch (e) {
			return null; // no key file, or unreadable
		}
		try {
			// Rewritten rather than merely read, so the modification time
			// records the use. The age-based clearing goes by exactly this.
			await IOUtils.writeUTF8(entry.keyPath, key);
		} catch (e) {
			// Not worth failing a hit over
		}
		return file;
	},

	/** Marks an entry finished. Called last, and only when it really is. */
	async _derivedCommit(entry, key) {
		if (!key) return;
		try {
			await IOUtils.writeUTF8(entry.keyPath, key);
		} catch (e) {
			this.log("Could not record a derived file: " + e);
		}
	},

	/**
	 * The annotations, as they appear in a key.
	 *
	 * "off" and "none" are different answers and must stay so: with the
	 * setting off the stored file is used, with it on but nothing annotated
	 * the stored file is used as well — but turning the setting back on has
	 * to invalidate what was made while it was off.
	 */
	_annotationKeyPart(item, pref) {
		return this._pref(pref || "previewAnnotations", true)
			? this._annotationSignature(item) || "none"
			: "off";
	},

	/**
	 * How a file is recognised again: size and modification time rather than
	 * a digest of the contents. Reading a hundred megabytes to decide whether
	 * to skip seven seconds of work can cost more than it saves, and Zotero
	 * rewrites an attachment rather than editing it in place, so the
	 * modification time moves exactly when it matters.
	 */
	async _fileIdentity(path) {
		try {
			let stat = await IOUtils.stat(path);
			return stat.size + "@" + Number(stat.lastModified);
		} catch (e) {
			return null;
		}
	},

	/**
	 * Carries settings across the two renames of 1.2.0.
	 *
	 * The names described the contact sheet alone while they governed the
	 * EPUB preview as well. Renaming them silently would have reset both to
	 * their defaults for everyone who had ever changed them, so the old value
	 * is copied once — only when the user really set it, and only when the
	 * new name has not been set already.
	 */
	_carryOverRenamedPrefs() {
		let branch = Zotero.Prefs.rootBranch;
		if (!branch || typeof branch.prefHasUserValue !== "function") return;
		for (let [from, to] of [
			["cacheContactSheet", "keepPreviews"],
			["contactSheetKeepDays", "previewKeepDays"],
			// Not a rename but a split: until 1.2.0 one switch governed the
			// annotations of both formats. Someone who had turned it off
			// meant both, and should not find the EPUB half back on.
			["previewAnnotations", "epubAnnotations"],
		]) {
			try {
				if (!branch.prefHasUserValue(this.PREF_BRANCH + from)) continue;
				if (branch.prefHasUserValue(this.PREF_BRANCH + to)) continue;
				let value = Zotero.Prefs.get(this.PREF_BRANCH + from, true);
				if (value === undefined) continue;
				Zotero.Prefs.set(this.PREF_BRANCH + to, value, true);
				this.log("Carried " + from + " over to " + to);
			} catch (e) {
				this.log("Could not carry " + from + " over: " + e);
			}
		}
	},

	/**
	 * Which build this is: the version, and the stamp build.sh wrote into the
	 * package beside it.
	 *
	 * The version alone answers "is this the same release", which is what a
	 * user needs. It does not answer "is this the same build", which is what
	 * anyone working on a version needs — two builds of 1.2.0 are alike to
	 * it, and a preview made by the first would be handed back by the second.
	 * A source tree with no stamp falls back to the version, and behaves as
	 * it always did.
	 */
	async _readBuildTag() {
		if (this._buildTag) return this._buildTag;
		this._buildTag = this.version;
		try {
			let response = await fetch(this.rootURI + "build.txt");
			let stamp = (await response.text()).trim();
			if (stamp) this._buildTag = this.version + "+" + stamp;
		} catch (e) {
			this.log("No build stamp; keying on the version alone");
		}
		return this._buildTag;
	},

	/** The first field of every key. */
	_tag() {
		return this._buildTag || this.version;
	},

	/**
	 * Throws away what this build did not make.
	 *
	 * Two things collect here otherwise. A new version lays its output out
	 * differently — 1.1.9 kept a sheet as a handful of files side by side,
	 * where an entry is a directory now — and the older shape is invisible to
	 * everything that reads this place, so nothing would ever remove it. And
	 * an entry from an earlier build answers a question this build would
	 * answer differently.
	 *
	 * Both go at startup rather than waiting for the age to run out, because
	 * neither will ever be the right answer again.
	 */
	async _dropStaleEntries() {
		let root = this._derivedRoot(true);
		let children;
		try {
			children = await IOUtils.getChildren(root);
		} catch (e) {
			return { count: 0 };
		}

		let tag = this._tag();
		let count = 0;
		for (let child of children) {
			let stat;
			try {
				stat = await IOUtils.stat(child);
			} catch (e) {
				continue;
			}

			if (stat.type !== "directory") {
				// A loose file is the layout of an earlier version
				try {
					await IOUtils.remove(child, { ignoreAbsent: true });
					count++;
				} catch (e) {
					this.log("Could not remove " + child + ": " + e);
				}
				continue;
			}

			let keyPath = PathUtils.join(child, ".key");
			let key = null;
			try {
				key = await IOUtils.readUTF8(keyPath);
			} catch (e) {
				// No key: either the old layout's image directory, or an
				// entry whose making was cut short. Neither is ever finished.
			}
			if (key !== null && key.startsWith(tag + "|")) continue;

			if (await this._dropEntry({ dir: child, keyPath })) count++;
		}

		if (count) this.log("Removed " + count + " entries of earlier builds");
		return { count };
	},

	/** Whether derived files may outlive the session. */
	_keepPreviews() {
		return this._pref("keepPreviews", true);
	},

	/**
	 * How long a kept entry may go unused. Zero keeps them until the system
	 * clears its temp area — which macOS and Linux do on their own, and
	 * Windows rarely.
	 */
	_keepDays() {
		let value = Number(this._pref("previewKeepDays", 30));
		if (!Number.isFinite(value) || value < 0) return 30;
		return Math.floor(value);
	},

	/** Everything under a directory, in bytes. */
	async _dirSize(path) {
		let total = 0;
		let children;
		try {
			children = await IOUtils.getChildren(path);
		} catch (e) {
			return 0;
		}
		for (let child of children) {
			let stat;
			try {
				stat = await IOUtils.stat(child);
			} catch (e) {
				continue;
			}
			if (stat.type === "directory") total += await this._dirSize(child);
			else total += stat.size || 0;
		}
		return total;
	},

	/**
	 * The kept entries, as {dir, key, bytes, used}.
	 *
	 * A directory without a `.key` is a half-written one and is not counted:
	 * the key is what says the work finished.
	 */
	async _keptEntries() {
		let out = [];
		let children;
		try {
			children = await IOUtils.getChildren(this._derivedRoot(true));
		} catch (e) {
			return out;
		}
		for (let dir of children) {
			let keyPath = PathUtils.join(dir, ".key");
			let used;
			try {
				used = Number((await IOUtils.stat(keyPath)).lastModified) || 0;
			} catch (e) {
				continue;
			}
			out.push({
				dir,
				keyPath,
				used,
				bytes: await this._dirSize(dir),
			});
		}
		return out;
	},

	/** What the kept entries occupy, in bytes. */
	async _keptSize() {
		let total = 0;
		for (let entry of await this._keptEntries()) total += entry.bytes;
		return total;
	},

	/** Throws one entry away, its key first so a half-removed one is never
	 *  mistaken for a finished one. */
	async _dropEntry(entry) {
		try {
			await IOUtils.remove(entry.keyPath, { ignoreAbsent: true });
			await this._removeTree(entry.dir);
			return true;
		} catch (e) {
			this.log("Could not remove a kept preview: " + e);
			return false;
		}
	},

	/**
	 * Removes a directory tree, read-only files included.
	 *
	 * Zotero's zip reader extracts an entry with the permissions the archive
	 * recorded, and the assets of an EPUB are commonly stored read-only. On
	 * Windows that attribute makes the file undeletable, IOUtils.remove then
	 * reports the directory as not empty, and the entry — its key already
	 * gone — stays for good: uncounted, uncleared by age, and untouched by
	 * the button that promises to clear it. The write bit is put back
	 * before a second attempt, which is what an `rm -rf` does on its own.
	 */
	async _removeTree(dir) {
		try {
			await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
			return;
		} catch (e) {
			// Retried below with the files made writable
		}
		await this._makeWritable(dir);
		await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
	},

	async _makeWritable(dir) {
		let children;
		try {
			children = await IOUtils.getChildren(dir);
		} catch (e) {
			return;
		}
		for (let child of children) {
			let stat;
			try {
				stat = await IOUtils.stat(child);
			} catch (e) {
				continue;
			}
			if (stat.type === "directory") {
				await this._makeWritable(child);
				continue;
			}
			try {
				await IOUtils.setPermissions(child, 0o666);
			} catch (e) {
				// Then the removal below will say so
			}
		}
	},

	/** Every kept entry. Returns how many went and what they occupied. */
	async _purgeKept() {
		let bytes = 0;
		let count = 0;
		for (let entry of await this._keptEntries()) {
			if (await this._dropEntry(entry)) {
				bytes += entry.bytes;
				count++;
			}
		}
		if (count) this.log("Removed " + count + " kept previews");
		return { count, bytes };
	},

	/**
	 * The ones nobody has looked at for a while.
	 *
	 * By last use rather than by age: a book opened every week should stay,
	 * and one opened once in March should not.
	 *
	 * Run at startup rather than on a timer. A directory listing costs
	 * nothing, and a clearing that happened while the user was working would
	 * make the same preview appear at once one moment and not the next.
	 */
	async _expireKept() {
		let days = this._keepDays();
		if (!days) return { count: 0, bytes: 0 };

		let cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		let bytes = 0;
		let count = 0;
		for (let entry of await this._keptEntries()) {
			if (entry.used >= cutoff) continue;
			if (await this._dropEntry(entry)) {
				bytes += entry.bytes;
				count++;
			}
		}
		if (count) {
			this.log("Removed " + count + " previews unused for " + days +
				" days");
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
		onProgress,
		options
	) {
		let fixedWidth = options && options.width > 0 ? Number(options.width) : 0;
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
							columns: zotLookSheet.columnsFor(count, maxColumns),
							// A caller laying several documents side by
							// side says the width itself; a page sheet
							// takes it from its own page count
							width: fixedWidth || zotLookSheet.widthFor(count, maxColumns),
							pages: [],
							outline: [],
						};
					}
					// Only the worker that was asked carries one, and it
					// need not be the first to answer
					if (Array.isArray(message.outline)) {
						manifest.outline = message.outline;
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
								text: message.text || "",
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
			// the document for itself, so every worker needs its own copy.
			// The outline is the same in each, so one of them resolves it.
			workers.forEach((worker, index) => {
				worker.postMessage({
					type: "open",
					data: bytes.buffer,
					outline: index === 0,
				});
			});
		});
	},

	/**
	 * The PDF attachments in a selection, paired with their resolved paths.
	 *
	 * Returns the items rather than only the paths so the contact sheet can
	 * build a link back into Zotero's reader for each page.
	 *
	 * @returns {Promise<{item: Zotero.Item, path: string}|null>} the one
	 *          chosen, or null when the selection holds none that can be read
	 */
	async _pickPdfAttachment(items) {
		return this._pickAttachment(items, (a) => this._isPDFAttachment(a), "PDF");
	},

	/** The same, for the books that can carry a page sheet of their own. */
	async _pickEpubAttachment(items) {
		return this._pickAttachment(items, (a) => this._isEPUBAttachment(a), "EPUB");
	},

	/**
	 * The first attachment among the selection that the test accepts and
	 * whose file can actually be reached.
	 */
	async _pickAttachment(items, accept, label) {
		let candidates = [];

		for (let item of items) {
			if (item.isNote()) continue;

			let attachments = item.isAttachment()
				? [item]
				: (typeof item.getAttachments === "function"
					? item.getAttachments(false).map((id) => Zotero.Items.get(id))
					: []);

			for (let attachment of attachments) {
				if (attachment && accept(attachment)) {
					candidates.push(attachment);
				}
			}
		}

		if (candidates.length === 0) return null;
		if (candidates.length > 1) {
			this.log(
				"Contact sheet uses the first of " +
					candidates.length +
					" candidate " + label + "s"
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
			// A group library carries groupID; the published type describes
			// only what every library has, so the check above is what makes
			// this safe rather than the declaration.
			let library = /** @type {any} */ (
				Zotero.Libraries.get(item.libraryID));
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
			this.LOADED_STRINGS
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
			// context; it is handed the strings it shows.
			zotLookEpub.TOC_LABEL = this._string(
				"zotlook-epub-contents",
				zotLookEpub.TOC_LABEL
			);
			zotLookEpub.ANNOTATIONS_LABEL = this._string(
				"zotlook-epub-annotations",
				zotLookEpub.ANNOTATIONS_LABEL
			);
			zotLookEpub.GOTO_LABEL = this._string(
				"zotlook-epub-goto",
				zotLookEpub.GOTO_LABEL
			);
			zotLookEpub.NO_PAGES_LABEL = this._string(
				"zotlook-epub-nopages",
				zotLookEpub.NO_PAGES_LABEL
			);
			zotLookEpub.NO_PAGES_HINT = this._string(
				"zotlook-epub-nopages-hint",
				zotLookEpub.NO_PAGES_HINT
			);
			zotLookEpub.FRONT_LABEL = this._string(
				"zotlook-epub-frontmatter",
				zotLookEpub.FRONT_LABEL
			);
			// The sheet module likewise: its two menus, the page link in
			// the annotation list, and the names of the kinds it lists
			zotLookSheet.TITLE = this._string(
				"zotlook-sheet-title",
				zotLookSheet.TITLE
			);
			zotLookSheet.OPEN_LABEL = this._string(
				"zotlook-sheet-open",
				zotLookSheet.OPEN_LABEL
			);
			zotLookSheet.COLLECTION_TITLE = this._string(
				"zotlook-sheet-collection-title",
				zotLookSheet.COLLECTION_TITLE
			);
			zotLookSheet.NO_PAGE_LABEL = this._string(
				"zotlook-sheet-nopage",
				zotLookSheet.NO_PAGE_LABEL
			);
			zotLookSheet.TOC_LABEL = this._string(
				"zotlook-epub-contents",
				zotLookSheet.TOC_LABEL
			);
			zotLookSheet.ANNOTATIONS_LABEL = this._string(
				"zotlook-epub-annotations",
				zotLookSheet.ANNOTATIONS_LABEL
			);
			zotLookSheet.PAGE_LABEL = this._string(
				"zotlook-sheet-page",
				zotLookSheet.PAGE_LABEL
			);
			zotLookSheet.SEARCH_LABEL = this._string(
				"zotlook-sheet-search",
				zotLookSheet.SEARCH_LABEL
			);
			zotLookSheet.SEARCH_NONE = this._string(
				"zotlook-sheet-search-none",
				zotLookSheet.SEARCH_NONE
			);
			zotLookSheet.PAGES_LABEL = this._string(
				"zotlook-sheet-pages",
				zotLookSheet.PAGES_LABEL
			);
			// One call each rather than a loop, so that the ids can be read
			// off the source — which is how they are checked
			let kinds = zotLookSheet.TYPE_LABELS;
			kinds.note = this._string("zotlook-sheet-note", kinds.note);
			kinds.image = this._string("zotlook-sheet-image", kinds.image);
			kinds.ink = this._string("zotlook-sheet-ink", kinds.ink);
			kinds.text = this._string("zotlook-sheet-text", kinds.text);
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
			zotLookUtil.safeName(this.version || "0", 20) + "-" + name
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
			name + "-" + zotLookUtil.safeName(this.version || "0", 20)
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
	async _launchPreview(filePaths, items) {
		// Callers run inside _withLaunchGuard, so no guard of our own here.
		// A preview opened from the context menu can arrive while another one
		// is still up; replace it rather than orphaning the process. Only
		// the process is taken down here: a preview that toggles on its own
		// must not be closed first, or a second press would reopen it.
		this._killPreviewProcess();

		let plan = await this._previewCommand(filePaths);
		if (!plan) {
			this.log("No preview mechanism on this platform");
			return;
		}

		// A one-shot request hands the toggling to the viewer itself, so
		// there is nothing to track or kill — see _deliver
		if (!plan.holdsProcess) {
			this._previewerAbsent = false;
			let accepted = await this._deliver(plan);
			if (!accepted && this._previewerAbsent && items) {
				await this._fallbackToWindow(items);
			}
			return;
		}

		const { Subprocess } = this._subprocess();
		this.log("Launching: " + plan.command + " " + plan.arguments.join(" "));

		try {
			let proc = await Subprocess.call({
				command: plan.command,
				arguments: plan.arguments,
			});

			// Only a viewer that stays running for as long as the preview is
			// visible can be tracked and dismissed.
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
	 * @returns {Promise<{command?: string, arguments?: string[],
	 *          pipePath?: string, pipeLine?: string, holdsProcess: boolean,
	 *          sushiShows?: boolean}|null>} one plan, not two shapes: a
	 *          subprocess plan fills command and arguments, a pipe plan fills
	 *          pipePath and pipeLine, and holdsProcess says which of the two
	 *          the caller is holding. sushiShows marks the plan that puts a
	 *          window up which only Sushi can take down again.
	 */
	async _previewCommand(filePaths, options) {
		let replace = !!(options && options.replace);
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
						filePaths.length + ", the arrows show the rest"
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
					// The flag closes a preview already showing this file:
					// what a toggle wants, and what a switch must not do
					replace ? "boolean:false" : "boolean:true",
				],
				holdsProcess: false,
				sushiShows: true,
			};
		}

		if (Zotero.isWin) {
			if (filePaths.length > 1) {
				this.log(
					"QuickLook previews one file; showing the first of " +
						filePaths.length + ", the arrows show the rest"
				);
			}
			return this._windowsPlan(
				zotLookUtil.quickLookPipeLine(replace ? "Switch" : "Toggle", filePaths[0]),
				true
			);
		}

		return null;
	},

	/**
	 * One line for QuickLook's pipe, as a plan: written from this process
	 * where ctypes is there, by PowerShell where it is not.
	 *
	 * @param {boolean} shows whether the line puts a preview up — a Toggle
	 *   may, a Close never does — which is what Escape later goes by
	 */
	async _windowsPlan(line, shows) {
		try {
			return {
				pipePath: this._winPreview().pipePath(),
				pipeLine: line,
				holdsProcess: false,
				shows,
			};
		} catch (e) {
			this.log("Falling back to PowerShell for the pipe write: " + e);
		}
		return {
			command: await this._powershell(),
			arguments: [
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				zotLookUtil.encodePowerShell(
					zotLookUtil.quickLookFallbackScript(line)
				),
			],
			holdsProcess: false,
			shows,
		};
	},

	/**
	 * Delivers a one-shot request: a pipe plan from this very process — a
	 * few Win32 calls, no subprocess — and any other through a subprocess
	 * that is waited for, because a D-Bus call's delivery depends on the
	 * sender staying connected until it has been answered.
	 *
	 * @returns {Promise<boolean>} whether the request was accepted
	 */
	async _deliver(plan) {
		if (plan.pipePath) return this._postPipeMessage(plan);

		const { Subprocess } = this._subprocess();
		this.log("Launching: " + plan.command + " " + plan.arguments.join(" "));
		let accepted = false;
		try {
			// stderr is read, for the reason the request gives when it fails
			let proc = await Subprocess.call({
				command: plan.command,
				arguments: plan.arguments,
				stderr: "pipe",
			});
			accepted = await this._awaitPreviewRequest(proc);
		} catch (e) {
			this.log("Failed to launch the preview: " + e);
		}
		if (accepted && plan.shows !== undefined) this._pipeShown = plan.shows;
		if (accepted && plan.sushiShows) {
			this._sushiShown = true;
			this._ensureSushiMonitor();
		}
		this._syncReaderHook();
		return accepted;
	},

	/** Overridable for tests, like _subprocess. */
	_winPreview() {
		return zotLookWinPreview;
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
		// Asked for before the window appears, so the keyboard stays in
		// Zotero whether the preview was started by key or by mouse — see
		// zotLookWinPreview.lockForeground. Its failure is not the request's.
		if (plan.shows) {
			try {
				this._winPreview().lockForeground();
			} catch (e) {
				this.log("Could not keep the keyboard in Zotero: " + e);
			}
		}
		try {
			this._winPreview().postLine(plan.pipePath, plan.pipeLine);
			this.log("Preview request delivered");
			if (plan.shows !== undefined) this._pipeShown = plan.shows;
			this._syncReaderHook();
			return true;
		} catch (e) {
			this.log("The preview request was refused: " + e);
			if (e && e.quickLookAbsent) {
				this._previewerAbsent = true;
				this._logQuickLookMissing();
			}
			await this._writeFailureReport("the preview request was refused");
			return false;
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
			return true;
		}

		complaint = complaint.trim();
		this.log(
			"The preview request was refused (exit " + exitCode + ")" +
				(complaint ? ": " + complaint : "")
		);
		// The one failure worth naming: the service is simply not there.
		if (/ServiceUnknown|not provided by any/.test(complaint)) {
			this._previewerAbsent = true;
			this.log(
				"GNOME Sushi does not appear to be installed. Install it " +
					"(package gnome-sushi) to preview outside Zotero; the " +
					"contact sheet in a window works without it."
			);
		}
		// The marker the PowerShell fallback prints when the pipe never
		// answered — its own exception text is localised.
		if (/QuickLookUnreachable/.test(complaint)) {
			this._previewerAbsent = true;
			this._logQuickLookMissing();
		}
		await this._writeFailureReport("the preview request was refused");
		return false;
	},

	/**
	 * Takes down whatever preview is up: the helper process on macOS, or
	 * QuickLook's window on Windows, which is asked to close over the pipe.
	 */
	_closeQuickLook() {
		this._killPreviewProcess();
		if (this._pipeShown) this._dismissPipePreview();
		if (this._sushiShown) this._dismissSushiPreview();
	},

	_killPreviewProcess() {
		if (this._proc) {
			this.log("Closing the preview");
			this._proc.kill();
			this._proc = null;
			this._isActive = false;
		}
	},

	/**
	 * Sends QuickLook its Close. Not awaited: the callers are key handlers,
	 * and the message closes a window rather than starting anything that
	 * would have to be watched.
	 */
	/**
	 * Where gdbus is. Looked up on PATH with the usual place as fallback,
	 * like dbus-send: one is for calls, the other is the only one of the two
	 * that can sit on the bus and listen.
	 */
	async _gdbus() {
		const { Subprocess } = this._subprocess();
		if (Subprocess && typeof Subprocess.pathSearch === "function") {
			try {
				return await Subprocess.pathSearch("gdbus");
			} catch (e) {
				this.log("gdbus is not on PATH: " + e);
			}
		}
		return "/usr/bin/gdbus";
	},

	/**
	 * Listens to what Sushi says back, for as long as the session runs.
	 *
	 * Sushi keeps the arrow keys to itself — they are window accelerators —
	 * but it does not keep them quiet: each press goes out on the bus as a
	 * SelectionEvent, which is how Files walks its list with the preview
	 * open. This monitor is zotLook answering the same way: an arrow in the
	 * preview moves the selection in Zotero and the preview follows.
	 *
	 * The same wiretap hears the previewer's Visible property drop to false,
	 * which is the one reliable word that the window is gone — however it
	 * went: our Close, the toggle, or q, Space or Escape pressed inside it.
	 * That keeps _sushiShown honest, and honest is what gates the arrows:
	 * a preview Files opened must not walk Zotero's list.
	 */
	async _ensureSushiMonitor() {
		if (this._sushiMonitor) return;
		const { Subprocess } = this._subprocess();
		let proc;
		try {
			proc = await Subprocess.call({
				command: await this._gdbus(),
				arguments: [
					"monitor",
					"--session",
					"--dest",
					"org.gnome.NautilusPreviewer",
				],
			});
		} catch (e) {
			this.log("Could not listen for Sushi's arrow keys: " + e);
			return;
		}
		this._sushiMonitor = proc;
		this.log("Listening for Sushi's selection events");
		this._pumpSushiMonitor(proc);
	},

	/** Reads the monitor line by line for as long as it lives. */
	async _pumpSushiMonitor(proc) {
		let rest = "";
		try {
			for (;;) {
				let chunk = await proc.stdout.readString();
				if (!chunk) break;
				let lines = (rest + chunk).split("\n");
				rest = lines.pop();
				for (let line of lines) {
					this._onSushiMonitorLine(line);
				}
			}
		} catch (e) {
			this.log("The Sushi monitor stopped: " + e);
		}
		if (this._sushiMonitor === proc) this._sushiMonitor = null;
	},

	/**
	 * One line of monitor output. Two kinds matter; everything else is the
	 * bus being chatty.
	 */
	_onSushiMonitorLine(line) {
		if (
			line.indexOf("PropertiesChanged") !== -1 &&
			line.indexOf("'Visible': <false>") !== -1
		) {
			if (this._sushiShown) {
				this.log("Sushi reports its window gone");
				this._sushiShown = false;
				this._syncReaderHook();
			}
			return;
		}

		let event = /\.SelectionEvent \(uint\d+ (\d+),?\)/.exec(line);
		if (!event) return;
		// Not ours: a preview Files opened also speaks here
		if (!this._sushiShown) return;
		// The walking is a choice, and the settings pane offers it. The
		// monitor runs regardless: it is also what keeps _sushiShown honest.
		if (!this._pref("sushiArrowSelection", true)) return;
		let direction = Number(event[1]);
		let step =
			this.SUSHI_NEXT_DIRECTIONS.indexOf(direction) !== -1 ? 1 : -1;
		// Left and right walk the files of the press where there are
		// several — an item's attachments — and the list otherwise; up
		// and down walk the list, as they do in Files
		let sideways = direction === 4 || direction === 5;
		if (sideways && this._previewList.paths.length > 1) {
			this._stepPreviewList(step);
			return;
		}
		this._stepSelection(step);
	},

	/**
	 * One arrow's worth of movement: the selection at once, the preview when
	 * the keys come to rest.
	 *
	 * The plain preview, deliberately, whatever put the current one up: an
	 * arrow walks the list the way it walks it in Files, and a contact sheet
	 * per step would mean seconds of rendering for rows only passed through.
	 */
	_stepSelection(step) {
		try {
			let win = Zotero.getMainWindow();
			let view = win && win.ZoteroPane && win.ZoteroPane.itemsView;
			if (!view || !view.selection) return;

			let row = Number(view.selection.focused) + step;
			if (row < 0 || row >= view.rowCount) return;
			view.selection.select(row);
			if (typeof view.ensureRowIsVisible === "function") {
				view.ensureRowIsVisible(row);
			}
		} catch (e) {
			this.log("Could not move the selection: " + e);
			return;
		}

		if (this._sushiPreviewTimer) clearTimeout(this._sushiPreviewTimer);
		this._sushiPreviewTimer = setTimeout(() => {
			this._sushiPreviewTimer = null;
			// The window may have been closed while the timer ran
			if (!this._sushiShown) return;
			try {
				let win = Zotero.getMainWindow();
				let items =
					win && win.ZoteroPane && win.ZoteroPane.getSelectedItems();
				if (items && items.length > 0) this._openQuickLook(items);
			} catch (e) {
				this.log("Could not preview the stepped selection: " + e);
			}
		}, this.SUSHI_STEP_PREVIEW_DELAY_MS);
	},

	/**
	 * Sends Sushi its Close, for a press the plugin can still hear.
	 *
	 * Once the preview is up, GNOME hands it the keyboard, and Sushi answers
	 * its own keys — Space, Escape and q all close it; the plugin never sees
	 * a key again until Zotero is focused. This is for the other half:
	 * Escape pressed back in Zotero. Like the pipe's flag, _sushiShown can be
	 * stale in one direction — the user may have closed the window from
	 * inside it — and a Close with no window up closes nothing, at the cost
	 * of briefly waking the service.
	 */
	_dismissSushiPreview() {
		this._sushiShown = false;
		this._syncReaderHook();
		this._dbusSend()
			.then((command) =>
				this._deliver({
					command: command,
					arguments: [
						"--session",
						"--print-reply",
						"--reply-timeout=" + this.PREVIEW_REPLY_TIMEOUT_MS,
						"--dest=org.gnome.NautilusPreviewer",
						"/org/gnome/NautilusPreviewer",
						"org.gnome.NautilusPreviewer.Close",
					],
					holdsProcess: false,
				})
			)
			.catch((e) => this.log("Could not close the preview: " + e));
	},

	_dismissPipePreview() {
		this._pipeShown = false;
		this._syncReaderHook();
		this._windowsPlan(zotLookUtil.quickLookPipeLine("Close", ""), false)
			.then((plan) => this._deliver(plan))
			.catch((e) => this.log("Could not close the preview: " + e));
	},

	// ── File path resolution ──────────────────────────────────────────

	/**
	 * Resolves the selection into files QuickLook can display.
	 */
	async _getPreviewPath(items) {
		let paths = [];

		// One item selected: every attachment it has, best first, so that
		// a paper with its PDF and a snapshot shows both and the arrows go
		// from one to the other. Several items: one file each, the best,
		// so that a selection of twenty papers is twenty files and not
		// sixty. Quick Look takes the whole list; Sushi and QuickLook are
		// shown the first and told the next as the arrows go.
		let regular = items.filter((item) => {
			try {
				return !item.isNote() && !item.isAttachment();
			} catch (e) {
				return false;
			}
		});
		let every = regular.length === 1 && items.length === 1;

		for (let item of items) {
			let path = null;

			if (item.isNote()) {
				path = await this._writeNoteToTempFile(item);
				if (path) paths.push(path);
				continue;
			}

			if (item.isAttachment()) {
				path = await this._getAttachmentPath(item);
				if (path) path = await this._normalizeForPreview(path, item);
				if (path) paths.push(path);
				continue;
			}

			let chosen = every
				? await this._everyAttachment(item)
				: [await this._pickBestAttachment(item)].filter(Boolean);
			for (let one of chosen) {
				let normal = await this._normalizeForPreview(one.path, one.item);
				if (normal) paths.push(normal);
			}
		}

		this._previewList = { paths: paths.slice(), index: 0 };
		return paths;
	},

	/**
	 * All of an item's attachments that can be previewed, in the order the
	 * preference puts them, each with its path.
	 */
	async _everyAttachment(item) {
		let out = [];
		for (let attachment of this._orderAttachments(this._attachmentsOf(item))) {
			let path = await this._getAttachmentPath(attachment);
			if (path) out.push({ item: attachment, path: path });
		}
		return out;
	},

	/**
	 * The next or the previous file of the list, shown in place of the
	 * one up — for the previewers that show one file at a time. Quick
	 * Look walks its own list, so there is nothing to do there; the
	 * window shows a sheet, not a file, and has nothing to walk either.
	 *
	 * @returns {Promise<boolean>} whether there was a list to walk
	 */
	async _stepPreviewList(step) {
		let list = this._previewList;
		if (!list || list.paths.length < 2) return false;
		let n = list.paths.length;
		list.index = ((list.index + step) % n + n) % n;
		let path = list.paths[list.index];
		this.log("Arrow: file " + (list.index + 1) + " of " + n);
		return this._switchPreviewTo(path);
	},

	/**
	 * Shows another file where one is showing: Sushi's ShowFile without
	 * its close-if-shown flag, QuickLook's Switch.
	 */
	async _switchPreviewTo(path) {
		let plan = await this._previewCommand([path], { replace: true });
		if (!plan) return false;
		return this._deliver(plan);
	},

	/**
	 * The preview following the selection: with a preview up, an arrow up
	 * or down in the item list moves the selection as it always did, and
	 * once the keys come to rest the preview shows what is selected now.
	 * How Files does it with Sushi, and Explorer with QuickLook; on macOS
	 * Quick Look holds the keyboard itself, so this is never reached.
	 */
	_followSelection(window) {
		if (this._sushiPreviewTimer) clearTimeout(this._sushiPreviewTimer);
		this._sushiPreviewTimer = setTimeout(async () => {
			this._sushiPreviewTimer = null;
			if (!this._pipeShown && !this._sushiShown) return;
			try {
				let items = window.ZoteroPane && window.ZoteroPane.getSelectedItems();
				if (!items || !items.length) return;
				let paths = await this._getPreviewPath(items);
				if (paths.length) await this._switchPreviewTo(paths[0]);
			} catch (e) {
				this.log("Could not follow the selection: " + e);
			}
		}, this.SUSHI_STEP_PREVIEW_DELAY_MS);
	},

	/**
	 * Picks the attachment worth previewing for a regular item: a PDF if there
	 * is one, otherwise an EPUB, otherwise whatever came first.
	 *
	 * @returns {Promise<{item: Zotero.Item, path: string}|null>} the
	 *          attachment and its path — the item as well as the path,
	 *          because a caller that previews it may also need to ask it
	 *          for its annotations
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

		let order = zotLookUtil.attachmentOrder(this._pref("attachmentOrder", ""));

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
			let html = await this._epubPreview(path, attachment);
			return html || path;
		}

		let annotated = await this._annotatedCopy(attachment);
		return annotated || path;
	},

	/**
	 * The EPUB rendered as one page, made once and kept.
	 *
	 * Unpacking and reassembling a book takes seconds. It used to be
	 * remembered in a Map and written into the working directory, which meant
	 * the work came back with every restart; it goes through the same store
	 * as the contact sheet now, and is aged out and cleared with it.
	 */
	async _epubPreview(path, attachment) {
		let name = "epub_" + zotLookUtil.safeName(PathUtils.filename(path), 60);
		let keep = this._keepPreviews();
		let entry = await this._derivedEntry(name, keep);

		let annotations = this._epubAnnotations(attachment);
		let key = keep
			? [
				this._tag(),
				path,
				await this._fileIdentity(path),
				this._annotationKeyPart(attachment, "epubAnnotations"),
			].join("|")
			: null;

		let kept = await this._derivedHit(entry, key, "preview.html");
		if (kept) {
			this.log("Reusing the EPUB preview built earlier: " + kept);
			return kept;
		}

		// A miss may be a changed book, and the leftovers of the previous one
		// would still be lying in the entry. Cleared rather than written over,
		// because a spine that lost a chapter would otherwise keep serving it.
		try {
			await IOUtils.remove(entry.dir, { recursive: true, ignoreAbsent: true });
			await IOUtils.makeDirectory(entry.dir, {
				ignoreExisting: true,
				createAncestors: true,
			});
		} catch (e) {
			this.log("Could not clear the EPUB entry: " + e);
		}

		let html = await zotLookEpub.convert(
			path,
			Object.assign(this._epubEnv(entry.dir), { annotations })
		);
		if (!html) return null;
		await this._derivedCommit(entry, key);
		return html;
	},

	/**
	 * The page overview of a book, made once and kept.
	 *
	 * Shares everything with the EPUB preview but the mode: the same store,
	 * the same key, the same clearing of a stale entry. What differs is that
	 * the conversion cuts the book at its printed page marks instead of
	 * running it together, and that each page is a link back into the reader.
	 */
	async _epubSheet(path, attachment) {
		let name = "epubsheet_" + zotLookUtil.safeName(PathUtils.filename(path), 60);
		let keep = this._keepPreviews();
		let entry = await this._derivedEntry(name, keep);

		let annotations = this._epubAnnotations(attachment);
		let showToc = this._pref("contactSheetContents", true);
		let showAnnotations = this._pref("contactSheetAnnotations", true);
		let key = keep
			? [
				this._tag(),
				path,
				await this._fileIdentity(path),
				this._annotationKeyPart(attachment, "epubAnnotations"),
				showToc ? "contents" : "no-contents",
				showAnnotations ? "list" : "no-list",
			].join("|")
			: null;

		let kept = await this._derivedHit(entry, key, "sheet.html");
		if (kept) {
			this.log("Reusing the EPUB page sheet built earlier: " + kept);
			return kept;
		}

		try {
			await IOUtils.remove(entry.dir, { recursive: true, ignoreAbsent: true });
			await IOUtils.makeDirectory(entry.dir, {
				ignoreExisting: true,
				createAncestors: true,
			});
		} catch (e) {
			this.log("Could not clear the EPUB sheet entry: " + e);
		}

		let progress = this._showProgress(
			this._string(
				"zotlook-progress-contactsheet",
				"Generating contact sheet…"
			)
		);
		let html;
		try {
			html = await zotLookEpub.convert(
				path,
				Object.assign(this._epubEnv(entry.dir), {
					annotations,
					mode: "sheet",
					readerLink: this._readerLink(attachment),
					showToc,
					showAnnotations,
				})
			);
		} finally {
			this._closeProgress(progress);
		}
		if (!html) return null;
		await this._derivedCommit(entry, key);
		return html;
	},

	/**
	 * The item's annotations, each with the page it sits on, for the sheet's
	 * list. The page comes out of the position Zotero stores — JSON with a
	 * pageIndex counted from zero — and the label beside it is the printed
	 * number where the PDF names its pages, so the list says "Page xii" for
	 * a preface rather than "Page 4". External annotations are left out:
	 * they are in the file already, drawn where they belong.
	 */
	_pdfAnnotations(attachment) {
		if (!attachment) return [];
		let items;
		try {
			items = attachment
				.getAnnotations()
				.filter((a) => !a.annotationIsExternal);
		} catch (e) {
			this.log("Could not read annotations: " + e);
			return [];
		}
		let out = [];
		for (let item of items) {
			try {
				let position = item.annotationPosition;
				if (typeof position === "string") position = JSON.parse(position);
				let index = position ? Number(position.pageIndex) : NaN;
				if (!Number.isInteger(index) || index < 0) continue;
				out.push({
					page: index + 1,
					key: item.key || "",
					label: String(item.annotationPageLabel || "").trim() || undefined,
					type: item.annotationType || "highlight",
					text: item.annotationText || "",
					comment: item.annotationComment || "",
					color: item.annotationColor || "",
					sortIndex: item.annotationSortIndex || "",
				});
			} catch (e) {
				// One unreadable annotation must not cost the list
			}
		}
		// Reading order, which is what the sort index encodes
		out.sort((a, b) =>
			String(a.sortIndex).localeCompare(String(b.sortIndex)));
		return out;
	},

	/**
	 * The item's annotations, in the shape the conversion needs.
	 *
	 * A PDF gets these from Zotero itself — PDFWorker.export bakes them into
	 * a copy — but there is no such export for an epub, so what is read here
	 * is the annotation items themselves and the conversion places them.
	 *
	 * External annotations are left out for the same reason as in the PDF
	 * path: they are already in the file.
	 */
	_epubAnnotations(attachment) {
		if (!attachment || !this._pref("epubAnnotations", true)) return [];
		let items;
		try {
			items = attachment
				.getAnnotations()
				.filter((a) => !a.annotationIsExternal);
		} catch (e) {
			this.log("Could not read annotations: " + e);
			return [];
		}
		let out = [];
		for (let item of items) {
			try {
				out.push({
					type: item.annotationType || "highlight",
					text: item.annotationText || "",
					comment: item.annotationComment || "",
					color: item.annotationColor || "",
					sortIndex: item.annotationSortIndex || "",
					// Where it belongs, in Zotero's own words: a
					// FragmentSelector holding an EPUB CFI
					position: item.annotationPosition || "",
				});
			} catch (e) {
				// One unreadable annotation must not cost the whole preview
			}
		}
		return out;
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

		// The same store as the other two, but deliberately not kept: this
		// one is a whole copy of the PDF, so it is the largest thing here for
		// the smallest saving — an export takes a moment where a contact
		// sheet takes seconds. It lives for the session and goes with the
		// working directory at the next start.
		let fileName =
			"annotated_" + zotLookUtil.safeName(attachment.key, 40) + ".pdf";
		let entry = await this._derivedEntry(fileName.replace(/\.pdf$/, ""), false);
		let key = [this._tag(), attachment.key, signature].join("|");

		let ready = await this._derivedHit(entry, key, fileName);
		if (ready) return ready;

		let outputPath = PathUtils.join(entry.dir, fileName);
		try {
			this.log("Exporting annotations for " + attachment.key);
			await Zotero.PDFWorker.export(attachment.id, outputPath, true);
		} catch (e) {
			this.log("Could not export annotations: " + e);
			return null;
		}

		await this._derivedCommit(entry, key);
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

	/**
	 * The file behind an attachment, fetched first when this machine does not
	 * have it yet.
	 *
	 * getFilePath rather than getFilePathAsync, and the difference is the
	 * whole point: the asynchronous one checks that the file is on disk and
	 * answers false when it is not — which is exactly the case this method
	 * exists to handle. Asking it first put the missing file and the absent
	 * attachment into one answer and left the fetch below unreachable, so
	 * under "download as needed" nothing was ever previewable that had not
	 * already been opened once. Zotero's own viewAttachment takes the
	 * synchronous path for the same reason.
	 */
	async _getAttachmentPath(item) {
		if (!item.isAttachment()) return null;

		// Skip web-only attachments
		if (
			item.attachmentLinkMode ===
			Zotero.Attachments.LINK_MODE_LINKED_URL
		) {
			return null;
		}

		let path = item.getFilePath();
		if (!path) {
			this.log("No file path for attachment " + item.id);
			return null;
		}

		if (await IOUtils.exists(path)) return path;

		this.log("Not on this machine yet: " + path);
		return this._fetchAttachment(item);
	},

	/**
	 * Downloads an attachment that the library has and this machine does not.
	 *
	 * "Download as needed" is the default for group libraries and a common
	 * choice for personal ones. Under it most of a library is a database row
	 * until something asks for the file, and asking is what a preview is.
	 *
	 * @returns {Promise<string|null>} the path it now has, or null
	 */
	async _fetchAttachment(item) {
		if (
			typeof item.isStoredFileAttachment !== "function" ||
			!item.isStoredFileAttachment()
		) {
			this.log("A linked file that is not there cannot be fetched");
			return null;
		}

		let sync = Zotero.Sync;
		let enabled = false;
		try {
			enabled = !!sync.Storage.Local.getEnabledForLibrary(item.libraryID);
		} catch (e) {
			this.log("Could not ask whether files sync here: " + e);
		}
		if (!enabled) {
			this.log("File syncing is off for this library; nothing to fetch");
			return null;
		}

		// Books and scans are megabytes over the network. Without a word the
		// plugin looks like it ignored the keystroke, which is what a missing
		// file looked like for as long as the fetch was unreachable.
		let progress = this._showProgress(
			this._string("zotlook-progress-download", "Downloading file…")
		);
		try {
			await sync.Runner.downloadFile(item);
		} catch (e) {
			this.log("Download failed: " + e);
			return null;
		} finally {
			this._closeProgress(progress);
		}

		// Asked again rather than reusing the path from before: now that the
		// file should be there, the checking accessor is the one that answers
		// both whether it arrived and where it went.
		let path = await item.getFilePathAsync();
		if (!path) {
			this.log("Still not here after the download: " + item.key);
			await this._writeFailureReport(
				"an attachment could not be fetched from the server"
			);
			return null;
		}

		this.log("Fetched " + path);
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
			zotLookUtil.safeName(title, 100) + "_" + item.id + ".html"
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
		let out = zotLookUtil.newHtmlDocument();
		let noteBody = zotLookUtil.parseBodyFragment(noteContent);
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

		zotLookUtil.sanitize(noteBody);
		for (let node of [...noteBody.childNodes]) {
			out.body.appendChild(out.importNode(node, true));
		}

		return zotLookUtil.serializeHtmlDocument(out);
	},

	_getTempDirPath() {
		if (!this._tempDir) {
			let base = Zotero.getTempDirectory().path;
			this._tempDir = PathUtils.join(base, "zotLook");
		}
		return this._tempDir;
	},

	/**
	 * What zotLookEpub needs from us: somewhere to work, and a way to run
	 * a subprocess under a deadline.
	 */
	/**
	 * What the EPUB conversion needs from the host.
	 *
	 * Both readers come from the platform rather than from here: Gecko's
	 * nsIZipReader for the archive, and Zotero's own EPUB module — the one it
	 * uses for full-text indexing — for the join of manifest and spine. That
	 * is the piece of epub arithmetic Zotero already maintains, and it is
	 * exercised on every book it indexes.
	 */
	_epubEnv(workDir) {
		return {
			outDir: workDir || this._getTempDirPath(),
			openZip: (path) => {
				let reader = Components.classes[
					"@mozilla.org/libjar/zip-reader;1"
				].createInstance(Components.interfaces.nsIZipReader);
				reader.open(Zotero.File.pathToFile(path));
				return reader;
			},
			extractEntry: async (zip, entry, destPath) => {
				zip.extract(entry, Zotero.File.pathToFile(destPath));
				// The reader keeps the archive's permission bits, and an
				// asset stored read-only would come out undeletable on
				// Windows — see _removeTree. Written, not merely copied.
				try {
					await IOUtils.setPermissions(destPath, 0o644);
				} catch (e) {
					// Best effort; the removal side copes as well
				}
			},
			openBook: (path) => {
				let { EPUB } = ChromeUtils.importESModule(
					"chrome://zotero/content/EPUB.mjs"
				);
				return new EPUB(path);
			},
		};
	},

	// ── Shutdown ──────────────────────────────────────────────────────

	shutdown() {
		this._closeQuickLook();
		if (this._sushiPreviewTimer) {
			clearTimeout(this._sushiPreviewTimer);
			this._sushiPreviewTimer = null;
		}
		if (this._sushiMonitor) {
			try {
				this._sushiMonitor.kill();
			} catch (e) {
				// Already gone
			}
			this._sushiMonitor = null;
		}
		this._releaseViewer();
		this._dropResourceAlias();
		this._unregisterPreferencePane();
		this._unregisterItemPaneSection();
		if (Zotero.zotLook === this) delete Zotero.zotLook;
		this._unwatchPreferences();
		this._cleanTempDir().catch((e) =>
			this.log("Shutdown cleanup failed: " + e)
		);
		this.initialized = false;
	},

	async _cleanTempDir() {
		// Drop the caches before awaiting anything. On shutdown bootstrap.js
		// releases the module globals as soon as this returns, so a
		// continuation that ran after the await would find zotLookEpub gone.
		this._binaries.clear();

		// Resolve the path rather than reading _tempDir: on startup nothing has
		// populated it yet, and the point of this call is to clear leftovers
		// from a previous session.
		let dir = this._getTempDirPath();
		try {
			await this._removeTree(dir);
			this.log("Cleaned temp directory: " + dir);
		} catch (e) {
			// A missing directory does not throw; anything else is a
			// leftover that will still be there next time, so say so
			this.log("Could not clean the temp directory: " + e);
		}
	},
});
