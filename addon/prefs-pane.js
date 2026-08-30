/* eslint-disable no-unused-vars */
/* global Zotero, zotLookUtil, document, window, MutationObserver */

/**
 * Preference pane for zotLook.
 *
 * Loaded by Zotero.PreferencePanes together with util.js, so the shortcut
 * parsing here is the same code the plugin uses to interpret what it stores.
 *
 * Two things about this environment drive the shape of the file:
 *
 *  - Pane scripts run BEFORE the fragment is inserted into the document, so
 *    there is nothing to query at load time. Everything waits for the root.
 *  - Labels resolve through the <linkset> in the pane's XHTML; the FTL is not
 *    otherwise present in the preferences window.
 */
(function () {
	const PREF_BRANCH = "extensions.zotlook.";

	// One source of truth for the shipped shortcuts, shared with the plugin:
	// "Restore defaults" here has to offer the same combination the plugin
	// listens for.
	const ACTIONS = [
		{ key: "preview", pref: "key.preview" },
		{ key: "notes", pref: "key.notes" },
		{ key: "contactSheet", pref: "key.contactSheet" },
		{ key: "contactSheetWindow", pref: "key.contactSheetWindow" },
	].map((action) =>
		Object.assign(action, {
			default: zotLookUtil.defaultShortcut(action.pref),
		})
	);

	/**
	 * What Zotero binds in JavaScript rather than in a <key> element.
	 *
	 * The registry above is built from the main window's <key> elements,
	 * which is everything the DOM can be asked for — and it misses the ones
	 * Zotero handles in its own keydown listeners. Shift+Tab is the case
	 * that showed it: zoteroPane.js moves focus backwards across
	 * twenty-two targets with it, and the pane would have reported no
	 * conflict at all, which is worse than reporting none because it sounds
	 * like an answer.
	 *
	 * Read out of Zotero 7's zoteroPane.js. A list kept by hand goes stale;
	 * saying so here is the honest half of the bargain, and stale entries
	 * cost a warning too many rather than a shortcut that does not work.
	 */
	const ZOTERO_JS_KEYS = [
		{ shortcut: "Tab", label: "Zotero move focus" },
		{ shortcut: "Shift+Tab", label: "Zotero move focus back" },
		{ shortcut: "Ctrl+PageUp", label: "Zotero previous tab" },
		{ shortcut: "Ctrl+PageDown", label: "Zotero next tab" },
		{ shortcut: "Meta+Shift+BracketLeft", label: "Zotero previous tab" },
		{ shortcut: "Meta+Shift+BracketRight", label: "Zotero next tab" },
	];

	/** Shortcut text: Mac keycap symbols there, spelled out everywhere else. */
	function describe(shortcut) {
		return zotLookUtil.describeShortcut(shortcut, !!Zotero.isMac);
	}

	function getPref(name, fallback) {
		try {
			let value = Zotero.Prefs.get(PREF_BRANCH + name, true);
			return value === undefined ? fallback : value;
		} catch (e) {
			return fallback;
		}
	}

	function setPref(name, value) {
		try {
			Zotero.Prefs.set(PREF_BRANCH + name, value, true);
		} catch (e) {
			Zotero.debug("zotLook: could not write " + name + ": " + e);
		}
	}

	function init(root) {
		if (root.getAttribute("data-zotlook-initialized")) return;
		root.setAttribute("data-zotlook-initialized", "1");

		initKeptPreviews(root);

		for (let action of ACTIONS) {
			let button = root.querySelector("#zotlook-key-" + action.key);
			let clear = root.querySelector("#zotlook-clear-" + action.key);
			if (!button) continue;

			refresh(root, button, action);
			button.addEventListener("command", () => record(root, button, action));

			if (clear) {
				clear.addEventListener("command", () => {
					setPref(action.pref, action.default);
					refresh(root, button, action);
					refreshConflicts(root);
				});
			}
		}

		// A collision that already exists has to be visible on opening, not
		// only when something is recorded anew
		refreshConflicts(root);

		initAttachmentOrder(root);

		let reset = root.querySelector("#zotlook-reset-shortcuts");
		if (reset) {
			reset.addEventListener("command", () => {
				for (let action of ACTIONS) {
					setPref(action.pref, action.default);
					let button = root.querySelector("#zotlook-key-" + action.key);
					if (button) refresh(root, button, action);
				}
				refreshConflicts(root);
			});
		}
	}

	/** Puts the stored shortcut on the button face. */
	function refresh(root, button, action) {
		delete button.dataset.recording;
		let shortcut = zotLookUtil.parseShortcut(getPref(action.pref, action.default));
		let text = shortcut ? describe(shortcut) : "";
		button.removeAttribute("data-l10n-id");
		if (text) {
			button.setAttribute("label", text);
		} else {
			// No usable value stored — let Fluent supply the placeholder
			root.ownerDocument.l10n.setAttributes(button, "zotlook-prefs-key-unset");
		}
	}

	/**
	 * Records the next keystroke.
	 *
	 * The listener sits on the window in the capture phase, because the
	 * preferences window handles keys of its own and would otherwise consume
	 * the combination before it reaches us. keydown redraws the face as
	 * modifiers go down, keyup commits — so holding Command and then pressing Y
	 * reads naturally.
	 */
	function record(root, button, action) {
		let win = root.ownerDocument.defaultView;
		button.dataset.recording = "true";
		button.removeAttribute("data-l10n-id");
		root.ownerDocument.l10n.setAttributes(button, "zotlook-prefs-key-recording");

		let recorded = null;
		// Whether a modifier was ever seen going down. It is what makes the
		// difference between "the user pressed nothing" and "the user pressed
		// something that never got here".
		let sawModifier = false;

		let onKeyDown = (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				finish(false);
				return;
			}
			let shortcut = zotLookUtil.shortcutFromEvent(event);
			if (!shortcut) {
				sawModifier = true; // modifiers only, so far
				return;
			}
			recorded = shortcut;
			button.removeAttribute("data-l10n-id");
			button.setAttribute("label", describe(shortcut));
		};

		let onKeyUp = (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (recorded) {
				finish(true);
				return;
			}

			// Modifiers came and went, and nothing in between: the key itself
			// never arrived. A combination the system or another application
			// has claimed is taken before Zotero sees it, so this absence is
			// the only evidence there is — no registry could be consulted for
			// it, since neither macOS nor Windows publishes one. Reported as
			// what it is, an observation, not a verdict.
			if (
				sawModifier &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				!event.metaKey
			) {
				finish(false);
				showNote(root, action, "zotlook-prefs-key-unreachable");
			}
		};

		let finish = (commit) => {
			win.removeEventListener("keydown", onKeyDown, true);
			win.removeEventListener("keyup", onKeyUp, true);
			if (commit && recorded) {
				setPref(action.pref, zotLookUtil.formatShortcut(recorded));
			}
			refresh(root, button, action);
			refreshConflicts(root);
		};

		win.addEventListener("keydown", onKeyDown, true);
		win.addEventListener("keyup", onKeyUp, true);
	}

	// ── Kept previews ───────────────────────────────────────────

	/**
	 * The button that throws the kept previews away, and the figure beside it.
	 *
	 * Without the figure nobody can tell whether pressing it is worth
	 * anything, so it is shown before the button is offered and again
	 * afterwards — the second time it reads zero, which is the confirmation
	 * that the press did something.
	 */
	function initKeptPreviews(root) {
		let button = root.querySelector("#zotlook-keep-purge");
		let label = root.querySelector("#zotlook-kept-size");
		if (!button || !label) return;

		// Not the bare zotLook: this script runs in the preferences window,
		// which is handed util.js and this file and nothing else. The plugin
		// object reaches it through Zotero, the one scope both share.
		let plugin = () => Zotero.zotLook;

		let show = async () => {
			try {
				let bytes = await plugin()._keptSize();
				root.ownerDocument.l10n.setAttributes(
					label,
					"zotlook-prefs-keep-size",
					{ size: formatBytes(bytes) }
				);
				label.hidden = false;
				button.disabled = bytes === 0;
			} catch (e) {
				// Hidden rather than showing a figure that might be wrong —
				// but said out loud, because a silently empty label is what
				// hid this from view in 1.1.8
				Zotero.debug("zotLook: could not measure kept sheets: " + e);
				label.hidden = true;
			}
		};

		button.addEventListener("command", async () => {
			button.disabled = true;
			try {
				await plugin()._purgeKept();
			} catch (e) {
				Zotero.debug("zotLook: could not clear kept sheets: " + e);
			}
			await show();
		});

		show();
	}

	/** Bytes as something a person reads, in the pane's own language. */
	function formatBytes(bytes) {
		if (bytes < 1024) return bytes + " B";
		let units = ["kB", "MB", "GB"];
		let value = bytes / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return (value < 10 ? value.toFixed(1) : Math.round(value)) +
			"\u00a0" + units[unit];
	}

	// ── Attachment priority ───────────────────────────────────────────

	/**
	 * A list plus Up/Down rather than drag and drop: it is operable from the
	 * keyboard, needs no drag machinery, and matches how Firefox orders
	 * languages. The checkbox on each row switches a type off entirely, which
	 * is stored by leaving it out of the order.
	 */
	function initAttachmentOrder(root) {
		let mode = root.querySelector("#zotlook-attachment-mode");
		let list = root.querySelector("#zotlook-order-list");
		let box = root.querySelector("#zotlook-order-box");
		let up = root.querySelector("#zotlook-order-up");
		let down = root.querySelector("#zotlook-order-down");
		if (!mode || !list) return;

		let rows = () => Array.from(list.querySelectorAll(".zotlook-order-row"));
		let selected = () => list.querySelector('.zotlook-order-row[data-selected="true"]');

		let select = (row) => {
			for (let other of rows()) delete other.dataset.selected;
			if (row) {
				row.dataset.selected = "true";
				updateButtons();
			}
		};

		let updateButtons = () => {
			let byType = mode.value !== "first";
			let all = rows();
			let index = all.indexOf(selected());
			if (up) up.disabled = !byType || index <= 0;
			if (down) down.disabled = !byType || index < 0 || index >= all.length - 1;
		};

		let save = () => {
			setPref(
				"attachmentOrder",
				zotLookUtil.formatAttachmentOrder(rows().map((row) => row.dataset.type))
			);
		};

		// Draw the stored ranking. attachmentOrder completes it, so every row
		// is placed exactly once even if the stored value is partial or stale.
		let byType = new Map(rows().map((row) => [row.dataset.type, row]));
		for (let type of zotLookUtil.attachmentOrder(getPref("attachmentOrder", ""))) {
			let row = byType.get(type);
			if (row) list.appendChild(row);
		}
		for (let row of rows()) {
			row.addEventListener("mousedown", () => select(row));
			row.addEventListener("focus", () => select(row));
		}

		let move = (delta) => {
			let row = selected();
			if (!row) return;
			let all = rows();
			let index = all.indexOf(row);
			let target = index + delta;
			if (target < 0 || target >= all.length) return;
			if (delta < 0) list.insertBefore(row, all[target]);
			else list.insertBefore(all[target], row);
			select(row);
			row.focus();
			save();
		};

		if (up) up.addEventListener("command", () => move(-1));
		if (down) down.addEventListener("command", () => move(1));

		// Arrow keys move the selection, so the list is usable without a mouse
		list.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
			let all = rows();
			let index = all.indexOf(selected());
			let next = all[index + (event.key === "ArrowUp" ? -1 : 1)];
			if (!next) return;
			event.preventDefault();
			select(next);
			next.focus();
		});

		let applyMode = () => {
			let enabled = mode.value !== "first";
			if (box) box.setAttribute("disabled", String(!enabled));
			for (let row of rows()) {
				row.setAttribute("tabindex", enabled ? "0" : "-1");
			}
			updateButtons();
		};

		mode.value = getPref("attachmentMode", "type") === "first" ? "first" : "type";
		mode.addEventListener("command", () => {
			setPref("attachmentMode", mode.value);
			applyMode();
		});

		select(rows()[0]);
		applyMode();
	}

	// ── Conflicts ─────────────────────────────────────────────────────

	/**
	 * What else already answers to this keystroke.
	 *
	 * The registries below cover Zotero. Nothing publishes the shortcuts of
	 * other plugins, and macOS publishes none at all, so a clean result means
	 * "no conflict with Zotero" — which the message says plainly.
	 */
	function checkConflicts(root, currentAction, shortcut) {
		let registry = [];

		let mainWindow = Zotero.getMainWindow();
		if (mainWindow && mainWindow.document) {
			for (let el of mainWindow.document.querySelectorAll("key")) {
				let bound = zotLookUtil.shortcutFromKeyElement(el, Zotero.isMac);
				if (!bound) continue;
				let id = el.getAttribute("id") || el.getAttribute("command") || "";
				registry.push({
					shortcut: bound,
					label: "Zotero " + id.replace(/^(key_|cmd_)/, ""),
				});
			}
		}

		for (let entry of ZOTERO_JS_KEYS) {
			let bound = zotLookUtil.parseShortcut(entry.shortcut);
			if (bound) registry.push({ shortcut: bound, label: entry.label });
		}

		for (let entry of zoteroConfigurableKeys()) {
			registry.push({
				shortcut: { ctrl: false, alt: false, shift: true, meta: true, key: entry.key },
				label: "Zotero " + entry.command,
			});
		}

		for (let action of ACTIONS) {
			if (action.pref === currentAction.pref) continue;
			let other = zotLookUtil.parseShortcut(getPref(action.pref, action.default));
			if (other) registry.push({ shortcut: other, label: "zotLook " + action.key });
		}

		let conflicts = zotLookUtil.findShortcutConflicts(shortcut, registry);
		if (!conflicts.length) return null;
		return {
			shortcut: describe(shortcut),
			conflicts: conflicts.map((c) => c.label).join(", "),
		};
	}

	/** Zotero's own configurable shortcuts, all bound as Command+Shift+key. */
	function zoteroConfigurableKeys() {
		let out = [];
		try {
			let branch = "extensions.zotero.keys.";
			for (let name of Zotero.Prefs.rootBranch.getChildList(branch, {}, {})) {
				let key = Zotero.Prefs.get(name, true);
				if (typeof key === "string" && key.length === 1) {
					out.push({ command: name.substring(branch.length), key: key.toLowerCase() });
				}
			}
		} catch (e) {
			Zotero.debug("zotLook: could not read Zotero shortcut prefs: " + e);
		}
		return out;
	}

	/**
	 * The note under one shortcut row.
	 *
	 * One per row rather than one for all four: a single line under the whole
	 * group could not say which row it meant, and it only ever appeared in
	 * the moment of recording — so a collision that already existed was
	 * invisible on opening the pane.
	 */
	function showNote(root, action, id, args) {
		let el = root.querySelector("#zotlook-note-" + action.key);
		if (!el) return;
		if (!id) {
			el.hidden = true;
			el.removeAttribute("data-l10n-id");
			return;
		}
		root.ownerDocument.l10n.setAttributes(el, id, args);
		el.hidden = false;
	}

	/**
	 * Marks every row whose shortcut is already answered by something else,
	 * and clears the marks that no longer apply.
	 *
	 * Run whenever a shortcut changes and once when the pane opens, which is
	 * the point: two zotLook actions sharing a combination are not merely
	 * untidy — bindings.find() takes the first match, so one of them silently
	 * never fires, and until now nothing said so after the fact.
	 */
	function refreshConflicts(root) {
		for (let action of ACTIONS) {
			let button = root.querySelector("#zotlook-key-" + action.key);
			let shortcut = zotLookUtil.parseShortcut(
				getPref(action.pref, action.default)
			);
			let args = shortcut ? checkConflicts(root, action, shortcut) : null;
			if (button) {
				if (args) button.setAttribute("data-conflict", "true");
				else button.removeAttribute("data-conflict");
			}
			showNote(root, action, args ? "zotlook-prefs-conflict" : null, args);
		}
	}

	// ── Wait for the fragment to be inserted ──────────────────────────

	const tryInit = () => {
		let root = document.getElementById("zotlook-prefs");
		if (root) {
			init(root);
			return true;
		}
		return false;
	};

	if (!tryInit()) {
		let observer = new MutationObserver(() => {
			if (tryInit()) observer.disconnect();
		});
		observer.observe(document.documentElement, { childList: true, subtree: true });
	}
})();
