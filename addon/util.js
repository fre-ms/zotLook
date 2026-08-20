/* eslint-disable no-unused-vars */
/* global DOMParser */

/**
 * Helpers shared by the preview builders.
 *
 * Everything here is pure string and DOM work — no Zotero, no filesystem — so
 * the parts that are easy to get subtly wrong stay easy to reason about.
 */
var ZotLookUtil = {
	/**
	 * Turns arbitrary text into a filename-safe fragment.
	 */
	safeName(str, maxLength) {
		let safe = String(str)
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.substring(0, maxLength);
		return safe || "untitled";
	},

	/**
	 * FNV-1a, rendered as hex. Only used to keep generated filenames apart.
	 */
	hashString(str) {
		let hash = 0x811c9dc5;
		for (let i = 0; i < str.length; i++) {
			hash ^= str.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	},

	// ── Parsing ───────────────────────────────────────────────────────

	/**
	 * Parses strict markup and returns a Document, or null if the parser
	 * reported an error. Returning null rather than a document full of
	 * parsererror nodes lets the caller decide what to do — epub.js retries
	 * with the lenient parser.
	 */
	parseStrict(text, mimeType) {
		let doc;
		try {
			doc = new DOMParser().parseFromString(text, mimeType);
		} catch (e) {
			return null;
		}
		if (!doc || doc.querySelector("parsererror")) return null;
		return doc;
	},

	/**
	 * Parses markup the way a browser would: never fails, always yields a
	 * document. Used for chapter files, which are XHTML in theory and
	 * frequently something looser in practice.
	 */
	parseLoose(text) {
		try {
			return new DOMParser().parseFromString(text, "text/html");
		} catch (e) {
			return null;
		}
	},

	/**
	 * An empty HTML document to assemble output in. Building the preview as a
	 * tree and serialising once at the end avoids the quoting bugs that come
	 * with concatenating markup by hand.
	 */
	newHtmlDocument() {
		return this.parseLoose(
			"<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" +
				"<title></title></head><body></body></html>"
		);
	},

	/**
	 * Parses a run of markup and returns the body element holding it.
	 *
	 * The markup is wrapped in a skeleton unless it brings its own body: a
	 * bare fragment has no body of its own, and whether the parser invents one
	 * is an engine detail not worth depending on. Zotero stores notes both
	 * ways, so both have to work.
	 *
	 * @returns {Element|null}
	 */
	parseBodyFragment(html) {
		let text = String(html);
		if (!/<body[\s>]/i.test(text)) {
			text = "<html><body>" + text + "</body></html>";
		}
		let doc = this.parseLoose(text);
		if (!doc) return null;
		return doc.body || doc.querySelector("body") || null;
	},

	/**
	 * Serialises a document built by newHtmlDocument().
	 */
	serializeHtmlDocument(doc) {
		return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML + "\n";
	},

	// ── Sanitising ────────────────────────────────────────────────────

	/**
	 * Removes anything that would execute once QuickLook renders the result.
	 * QuickLook previews HTML in a WebKit view, and the content can come from
	 * imports, group libraries or third-party epubs.
	 *
	 * Operating on the parsed tree rather than on the source text matters:
	 * a regex is defeated by nested or oddly quoted markup such as
	 * `<scr<script>ipt>`, the tree is not.
	 *
	 * @param {Element|Document} root - modified in place; also returned
	 */
	sanitize(root) {
		let doomed = root.querySelectorAll(
			"script, iframe, object, embed, link[rel~=import]"
		);
		for (let el of [...doomed]) {
			el.remove();
		}

		for (let el of [...root.querySelectorAll("*")]) {
			// Snapshot: removing an attribute mutates the live list
			for (let attr of [...el.attributes]) {
				let name = attr.name.toLowerCase();
				if (name.startsWith("on")) {
					el.removeAttribute(attr.name);
					continue;
				}
				if (
					(name === "href" ||
						name === "src" ||
						name === "xlink:href") &&
					/^\s*javascript:/i.test(attr.value)
				) {
					el.removeAttribute(attr.name);
				}
			}
		}

		return root;
	},

	// ── Attachment priority ───────────────────────────────────────────

	ATTACHMENT_TYPES: ["pdf", "epub", "html", "image", "video", "other"],

	/**
	 * The order in which attachment types are preferred, as stored: a
	 * comma-separated list of type keys. A type left out of the list is never
	 * used, which is how a type gets switched off.
	 *
	 * @returns {string[]} known types, in order, without duplicates
	 */
	parseAttachmentOrder(str) {
		if (typeof str !== "string") return [];
		let seen = new Set();
		let order = [];
		for (let part of str.split(",")) {
			let type = part.trim().toLowerCase();
			if (!this.ATTACHMENT_TYPES.includes(type) || seen.has(type)) continue;
			seen.add(type);
			order.push(type);
		}
		return order;
	},

	/**
	 * The stored order, completed into a full ranking.
	 *
	 * Every known type appears exactly once: the stored ones in their stored
	 * order, then anything the stored value does not mention. The setting is a
	 * priority, not a filter — a type further down is still used when nothing
	 * above it is present.
	 */
	attachmentOrder(str) {
		let order = this.parseAttachmentOrder(str);
		for (let type of this.ATTACHMENT_TYPES) {
			if (!order.includes(type)) order.push(type);
		}
		return order;
	},

	formatAttachmentOrder(order) {
		return (order || [])
			.filter((t) => this.ATTACHMENT_TYPES.includes(t))
			.join(",");
	},

	// ── Keyboard shortcuts ────────────────────────────────────────────

	MODIFIERS: ["Ctrl", "Alt", "Shift", "Meta"],

	// Displayed the way macOS writes them; elsewhere the names are spelled out
	MODIFIER_SYMBOLS: { Ctrl: "\u2303", Alt: "\u2325", Shift: "\u21e7", Meta: "\u2318" },
	MODIFIER_NAMES: { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Super" },

	/**
	 * The shortcut this plugin ships for each action, and the list the
	 * settings pane reads for "Restore defaults" — the pane stores an explicit
	 * value rather than clearing the preference, so its idea of the default
	 * has to be the same one. prefs.js repeats these for Gecko's preference
	 * parser, and a test holds the two together.
	 *
	 * Every one of them has to survive a window manager, which takes its own
	 * combinations before the application is asked at all. That rules out
	 * Alt+Space, the window menu on GNOME and on Windows, and it is why the
	 * contact sheet sits on Ctrl+Shift+Space: free on all three systems, where
	 * plain Ctrl+Space is the input-method toggle on two of them.
	 */
	SHORTCUT_DEFAULTS: {
		"key.preview": "Space",
		"key.notes": "Shift+Space",
		"key.contactSheet": "Ctrl+Shift+Space",
		"key.contactSheetWindow": "Shift+Alt+Space",
	},

	/** The shipped shortcut for one action, or "" if there is no such action. */
	defaultShortcut(pref) {
		return this.SHORTCUT_DEFAULTS[pref] || "";
	},

	/**
	 * Parses a stored shortcut such as "Alt+Space" or "Meta+y".
	 *
	 * The final token is read as a physical key code when it is longer than one
	 * character ("Space", "KeyY") and as a produced character otherwise ("y").
	 * That distinction matters: Space sits in the same place on every layout,
	 * whereas the key labelled Y on a QWERTZ keyboard reports code "KeyZ", so
	 * only the character identifies the shortcut the user sees on their keycaps.
	 *
	 * @returns {object|null} {ctrl, alt, shift, meta, code?, key?} or null
	 */
	parseShortcut(str) {
		if (typeof str !== "string" || !str.trim()) return null;
		let parts = str.trim().split("+").filter((p) => p !== "");
		if (parts.length === 0) return null;

		let binding = { ctrl: false, alt: false, shift: false, meta: false };
		let target = parts.pop();

		for (let part of parts) {
			let mod = this.MODIFIERS.find(
				(m) => m.toLowerCase() === part.toLowerCase()
			);
			if (!mod) return null;
			binding[mod.toLowerCase()] = true;
		}

		if (!target) return null;
		if (target.length > 1) binding.code = target;
		else binding.key = target;
		return binding;
	},

	/**
	 * The inverse of parseShortcut, for storing what the user pressed.
	 */
	formatShortcut(binding) {
		if (!binding) return "";
		let parts = this.MODIFIERS.filter((m) => binding[m.toLowerCase()]);
		let target = binding.code || binding.key;
		if (!target) return "";
		return parts.concat(target).join("+");
	},

	/**
	 * Human-readable form: "⌥Space" or "⌘Y" on macOS, "Alt+Space" elsewhere.
	 * The symbols are what a Mac user reads on their own keycaps and nothing
	 * else; on Linux and Windows they are four characters nobody can name.
	 */
	describeShortcut(binding, isMac = true) {
		if (!binding) return "";
		let held = this.MODIFIERS.filter((m) => binding[m.toLowerCase()]);
		let target = binding.code
			? binding.code.replace(/^Key/, "")
			: (binding.key || "").toUpperCase();
		if (isMac) {
			return held.map((m) => this.MODIFIER_SYMBOLS[m]).join("") + target;
		}
		return held.map((m) => this.MODIFIER_NAMES[m]).concat(target).join("+");
	},

	/**
	 * Reads a keydown event as a shortcut, or null if only modifiers are held.
	 */
	shortcutFromEvent(event) {
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return null;
		let binding = {
			ctrl: !!event.ctrlKey,
			alt: !!event.altKey,
			shift: !!event.shiftKey,
			meta: !!event.metaKey,
		};
		// Letters and digits are stored by character so the shortcut follows the
		// keycap; everything else by code, which is layout-independent.
		if (/^[a-z0-9]$/i.test(event.key)) binding.key = event.key.toLowerCase();
		else binding.code = event.code;
		return binding;
	},

	/**
	 * Whether two shortcuts would fire on the same keystroke.
	 */
	shortcutsEqual(a, b) {
		if (!a || !b) return false;
		return (
			!!a.ctrl === !!b.ctrl &&
			!!a.alt === !!b.alt &&
			!!a.shift === !!b.shift &&
			!!a.meta === !!b.meta &&
			(a.code || null) === (b.code || null) &&
			(a.key || null) === (b.key || null)
		);
	},

	/**
	 * Finds what else already answers to a shortcut.
	 *
	 * The caller supplies the registries, which keeps this testable and honest
	 * about its reach: Zotero publishes no list of plugin shortcuts, and macOS
	 * publishes none at all, so a clean result means "no conflict with Zotero",
	 * not "free".
	 *
	 * @param {object} binding - as returned by parseShortcut
	 * @param {object[]} registry - [{shortcut, label}] to test against
	 * @returns {object[]} the entries that collide
	 */
	findShortcutConflicts(binding, registry) {
		if (!binding) return [];
		return (registry || []).filter((entry) =>
			this.shortcutsEqual(binding, entry.shortcut)
		);
	},

	/**
	 * Converts one of Zotero's XUL <key> elements into a shortcut.
	 * "accel" is Cmd on macOS. Elements without a key or keycode are skipped.
	 */
	shortcutFromKeyElement(el, isMac = true) {
		let modifiers = (el.getAttribute("modifiers") || "")
			.split(/[\s,]+/)
			.filter((m) => m);
		let binding = {
			ctrl: modifiers.includes("control") ||
				(!isMac && modifiers.includes("accel")),
			alt: modifiers.includes("alt"),
			shift: modifiers.includes("shift"),
			meta: modifiers.includes("meta") ||
				(isMac && modifiers.includes("accel")),
		};

		let key = el.getAttribute("key");
		let keycode = el.getAttribute("keycode");
		if (key) binding.key = key.toLowerCase();
		else if (keycode) binding.code = keycode.replace(/^VK_/, "");
		else return null;
		return binding;
	},

	// ── Local URL resolution ──────────────────────────────────────────

	/**
	 * Resolves a document-relative URL against a directory on disk and returns
	 * an absolute file:// URL, or null if the URL is already absolute, points
	 * at a scheme we must not follow, or cannot be resolved.
	 *
	 * Files extracted from an epub are previewed from a temp directory, so
	 * every relative reference has to be rewritten for images, fonts and
	 * stylesheets to load.
	 */
	resolveFileUrl(url, baseDir) {
		if (/^(https?:|data:|file:|mailto:|tel:|javascript:|#)/i.test(url)) {
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
			let encoded = absPath.split("/").map(encodeURIComponent).join("/");
			return "file://" + encoded + fragment;
		} catch (e) {
			return null;
		}
	},

	/**
	 * Rewrites url(...) references inside a stylesheet or a style attribute.
	 * CSS has no DOM here, so this one stays textual.
	 */
	rewriteCssUrls(css, baseDir) {
		return String(css).replace(
			/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
			(match, quote, url) => {
				let resolved = this.resolveFileUrl(url, baseDir);
				if (resolved === null) return match;
				return 'url("' + resolved + '")';
			}
		);
	},
};
