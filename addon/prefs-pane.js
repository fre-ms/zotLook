/* eslint-disable no-unused-vars */
/* global Zotero, ZotLookUtil, document, window, MutationObserver */

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
			default: ZotLookUtil.defaultShortcut(action.pref),
		})
	);

	/** Shortcut text: Mac keycap symbols there, spelled out everywhere else. */
	function describe(shortcut) {
		return ZotLookUtil.describeShortcut(shortcut, !!Zotero.isMac);
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
					showConflict(root, null);
				});
			}
		}

		initAttachmentOrder(root);

		let reset = root.querySelector("#zotlook-reset-shortcuts");
		if (reset) {
			reset.addEventListener("command", () => {
				for (let action of ACTIONS) {
					setPref(action.pref, action.default);
					let button = root.querySelector("#zotlook-key-" + action.key);
					if (button) refresh(root, button, action);
				}
				showConflict(root, null);
			});
		}
	}

	/** Puts the stored shortcut on the button face. */
	function refresh(root, button, action) {
		delete button.dataset.recording;
		let shortcut = ZotLookUtil.parseShortcut(getPref(action.pref, action.default));
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

		let onKeyDown = (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				finish(false);
				return;
			}
			let shortcut = ZotLookUtil.shortcutFromEvent(event);
			if (!shortcut) return; // modifiers only, so far
			recorded = shortcut;
			button.removeAttribute("data-l10n-id");
			button.setAttribute("label", describe(shortcut));
		};

		let onKeyUp = (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (recorded) finish(true);
		};

		let finish = (commit) => {
			win.removeEventListener("keydown", onKeyDown, true);
			win.removeEventListener("keyup", onKeyUp, true);
			if (commit && recorded) {
				setPref(action.pref, ZotLookUtil.formatShortcut(recorded));
				showConflict(root, checkConflicts(root, action, recorded));
			}
			refresh(root, button, action);
		};

		win.addEventListener("keydown", onKeyDown, true);
		win.addEventListener("keyup", onKeyUp, true);
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
				ZotLookUtil.formatAttachmentOrder(rows().map((row) => row.dataset.type))
			);
		};

		// Draw the stored ranking. attachmentOrder completes it, so every row
		// is placed exactly once even if the stored value is partial or stale.
		let byType = new Map(rows().map((row) => [row.dataset.type, row]));
		for (let type of ZotLookUtil.attachmentOrder(getPref("attachmentOrder", ""))) {
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
				let bound = ZotLookUtil.shortcutFromKeyElement(el, Zotero.isMac);
				if (!bound) continue;
				let id = el.getAttribute("id") || el.getAttribute("command") || "";
				registry.push({
					shortcut: bound,
					label: "Zotero " + id.replace(/^(key_|cmd_)/, ""),
				});
			}
		}

		for (let entry of zoteroConfigurableKeys()) {
			registry.push({
				shortcut: { ctrl: false, alt: false, shift: true, meta: true, key: entry.key },
				label: "Zotero " + entry.command,
			});
		}

		for (let action of ACTIONS) {
			if (action.pref === currentAction.pref) continue;
			let other = ZotLookUtil.parseShortcut(getPref(action.pref, action.default));
			if (other) registry.push({ shortcut: other, label: "zotLook " + action.key });
		}

		let conflicts = ZotLookUtil.findShortcutConflicts(shortcut, registry);
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

	function showConflict(root, args) {
		let el = root.querySelector("#zotlook-conflict");
		if (!el) return;
		if (!args) {
			el.hidden = true;
			return;
		}
		root.ownerDocument.l10n.setAttributes(el, "zotlook-prefs-conflict", args);
		el.hidden = false;
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
