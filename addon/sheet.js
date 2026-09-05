/* global Zotero */

// The contact sheet's markup and the sizing behind it — and the two corner
// menus the EPUB preview and both page sheets share.
//
// Kept apart from the rendering so that the grid, the labels and the reader
// links can be changed and tested without a PDF anywhere in sight.

var zotLookSheet = {
	/** Thumbnail width for a single column, before the column count widens it. */
	BASE_WIDTH: 500,

	/** The window's title; the host writes the locale's in. */
	TITLE: "Contact Sheet",
	/** The collection sheet's title, likewise. */
	COLLECTION_TITLE: "Collection Sheet",
	/** What a tile says when the item has no page to show. */
	NO_PAGE_LABEL: "No PDF",
	/** Heading of the contents menu; the host writes the locale's in. */
	TOC_LABEL: "Contents",
	/**
	 * Jumping to a page without navigating there.
	 *
	 * The menus jump by fragment — `#p22` — which is a navigation, and in
	 * Zotero's own window that is one navigation too many: the sheet is a
	 * file: document loaded in a browser that may switch process for it, and
	 * the fragment click comes back out through the window's browser shim as
	 * a file load for something to open. What the reader sees is a dialog
	 * asking which application should handle file links. The system previews
	 * do not ask, so it took the window to show it.
	 *
	 * So the jump is done rather than navigated to: the click is answered,
	 * the tile scrolled to, and the outline that :target would have drawn is
	 * put on as a class instead. Nothing here is required — with scripts off,
	 * as in macOS Quick Look, the anchors are ordinary anchors and jump the
	 * way they always did. This only takes the navigation out of the way
	 * where a script can run.
	 *
	 * Only same-page fragments: a page tile's link goes to the reader and
	 * must stay a real navigation.
	 *
	 * The menu the entry sits in stays open afterwards, so that the next
	 * entry is a click away — the menus are for finding one's way about a
	 * document, and one place is rarely the last. The sheet says otherwise
	 * in data-zl-menu-mouse="close" on its root, from the preference, and
	 * then the menu folds on the jump.
	 *
	 * The reader links get one thing done for them too. Zotero's viewer
	 * window runs an actor that takes every click whose target is the
	 * anchor itself and hands the address to the system — for an http
	 * link the browser, for a zotero: link a dialogue asking whether Zotero
	 * may open it. A tile's click lands on its picture, not on the anchor,
	 * and passes; a text link such as an annotation's "Open in the reader"
	 * does not. The actor sees only trusted events, so a real click on a
	 * zotero: link is stopped here and sent again as a synthetic one, which
	 * takes the road the keyboard's o takes: Zotero's own protocol handler,
	 * and the reader.
	 */
	JUMP_SCRIPT: [
		'<script>',
		"document.addEventListener('click', function (event) {",
		"  if (event.isTrusted && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {",
		"    var reader = event.target.closest && event.target.closest('a[href^=\"zotero:\"]');",
		"    if (reader && event.target.localName === 'a') {",
		"      event.preventDefault();",
		"      event.stopPropagation();",
		"      reader.click();",
		"      return;",
		"    }",
		"  }",
		"  var link = event.target.closest && event.target.closest('a[href^=\"#\"]');",
		"  if (!link || event.defaultPrevented) return;",
		"  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;",
		"  var id = decodeURIComponent(link.getAttribute('href').slice(1));",
		"  var target = id && document.getElementById(id);",
		"  if (!target) return;",
		"  event.preventDefault();",
		"  var marked = document.querySelector('.zl-current');",
		"  if (marked) marked.classList.remove('zl-current');",
		"  target.classList.add('zl-current');",
		"  if (target.scrollIntoView) target.scrollIntoView({ block: 'start' });",
		"  if (document.documentElement.getAttribute('data-zl-menu-mouse') === 'close') {",
		"    var menu = link.closest('details.zl-toc, details.zl-annotations');",
		"    if (menu) menu.removeAttribute('open');",
		"  }",
		"});",
		"</script>",
		"",
	].join("\n"),

	/** Placeholder of the search field, and what it says with no match. */
	SEARCH_LABEL: "Search pages",
	SEARCH_NONE: "No matches",
	/** Placeholder of the page field, and what it says for a page not there. */
	GOTO_LABEL: "Page",
	GOTO_NONE: "No such page",
	/** "12 pages", the count beside the field. */
	PAGES_LABEL: "pages",
	/** The link that opens the reader at an annotation. */
	OPEN_LABEL: "Open in the reader",

	// ── Search ────────────────────────────────────────────────────────
	//
	// A search field needs a script, and a preview panel runs none. So the
	// field is in the markup and hidden, and the script that wires it up
	// also reveals it: where scripts run — the sheet in its own Zotero
	// window — there is a search; where they do not, nothing suggests one.
	//
	// The PDF sheet stores each page's text in a JSON block; the EPUB sheet
	// needs none, its tiles are the text. Typing dims the pages without a
	// match, counts the hits on the ones with, marks them in a book's
	// tiles, and brings the first to the middle; Enter walks on.
	SEARCH_CSS: [
		// The page field, the search field's mirror image in the other top
		// corner: a page number typed and Enter frames that page — the
		// printed number first, the one a citation gives, the tile's own
		// number where the document has no printed ones
		".zl-goto {",
		"  display: none;",
		"  position: fixed;",
		"  top: 16px;",
		"  left: 24px;",
		"  z-index: 20;",
		"  align-items: center;",
		"  gap: 0.6em;",
		"  padding: 0.35em 0.6em;",
		"  background: #ffffff;",
		"  border-radius: 999px;",
		"  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);",
		"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
		"  font-size: 14px;",
		"}",
		"html.zl-scripted .zl-goto { display: flex; }",
		".zl-goto input {",
		"  width: 7em;",
		"  border: none;",
		"  outline: none;",
		"  font: inherit;",
		"  background: transparent;",
		"}",
		".zl-goto-status { color: #4a4a4a; white-space: nowrap; }",
		".zl-search {",
		"  display: none;",
		"  position: fixed;",
		"  top: 16px;",
		"  right: 24px;",
		"  z-index: 20;",
		"  align-items: center;",
		"  gap: 0.6em;",
		"  padding: 0.35em 0.6em;",
		"  background: #ffffff;",
		"  border-radius: 999px;",
		"  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);",
		"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
		"  font-size: 14px;",
		"}",
		"html.zl-scripted .zl-search { display: flex; }",
		".zl-search input {",
		"  width: 14em;",
		"  border: none;",
		"  outline: none;",
		"  font: inherit;",
		"  background: transparent;",
		"}",
		".zl-search-status { color: #4a4a4a; white-space: nowrap; }",
		".zl-miss { opacity: 0.3; }",
		// A tile outside the page range asked for: gone from the grid, so
		// that the range can have the room
		".zl-out { display: none !important; }",
		".zl-hit-count {",
		"  display: inline-block;",
		"  margin-left: 0.5em;",
		"  padding: 0 0.5em;",
		"  border-radius: 999px;",
		"  background: #f5b841;",
		"  color: #1f2a33;",
		"  font-weight: 600;",
		"}",
		"mark.zl-hit { background: #f5b841; color: inherit; }",
		// The entry the keyboard stands on in an open menu
		"a.zl-menu-current { background: #e6f0ef; box-shadow: inset 3px 0 0 #2e8b84; }",
		// The fields in the dark
		"@media (prefers-color-scheme: dark) {",
		"  .zl-search, .zl-goto { background: #262a30; color: #e8eaed; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.6); }",
		"  .zl-search input, .zl-goto input { color: #e8eaed; }",
		"  .zl-search-status, .zl-goto-status { color: #b8bcc2; }",
		"}",
	].join("\n"),

	/**
	 * The page field, as a string. The placeholder names the range, "Page
	 * 1–58" — printed numbers where the document has them, so a reader
	 * sees what kind of number is asked for.
	 *
	 * @param {string} [range] what the placeholder says after the word
	 */
	gotoBoxHtml(range) {
		let hint = this.GOTO_LABEL + (range ? " " + range : "");
		return (
			'<div class="zl-goto"><input type="text" class="zl-goto-input"' +
			' autocomplete="off" spellcheck="false" inputmode="numeric" placeholder="' +
			this.escape(hint) + '" aria-label="' + this.escape(this.GOTO_LABEL) +
			'"><span class="zl-goto-status"></span></div>\n'
		);
	},

	/** The field, as a string; the EPUB sheet builds the same as DOM. */
	searchBoxHtml() {
		return (
			'<div class="zl-search"><input type="search" class="zl-search-input"' +
			' autocomplete="off" spellcheck="false" placeholder="' +
			this.escape(this.SEARCH_LABEL) + '" aria-label="' +
			this.escape(this.SEARCH_LABEL) +
			'"><span class="zl-search-status"></span></div>\n'
		);
	},

	/**
	 * The pages' text, one JSON block. "</" is written as "<\/" so that a
	 * page which happens to say </script> cannot close the block early.
	 */
	textsHtml(pages) {
		let texts = {};
		for (let entry of pages || []) {
			if (entry.text) texts[String(entry.page)] = entry.text;
		}
		if (!Object.keys(texts).length) return "";
		return (
			'<script type="application/json" id="zl-texts">' +
			JSON.stringify(texts).replace(/<\//g, "<\\/") +
			"</script>\n"
		);
	},

	/**
	 * What runs in the page: the search, and the keyboard.
	 *
	 * Written as a function so that the tests can run it against a document
	 * of their own; the page gets its source. Nothing here is required:
	 * without it the field stays hidden and the sheet is what it was.
	 *
	 * The frame is a cursor. Enter moves it to the next page — the first, on
	 * the first press — or, with a search in the field, to the next hit;
	 * Shift+Enter back; the arrows move it across the grid, a row at a time
	 * up and down. With a search the arrows keep their directions: left and
	 * right go hit by hit, up and down to the nearest row above or below that
	 * has a hit, closest column first — walking the hits in reading order on
	 * every arrow made up and down feel like sideways, which is what was
	 * reported. o, or Ctrl/⌘+Enter, opens the framed page in the reader,
	 * which is a click on its link, so the window closes on the handoff as
	 * it does for the mouse. c and a open the contents and the annotations,
	 * where the arrows walk the entries and Enter or o follows one. Digits
	 * and Enter frame a page by its number; Backspace takes the page and
	 * its range back, and then the search; plus and minus change the
	 * columns on the spot; p prints. Page Up and Page Down are left to the
	 * browser: they scroll. In the field, a letter is typing and the arrows
	 * left and right move the caret; Enter
	 * there walks on and hands the keyboard back to the page, so that the
	 * next o opens rather than types, and Ctrl+F is the way back in.
	 *
	 * @param {Document} document
	 * @param {{pages: string, none: string, gotoNone?: string,
	 *   commandDelay?: number}} labels
	 */
	sheetRuntime(document, labels) {
		document.documentElement.classList.add("zl-scripted");
		let tiles = Array.prototype.slice.call(
			document.querySelectorAll("[data-zl-tile]"));
		let box = document.querySelector(".zl-search");
		let input = box && box.querySelector("input");
		let status = box && box.querySelector(".zl-search-status");
		let say = (text) => {
			if (status) status.textContent = text;
		};
		let gotoBox = document.querySelector(".zl-goto");
		let gotoInput = gotoBox && gotoBox.querySelector("input");
		let gotoStatus = gotoBox && gotoBox.querySelector(".zl-goto-status");
		// A tile's printed page number, where the document has them
		let labelOf = (tile) => {
			let own = tile.getAttribute("data-zl-label");
			if (own) return own;
			let el = tile.querySelector(".epub-page-label");
			return el ? el.textContent.trim() : "";
		};

		let texts = {};
		let json = document.getElementById("zl-texts");
		if (json) {
			try {
				texts = JSON.parse(json.textContent);
			} catch {
				texts = {};
			}
		}
		let norm = (value) => String(value).toLowerCase().replace(/\s+/g, " ");
		let textOf = (tile) => {
			let id = tile.getAttribute("data-zl-tile");
			if (Object.prototype.hasOwnProperty.call(texts, id)) return texts[id];
			let inner = tile.querySelector(".epub-paper-inner");
			return inner ? inner.textContent : "";
		};
		let count = (text, query) => {
			let n = 0;
			for (let i = text.indexOf(query); i !== -1; i = text.indexOf(query, i + query.length)) n++;
			return n;
		};

		// The marks a book's tiles carry are undone before the next query:
		// each mark becomes text again, and neighbouring text nodes are
		// joined, so that a phrase a mark had cut in two is whole for the
		// next search. Done by hand rather than with splitText and
		// normalize, so that the same function runs in the tests' DOM.
		let unmark = () => {
			for (let tile of tiles) {
				tile.classList.remove("zl-miss");
				let badge = tile.querySelector(".zl-hit-count");
				if (badge) badge.parentNode.removeChild(badge);
				let marks = Array.prototype.slice.call(tile.querySelectorAll("mark.zl-hit"));
				for (let mark of marks) {
					let parent = mark.parentNode;
					let text = document.createTextNode(mark.textContent);
					parent.replaceChild(text, mark);
					let prev = text.previousSibling;
					let next = text.nextSibling;
					let joined = (prev && prev.nodeType === 3 ? prev.nodeValue : "") +
						text.nodeValue +
						(next && next.nodeType === 3 ? next.nodeValue : "");
					if (prev && prev.nodeType === 3) parent.removeChild(prev);
					if (next && next.nodeType === 3) parent.removeChild(next);
					parent.replaceChild(document.createTextNode(joined), text);
				}
			}
		};
		// Marks within one text node only, which is where a phrase lives:
		// the node is replaced by its pieces, text and mark by turns
		let markIn = (root, query) => {
			let nodes = [];
			let walk = (node) => {
				for (let child of Array.prototype.slice.call(node.childNodes)) {
					if (child.nodeType === 3) nodes.push(child);
					else if (child.nodeType === 1) walk(child);
				}
			};
			walk(root);
			for (let node of nodes) {
				let data = node.nodeValue;
				let lower = data.toLowerCase();
				let at = lower.indexOf(query);
				if (at === -1) continue;
				let parent = node.parentNode;
				let from = 0;
				while (at !== -1) {
					if (at > from) {
						parent.insertBefore(document.createTextNode(data.slice(from, at)), node);
					}
					let mark = document.createElement("mark");
					mark.className = "zl-hit";
					mark.textContent = data.slice(at, at + query.length);
					parent.insertBefore(mark, node);
					from = at + query.length;
					at = lower.indexOf(query, from);
				}
				if (from < data.length) {
					parent.insertBefore(document.createTextNode(data.slice(from)), node);
				}
				parent.removeChild(node);
			}
		};

		// ── the frame: a cursor over the pages, or over the hits ──────
		let hits = null;           // null: no search, every page is in play
		let at = -1;               // the framed one, -1 for none yet
		let inRange = (tile) => !tile.classList.contains("zl-out");
		let shown = () => tiles.filter(inRange);
		let current = () => hits || shown();
		let frame = (index) => {
			let items = current();
			if (!items.length) return;
			at = ((index % items.length) + items.length) % items.length;
			for (let tile of tiles) tile.classList.remove("zl-current");
			items[at].classList.add("zl-current");
			if (items[at].scrollIntoView) items[at].scrollIntoView({ block: "center" });
			say(hits ? at + 1 + " / " + hits.length : "");
		};
		// The frame can be put on a tile by the jump script as well — a menu
		// entry followed by mouse or by Enter — and the cursor takes it from
		// there: what is framed on the page is what the keys work on.
		let sync = () => {
			let items = current();
			for (let i = 0; i < items.length; i++) {
				if (items[i].classList.contains("zl-current")) return (at = i);
			}
			return (at = -1);
		};
		let step = (delta) => {
			sync();
			if (at < 0) frame(delta > 0 ? 0 : -1);
			else frame(at + delta);
		};
		// The PDF sheet says how many columns it has; a book's overview
		// fills what fits, so it is measured off the first row
		let columns = () => {
			let grid = document.querySelector("[data-zl-columns]");
			let stated = grid && Number(grid.getAttribute("data-zl-columns"));
			if (stated > 0) return stated;
			let n = 0;
			for (let tile of tiles) {
				if (tile.offsetTop === tiles[0].offsetTop) n++;
				else break;
			}
			return n || 1;
		};
		// Up and down under a search: the nearest row in that direction that
		// holds a hit, and in it the hit nearest the column the frame is in;
		// round the end, the first or the last such row. The hits are in
		// reading order, so a row's hits sit together in the list.
		let stepRow = (dir) => {
			sync();
			let items = current();
			if (!items.length) return;
			if (at < 0) {
				frame(dir > 0 ? 0 : -1);
				return;
			}
			let n = columns();
			let laid = shown();
			let rowOf = (tile) => Math.floor(laid.indexOf(tile) / n);
			let colOf = (tile) => laid.indexOf(tile) % n;
			let row = rowOf(items[at]);
			let col = colOf(items[at]);
			let nearer = (a, b) => (dir > 0 ? a < b : a > b);
			let target = null;
			for (let i = 0; i < items.length; i++) {
				let r = rowOf(items[i]);
				if (dir > 0 ? r <= row : r >= row) continue;
				if (target === null || nearer(r, target)) target = r;
			}
			if (target === null) {
				for (let i = 0; i < items.length; i++) {
					let r = rowOf(items[i]);
					if (target === null || nearer(r, target)) target = r;
				}
			}
			let best = -1;
			let distance = Infinity;
			for (let i = 0; i < items.length; i++) {
				if (rowOf(items[i]) !== target) continue;
				let d = Math.abs(colOf(items[i]) - col);
				if (d < distance) {
					distance = d;
					best = i;
				}
			}
			if (best >= 0) frame(best);
		};
		let click = (el) => {
			if (typeof el.click === "function") {
				el.click();
			} else {
				let event = document.createEvent("Event");
				event.initEvent("click", true, true);
				el.dispatchEvent(event);
			}
		};
		// Opening is the click the mouse would make on the page's link
		let open = () => {
			let items = current();
			sync();
			if (at < 0 || !items[at]) return;
			let link = items[at].querySelector("a[href]");
			if (link) click(link);
		};

		let run = () => {
			let query = input ? norm(input.value).trim() : "";
			unmark();
			for (let tile of tiles) tile.classList.remove("zl-current");
			at = -1;
			if (!query) {
				hits = null;
				say("");
				return;
			}
			hits = [];
			for (let tile of tiles) {
				if (!inRange(tile)) continue;
				let n = count(norm(textOf(tile)), query);
				if (!n) {
					tile.classList.add("zl-miss");
					continue;
				}
				hits.push(tile);
				let label = tile.querySelector(".label, .epub-page-label");
				if (label) {
					let badge = document.createElement("span");
					badge.className = "zl-hit-count";
					badge.textContent = String(n);
					label.appendChild(badge);
				}
				let inner = tile.querySelector(".epub-paper-inner");
				if (inner) markIn(inner, query);
			}
			if (hits.length) frame(0);
			else say(labels.none);
		};
		if (input) input.addEventListener("input", run);

		// A query brought along in the fragment — #zl-q=word — is what was
		// in Zotero's own search field when the window was opened: the
		// word the reader was looking for is what the sheet searches first
		let brought = "";
		try {
			let view = document.defaultView;
			let hash = String((view && view.location && view.location.hash) ||
				(document.location && document.location.hash) || "");
			let m = /[#&]zl-q=([^&]*)/.exec(hash);
			if (m) brought = decodeURIComponent(m[1]);
		} catch {
			brought = "";
		}
		if (brought && input) {
			input.value = brought;
			run();
		}

		// ── the columns, live ─────────────────────────────────────────
		// Plus and minus change the grid on the spot. The sheet's own count
		// stays what the preferences say; this is for the one at hand
		let recolumn = (delta, absolute) => {
			let grid = /** @type {HTMLElement|null} */ (document.querySelector("[data-zl-columns]"));
			if (!grid) return;
			let n = Math.max(1, Math.min(12, absolute ? delta : columns() + delta));
			grid.setAttribute("data-zl-columns", String(n));
			grid.style.gridTemplateColumns = "repeat(" + n + ", 1fr)";
			sync();
			if (at >= 0 && current()[at] && current()[at].scrollIntoView) {
				current()[at].scrollIntoView({ block: "center" });
			}
		};

		// ── a page by its number ──────────────────────────────────────
		// Digits typed outside the field gather for a moment; Enter frames
		// that page, whatever the search says, and the status shows the
		// number as it grows
		let digits = "";
		let digitsTimer = null;
		let clearDigits = () => {
			digits = "";
			if (digitsTimer !== null) clearTimeout(digitsTimer);
			digitsTimer = null;
			if (!hits) say("");
			else say(at >= 0 ? at + 1 + " / " + hits.length : "");
		};
		let takeDigit = (d) => {
			// With a page field on the sheet the digits go there, where
			// they can be seen and corrected, and Enter is the field's
			if (gotoInput) {
				gotoInput.focus();
				gotoInput.value = (gotoInput.value || "") + d;
				return;
			}
			digits += d;
			say("→ " + digits);
			if (digitsTimer !== null) clearTimeout(digitsTimer);
			digitsTimer = setTimeout(clearDigits, 2000);
		};
		// ── letters typed on the sheet ────────────────────────────────
		// A word typed goes into the search field as if the field had the
		// keyboard. Four letters are commands — o, c, a, p — so one of them
		// waits a moment: another letter on its heels makes the two a word
		// for the search; anything else, or nothing, runs the command.
		let COMMANDS = { o: true, c: true, a: true, p: true };
		let pendingLetter = null;
		let pendingTimer = null;
		let commandDelay = Number(labels.commandDelay) > 0 ? Number(labels.commandDelay) : 350;
		let typeInto = (text) => {
			if (!input) return false;
			input.focus();
			input.value = (input.value || "") + text;
			run();
			return true;
		};
		let runCommand = (letter) => {
			if (letter === "o") {
				if (!follow(true)) open();
			} else if (letter === "c" || letter === "a") {
				toggle(MENUS[letter]);
			} else if (letter === "p") {
				let view = document.defaultView;
				if (view && typeof view.print === "function") view.print();
			}
		};
		let flushPending = () => {
			if (pendingLetter === null) return;
			let letter = pendingLetter;
			pendingLetter = null;
			if (pendingTimer !== null) clearTimeout(pendingTimer);
			pendingTimer = null;
			runCommand(letter);
		};
		let holdLetter = (letter) => {
			pendingLetter = letter;
			if (pendingTimer !== null) clearTimeout(pendingTimer);
			pendingTimer = setTimeout(flushPending, commandDelay);
		};
		// The page asked for by its number: the printed number first, which
		// is what a citation gives; then the tile's own, which is what the
		// label under a tile without printed numbers shows. Not on a book's
		// overview: there every tile is a printed page, its own number is
		// a mere position, and 13 asked for with no page 13 marked is no
		// page rather than the thirteenth tile of the front matter
		let findPage = (wanted) => {
			let want = String(wanted || "").trim().toLowerCase();
			if (!want) return null;
			let byLabel = tiles.find((t) => labelOf(t).toLowerCase() === want);
			if (byLabel) return byLabel;
			if (document.querySelector("[data-zl-scale]")) return null;
			return tiles.find((t) => t.getAttribute("data-zl-tile") === want) || null;
		};
		// ── a page range ──────────────────────────────────────────────
		// "12–18" in the page field: the tiles outside go out of the grid,
		// and the columns are set so that the range fits the window without
		// scrolling — the smallest count whose rows all fit, from the
		// window's size and the tiles' proportion; twelve at most, and then
		// the rest scrolls. An empty field and Enter end the range and bring
		// the count from before back. Not Escape: in the Zotero window that
		// key closes the window before the page ever sees it.
		let columnsBefore = null;
		let fitColumns = (n) => {
			let root = document.documentElement;
			let W = root ? root.clientWidth : 0;
			let H = root ? root.clientHeight : 0;
			if (!W || !H || !n) return 0;
			let sample = tiles.find(inRange) || tiles[0];
			let img = sample && sample.querySelector("img");
			let iw = img && Number(img.getAttribute("width"));
			let ih = img && Number(img.getAttribute("height"));
			let ratio = iw && ih ? ih / iw : 1.3;
			for (let c = 1; c <= 12; c++) {
				let rows = Math.ceil(n / c);
				let tileW = (W - 24 - 12 * (c - 1)) / c;
				let tileH = tileW * ratio + 21;
				if (rows * tileH + 12 * (rows - 1) + 24 <= H) return c;
			}
			return 12;
		};
		// A book's overview has no column count to set: its tiles are of one
		// fixed size and fill what fits. There the range grows the tiles
		// instead — the grid says data-zl-scale, and every length of a tile
		// hangs off the --zl-scale variable the runtime sets on it. The
		// factor is the largest at which some column count fits the range
		// into the window: the paper is 210 by 297, its label 24 below, the
		// gaps 22 by 26 and the body's padding 24 a side, as the EPUB
		// module's styles say. Not below the thumbnail, and not beyond
		// reading size, which the thumbnail is three and a third of.
		let scaleGrid = () =>
			/** @type {HTMLElement|null} */ (document.querySelector("[data-zl-scale]"));
		let fitScale = (n) => {
			let root = document.documentElement;
			let W = root ? root.clientWidth : 0;
			let H = root ? root.clientHeight : 0;
			if (!W || !H || !n) return 0;
			let best = 0;
			for (let c = 1; c <= Math.min(n, 12); c++) {
				let rows = Math.ceil(n / c);
				let byWidth = (W - 48 - 22 * (c - 1)) / (210 * c);
				let byHeight = (H - 48 - 26 * (rows - 1) - 24 * rows) / (297 * rows);
				best = Math.max(best, Math.min(byWidth, byHeight));
			}
			return Math.max(1, Math.min(best, 10 / 3));
		};
		let setScale = (factor) => {
			let grid = scaleGrid();
			if (!grid) return;
			let value = factor && factor !== 1 ? String(Math.round(factor * 100) / 100) : "1";
			grid.setAttribute("data-zl-scale", value);
			grid.style.setProperty("--zl-scale", value);
		};
		let clearRange = () => {
			for (let t of tiles) t.classList.remove("zl-out");
			if (columnsBefore !== null) {
				recolumn(columnsBefore, true);
				columnsBefore = null;
			}
			setScale(1);
			if (input && input.value) run();
		};
		let setRange = (fromText, toText) => {
			let from = findPage(fromText);
			let to = findPage(toText);
			if (!from || !to) return false;
			let a = tiles.indexOf(from);
			let b = tiles.indexOf(to);
			if (a > b) [a, b] = [b, a];
			for (let t of tiles) t.classList.remove("zl-out");
			tiles.forEach((t, i) => {
				if (i < a || i > b) t.classList.add("zl-out");
			});
			if (scaleGrid()) {
				setScale(fitScale(b - a + 1));
			} else {
				if (columnsBefore === null) columnsBefore = columns();
				let fit = fitColumns(b - a + 1);
				if (fit) recolumn(fit, true);
			}
			if (input && input.value) run();
			for (let t of tiles) t.classList.remove("zl-current");
			tiles[a].classList.add("zl-current");
			if (tiles[a].scrollIntoView) tiles[a].scrollIntoView({ block: "start" });
			sync();
			return true;
		};
		let frameTile = (n) => {
			let tile = findPage(n);
			if (!tile) return false;
			for (let t of tiles) t.classList.remove("zl-current");
			tile.classList.add("zl-current");
			if (tile.scrollIntoView) tile.scrollIntoView({ block: "center" });
			sync();
			return true;
		};

		// ── the two menus, from the keyboard ──────────────────────────
		let MENUS = { c: "details.zl-toc", a: "details.zl-annotations" };
		let menuAt = -1;
		let openMenu = () =>
			document.querySelector("details.zl-toc[open], details.zl-annotations[open]");
		let entries = (menu) =>
			Array.prototype.slice.call(menu.querySelectorAll("a[href^='#']"));
		let highlight = (menu, index) => {
			let links = entries(menu);
			if (!links.length) return;
			menuAt = ((index % links.length) + links.length) % links.length;
			for (let link of links) link.classList.remove("zl-menu-current");
			let link = links[menuAt];
			link.classList.add("zl-menu-current");
			// an annotation's link sits in a fold; the fold opens with it
			let fold = link.closest && link.closest("details.zl-annotation-entry");
			if (fold) fold.setAttribute("open", "");
			if (link.scrollIntoView) link.scrollIntoView({ block: "nearest" });
		};
		let closeMenu = (menu) => {
			for (let link of entries(menu)) link.classList.remove("zl-menu-current");
			menu.removeAttribute("open");
			menuAt = -1;
		};
		let toggle = (selector) => {
			let menu = document.querySelector(selector);
			if (!menu) return;
			let other = openMenu();
			if (other && other !== menu) closeMenu(other);
			if (menu.hasAttribute("open")) {
				closeMenu(menu);
			} else {
				menu.setAttribute("open", "");
				highlight(menu, 0);
			}
		};
		// Following an entry is the click, which the jump script answers.
		// The menu stays open, the entry still highlighted, so that the
		// arrows go on to the next one and Enter follows that — unless the
		// sheet says data-zl-menu-keyboard="close" on its root, from the
		// preference; then the menu folds so that the page can be seen.
		// Enter goes to the page; o, where the entry has a link into the
		// reader — an annotation's — goes there instead, to the annotation
		// itself, and the window goes with it
		let menuStays = () =>
			document.documentElement.getAttribute("data-zl-menu-keyboard") !== "close";
		let follow = (toReader) => {
			let menu = openMenu();
			if (!menu) return false;
			let link = entries(menu)[menuAt];
			if (!link) return false;
			if (toReader) {
				let scope = link.parentNode;
				let into = scope && scope.querySelector
					? scope.querySelector("a.zl-annotation-open") : null;
				if (into) link = into;
			}
			click(link);
			if (toReader || !menuStays()) closeMenu(menu);
			return true;
		};

		document.addEventListener("keydown", (event) => {
			let key = String(event.key || "");
			let chord = event.ctrlKey || event.metaKey;
			let inGoto = !!gotoInput && event.target === gotoInput;
			let inField = (!!input && event.target === input) || inGoto;
			if (chord && key === "Enter") {
				event.preventDefault();
				if (!follow(true)) open();
				return;
			}
			if (chord && key.toLowerCase() === "f" && input) {
				event.preventDefault();
				input.focus();
				if (input.select) input.select();
				return;
			}
			if (chord && key.toLowerCase() === "g" && gotoInput) {
				event.preventDefault();
				gotoInput.focus();
				if (gotoInput.select) gotoInput.select();
				return;
			}
			// The page field: Enter frames the page and hands the keyboard
			// back to the page, so that o opens it; a page not there is
			// said beside the field
			if (inGoto && key === "Enter") {
				event.preventDefault();
				let asked = String(gotoInput.value || "").trim();
				let span = /^(.+?)\s*[-–—]\s*(.+)$/.exec(asked);
				let done;
				if (!asked) {
					clearRange();
					done = true;
				} else if (span) {
					done = setRange(span[1], span[2]);
				} else {
					done = frameTile(asked);
				}
				if (done) {
					if (gotoStatus) gotoStatus.textContent = "";
					if (hits) say(at >= 0 ? at + 1 + " / " + hits.length : "");
					if (typeof gotoInput.blur === "function") gotoInput.blur();
				} else if (gotoStatus) {
					gotoStatus.textContent = labels.gotoNone || "";
				}
				return;
			}
			if (inGoto && gotoStatus && gotoStatus.textContent) gotoStatus.textContent = "";
			if (chord || event.altKey) return;
			let menu = openMenu();
			if (key === "Enter" && digits && !inField) {
				event.preventDefault();
				let n = digits;
				clearDigits();
				if (frameTile(n) && hits) {
					say(at >= 0 ? at + 1 + " / " + hits.length : "");
				}
				return;
			}
			if (key === "Enter") {
				event.preventDefault();
				if (menu) follow();
				else step(event.shiftKey ? -1 : 1);
				// Enter in the field hands the keyboard back to the page:
				// what follows is navigation, not typing — o opens, the
				// arrows move — and Ctrl+F is the way back into the field
				if (inField && typeof input.blur === "function") input.blur();
				return;
			}
			let vertical = key === "ArrowDown" || key === "ArrowUp";
			let horizontal = key === "ArrowRight" || key === "ArrowLeft";
			if (vertical || horizontal) {
				if (inField && horizontal) return;   // the caret's business
				event.preventDefault();
				let forward = key === "ArrowDown" || key === "ArrowRight";
				if (menu) {
					highlight(menu, menuAt + (forward ? 1 : -1));
					return;
				}
				if (horizontal || !hits) {
					let stride = horizontal ? 1 : columns();
					step(forward ? stride : -stride);
					return;
				}
				stepRow(forward ? 1 : -1);
				return;
			}
			if (inField) return;                     // letters are typing
			let printable = key.length === 1 && !event.altKey;
			// A command letter held a moment ago: a letter after it makes
			// a word for the search; any other key runs the command first
			if (pendingLetter !== null) {
				if (printable && /^\p{L}$/u.test(key)) {
					event.preventDefault();
					let first = pendingLetter;
					pendingLetter = null;
					if (pendingTimer !== null) clearTimeout(pendingTimer);
					pendingTimer = null;
					typeInto(first + key);
					return;
				}
				flushPending();
			}
			// Backspace, outside the fields, takes back what was asked for:
			// the page field with its range and the frame first; then, with
			// that empty, the search. Two presses and the sheet is as it
			// opened. Delete does the same
			if (key === "Backspace" || key === "Delete") {
				event.preventDefault();
				let hadPage = (gotoInput && gotoInput.value) || tiles.some((t) => t.classList.contains("zl-out")) ||
					tiles.some((t) => t.classList.contains("zl-current"));
				if (hadPage) {
					if (gotoInput) gotoInput.value = "";
					if (gotoStatus) gotoStatus.textContent = "";
					clearRange();
					for (let t of tiles) t.classList.remove("zl-current");
					at = -1;
					if (hits) say(hits.length ? "1 / " + hits.length : labels.none);
					return;
				}
				if (input && input.value) {
					input.value = "";
					run();
				}
				return;
			}
			if (/^[0-9]$/.test(key)) {
				event.preventDefault();
				takeDigit(key);
				return;
			}
			if (key === "Escape" && digits) {
				clearDigits();
				return;
			}
			if (key === "+" || key === "=" || key === "-") {
				event.preventDefault();
				recolumn(key === "-" ? -1 : 1);
				return;
			}
			if (key === "/" && input) {
				// The editor's and the browser's way into a search
				event.preventDefault();
				input.focus();
				if (input.select) input.select();
				return;
			}
			let letter = key.toLowerCase();
			if (printable && /^\p{L}$/u.test(letter)) {
				event.preventDefault();
				if (COMMANDS[letter]) holdLetter(letter);
				else typeInto(key);
			}
		});
	},

	/**
	 * The runtime, as the script the page carries.
	 *
	 * The source of a method written in shorthand begins with its name, not
	 * with `function`, and wrapped in parentheses as it stands it is a syntax
	 * error — which no test that calls the method directly can see. Hence the
	 * word is put in front, and the test parses the script the page gets.
	 */
	runtimeScript() {
		let labels = JSON.stringify({
			pages: this.PAGES_LABEL, none: this.SEARCH_NONE, gotoNone: this.GOTO_NONE,
		}).replace(/<\//g, "<\\/");
		// commandDelay may be added to the labels by a caller — the tests —
		// to shorten the moment a command letter waits
		return (
			"<script>\n(function " + this.sheetRuntime.toString() + ")(document, " +
			labels + ");\n</script>\n"
		);
	},

	/** Heading of the annotations menu, likewise. */
	ANNOTATIONS_LABEL: "Annotations",
	/** "Page 12", the link an annotation entry carries. */
	PAGE_LABEL: "Page",
	/** What an annotation with nothing to quote and nothing said is called. */
	TYPE_LABELS: { note: "Note", image: "Image", ink: "Ink", text: "Text" },

	log(msg) {
		Zotero.debug("zotLook/sheet: " + msg);
	},

	/**
	 * Columns actually used: a three-page PDF asked to fill five columns
	 * looks better in three, so the grid never has more columns than pages.
	 */
	columnsFor(pageCount, maxColumns) {
		return Math.max(1, Math.min(pageCount, maxColumns));
	},

	/**
	 * Pixel width to render at. Fewer columns means each thumbnail is shown
	 * larger, so it needs more pixels to stay sharp.
	 */
	widthFor(pageCount, maxColumns) {
		let columns = this.columnsFor(pageCount, maxColumns);
		return Math.round((this.BASE_WIDTH * Math.max(1, maxColumns)) / columns);
	},

	/** The directory the thumbnails live in, named after the sheet itself. */
	imageDirName(outputName) {
		return String(outputName).replace(/\.html?$/i, "") + "_pages";
	},

	escape(value) {
		return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	},

	/** Whitespace as a reader sees it, for the lists. */
	collapse(value) {
		return String(value).replace(/\s+/g, " ").trim();
	},

	// ── Colours ───────────────────────────────────────────────────────

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
	annotationColour(value) {
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
	halfOpaque(colour) {
		return colour.hex ? colour.value + "80" : colour.value;
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
	annotationStyle(annotation) {
		let colour = this.annotationColour(annotation.color);
		if (annotation.type === "underline") {
			return (
				"text-decoration: underline; text-decoration-color: " +
				colour.value +
				"; text-decoration-thickness: 2px; text-underline-offset: 2px;"
			);
		}
		return "background-color: " + this.halfOpaque(colour) + ";";
	},

	// ── The two floating menus ────────────────────────────────────────
	//
	// A book wants the page to itself; a reader wants its contents within
	// reach. Both are had by letting the summary float as a button and the
	// list appear over the page when it is opened.
	//
	// All of it is <details> and CSS, and that is not a stylistic preference:
	// a preview panel runs no scripts, so a menu that needed one would simply
	// never open. The element carries the state itself.
	//
	// The two sit in opposite corners rather than side by side, so that
	// neither label's width can ever push the other out of place.
	//
	// Shared by the EPUB preview, which builds its lists as DOM, and by the
	// two page sheets, which build theirs as strings — the same classes, so
	// one stylesheet serves all three.
	MENU_CSS: [
		"details.zl-toc, details.zl-annotations {",
		"  margin: 0;",
		"  font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
		"}",
		"details.zl-toc > summary, details.zl-annotations > summary {",
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
		"details.zl-toc > summary::-webkit-details-marker,",
		"details.zl-annotations > summary::-webkit-details-marker {",
		"  display: none;",
		"}",
		"details.zl-toc > summary {",
		"  right: 24px;",
		"  background: #2e8b84;",
		"  color: #ffffff;",
		"}",
		"details.zl-toc[open] > summary { background: #1f2a33; }",
		"details.zl-annotations > summary {",
		"  left: 24px;",
		"  background: #f5b841;",
		"  color: #1f2a33;",
		"}",
		"details.zl-annotations[open] > summary { background: #1f2a33; color: #ffffff; }",
		"ol.zl-toc-list, ol.zl-annotation-list {",
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
		"  text-align: left;",
		"}",
		"ol.zl-toc-list { right: 24px; }",
		"ol.zl-annotation-list { left: 24px; }",
		"ol.zl-toc-list li { margin: 0; }",
		"ol.zl-toc-list a {",
		"  display: block;",
		"  padding: 0.42em 1.2em;",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"}",
		"ol.zl-toc-list a:hover { background: #f0f4f3; }",
		"li.zl-toc-level1 a { padding-left: 2.4em; font-size: 0.95em; }",
		"li.zl-toc-level2 a { padding-left: 3.6em; font-size: 0.92em; color: #4a4a4a; }",
		"ol.zl-annotation-list li { margin: 0; padding: 0.5em 1.2em; line-height: 1.5; }",
		// A row rather than a block, so the swatch and the first line of the
		// quotation sit together. The native disclosure marker goes away
		// under flex, so one is drawn here — which is steadier anyway across
		// three engines that draw their own differently.
		"details.zl-annotation-entry > summary {",
		"  cursor: default;",
		"  display: flex;",
		"  align-items: baseline;",
		"  gap: 0.3em;",
		"  list-style: none;",
		"}",
		"details.zl-annotation-entry > summary::-webkit-details-marker {",
		"  display: none;",
		"}",
		"details.zl-annotation-entry > summary::before {",
		"  content: \"\\25b8\";",
		"  color: #8a8a8a;",
		"  font-size: 0.9em;",
		"}",
		"details.zl-annotation-entry[open] > summary::before { content: \"\\25be\"; }",
		// Two lines closed, all of it open. Measured in Quick Look, which
		// renders the clamp: the text is cut with an ellipsis rather than
		// running on. max-height carries the rest, where the property is not
		// understood — a little more than two lines, but never the whole
		// passage.
		"details.zl-annotation-entry:not([open]) q {",
		"  display: -webkit-box;",
		"  -webkit-line-clamp: 2;",
		"  line-clamp: 2;",
		"  -webkit-box-orient: vertical;",
		"  overflow: hidden;",
		"  max-height: 3.1em;",
		"}",
		"details.zl-annotation-entry[open] > summary { margin-bottom: 0.35em; }",
		".zl-annotation-detail { margin-left: 1.2em; }",
		"a.zl-annotation-goto {",
		"  display: inline-block;",
		"  margin-top: 0.3em;",
		"  font-size: 0.92em;",
		"  color: #2e8b84;",
		"  text-decoration: none;",
		"}",
		"a.zl-annotation-goto:hover { text-decoration: underline; }",
		".zl-annotation-swatch {",
		"  display: inline-block;",
		"  width: 0.7em;",
		"  height: 0.7em;",
		"  border-radius: 2px;",
		"  margin-right: 0.5em;",
		"  flex: none;",
		"}",
		"ol.zl-annotation-list q { quotes: none; }",
		"ol.zl-annotation-list a {",
		"  color: #1a1a1a;",
		"  text-decoration: none;",
		"  border-bottom: 1px solid transparent;",
		"}",
		"ol.zl-annotation-list a:hover { border-bottom-color: #999; }",
		"a.zl-annotation-open { margin-left: 0.9em; color: #2e8b84; }",
		// The menus in the dark: panels of dark grey, light text, the two
		// buttons as they are, which read on either ground
		"@media (prefers-color-scheme: dark) {",
		"  details.zl-toc > div, details.zl-annotations > div {",
		"    background: #262a30; color: #e8eaed;",
		"    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);",
		"  }",
		"  ol.zl-toc-list a, ol.zl-annotation-list, details.zl-annotation-entry > summary { color: #e8eaed; }",
		"  ol.zl-toc-list a:hover { background: #30353c; }",
		"  li.zl-toc-level2 a, .zl-annotation-comment, ol.zl-annotation-list a { color: #b8bcc2; }",
		"  a.zl-annotation-open, ol.zl-annotation-list a.zl-annotation-goto { color: #6fc3bb; }",
		"  a.zl-menu-current { background: #30353c; box-shadow: inset 3px 0 0 #6fc3bb; }",
		"}",
		".zl-annotation-unplaced { opacity: 0.75; font-style: italic; }",
		".zl-annotation-comment {",
		"  display: block;",
		"  margin-left: 1.2em;",
		"  color: #4a4a4a;",
		"}",
		// Narrow enough and a floating menu covers more than it offers, so
		// it goes back into the flow it came from
		"@media (max-width: 420px) {",
		"  details.zl-toc > summary, details.zl-annotations > summary,",
		"  ol.zl-toc-list, ol.zl-annotation-list {",
		"    position: static;",
		"    width: auto;",
		"    max-height: none;",
		"    box-shadow: none;",
		"  }",
		"  details.zl-toc, details.zl-annotations { margin: 0 0 1.6em 0; }",
		"}",
		"@media print {",
		"  details.zl-toc, details.zl-annotations { display: none; }",
		"}",
	].join("\n"),

	/**
	 * The contents menu, as a string. Entries whose target is missing are
	 * left out; with none left there is no menu, so a document with no
	 * chapters looks like the document rather than like a feature that
	 * failed.
	 *
	 * @param {Array<{title: string, target: string, level?: number}>} entries
	 *   target is an element id in the same page, without the "#"
	 * @returns {string} "" when there is nothing to list
	 */
	tocHtml(entries) {
		let items = "";
		for (let entry of entries || []) {
			let title = this.collapse(entry.title || "");
			if (!title || !entry.target) continue;
			let level = Math.max(0, Math.min(2, Number(entry.level) || 0));
			items +=
				'<li class="zl-toc-level' + level + '"><a href="#' +
				this.escape(entry.target) + '">' + this.escape(title) +
				"</a></li>\n";
		}
		if (!items) return "";
		// Closed on arrival: as a menu over the page it would cover the
		// first thing a reader looks at
		return (
			'<details class="zl-toc"><summary>' +
			this.escape(this.TOC_LABEL) +
			'</summary>\n<ol class="zl-toc-list">\n' +
			items +
			"</ol></details>\n"
		);
	},

	/**
	 * The annotations menu, as a string: every annotation in document
	 * order, each a way to the page it sits on.
	 *
	 * A quotation gets a fold — two lines closed, all of it open — so that a
	 * list of long passages stays a list. A note has no passage: swatch,
	 * comment, page. An annotation with neither is named by its kind, since
	 * an area or an ink drawing is still worth finding.
	 *
	 * @param {Array<{target: string, page: string|number, type?: string,
	 *   text?: string, comment?: string, color?: string, reader?: string}>}
	 *   entries — target is the id of the page's tile; page is what the
	 *   link says; reader, when given, is a URL that opens the reader at
	 *   the annotation itself, and gets a link of its own
	 * @returns {string} "" when there is nothing to list
	 */
	annotationsHtml(entries) {
		let items = "";
		let count = 0;
		for (let entry of entries || []) {
			if (!entry || !entry.target) continue;
			let text = this.collapse(entry.text || "");
			let comment = this.collapse(entry.comment || "");
			let type = String(entry.type || "highlight");
			// Solid here: the reader shows the swatch in the full colour
			// and only the passage at half
			let swatch =
				'<span class="zl-annotation-swatch" style="background-color: ' +
				this.escape(this.annotationColour(entry.color).value) +
				';"></span>';
			let goto =
				'<a class="zl-annotation-goto" href="#' +
				this.escape(entry.target) + '">' +
				this.escape(this.PAGE_LABEL + " " + entry.page) +
				"</a>";
			if (entry.reader) {
				// target="_blank" as on the tiles, and for the same reason:
				// a plain navigation to a zotero: URL is refused by Quick
				// Look and, in the Zotero window, comes back as a file
				// load for the system to ask about; a new-window request
				// goes to the system handler, which opens the reader
				goto +=
					' <a class="zl-annotation-open" target="_blank" href="' +
					this.escape(entry.reader) + '">' +
					this.escape(this.OPEN_LABEL) + "</a>";
			}
			let note = comment
				? '<span class="zl-annotation-comment">' +
					this.escape(comment) + "</span>"
				: "";
			count++;

			if (!text) {
				let said = note ||
					'<span class="zl-annotation-comment">' +
					this.escape(this.TYPE_LABELS[type] || type) + "</span>";
				items += "<li>" + swatch + said + goto + "</li>\n";
				continue;
			}
			// Marked here as it is marked on the page — which is also how
			// Zotero shows it in its own annotation list
			items +=
				'<li><details class="zl-annotation-entry"><summary>' +
				swatch +
				'<q style="' + this.escape(this.annotationStyle(
					{ type: type, color: entry.color })) + '">' +
				this.escape(text) + "</q></summary>\n" +
				'<div class="zl-annotation-detail">' + note + goto +
				"</div></details></li>\n";
		}
		if (!items) return "";
		return (
			'<details class="zl-annotations"><summary>' +
			this.escape(this.ANNOTATIONS_LABEL + " (" + count + ")") +
			'</summary>\n<ol class="zl-annotation-list">\n' +
			items +
			"</ol></details>\n"
		);
	},

	/**
	 * What the root element says about the menus: whether they stay open
	 * after an entry is followed by the mouse and by the keyboard. "stay"
	 * unless the spec says false; the scripts read the attributes.
	 *
	 * @param {{menuMouse?: boolean, menuKeyboard?: boolean}} spec
	 */
	menuAttrs(spec) {
		let word = (v) => (v === false ? "close" : "stay");
		return (
			' data-zl-menu-mouse="' + word(spec && spec.menuMouse) +
			'" data-zl-menu-keyboard="' + word(spec && spec.menuKeyboard) + '"'
		);
	},

	/** The id a page's tile carries, the same on both sides of a link. */
	tileId(page) {
		return "p" + page;
	},

	/**
	 * Where a tile lands when a menu entry jumps to it: the middle of the
	 * window, so that the page and its neighbours are seen together.
	 *
	 * A fragment jump puts the target's top edge at the top of the window,
	 * and scroll-margin is the only lever a page without scripts has on
	 * that. The tile's height on screen is not known here — it follows the
	 * window's width — but it can be written as an expression of it: the
	 * grid divides the width left by the padding and the gaps into equal
	 * columns, and a tile is that wide and its page's proportion tall, plus
	 * the label under it. Half the window less half of that is the margin.
	 * Never below zero: a tile taller than the window sits at the top.
	 *
	 * @param {number} ratio the page's height over its width
	 * @param {number} columns
	 */
	scrollMargin(ratio, columns) {
		let taken = 24 + 12 * (Math.max(1, columns) - 1);
		return (
			"max(0px, calc(50vh - ((100vw - " + taken + "px) / " +
			Math.max(1, columns) + " * " + ratio.toFixed(4) + " + 21px) / 2))"
		);
	},

	/**
	 * The styles of a page sheet: the grid, the tiles, the frame on the
	 * one jumped to, the labels, the dark side, the menus and the field.
	 * Shared by the contact sheet and the collection sheet.
	 *
	 * @param {number} columns
	 * @param {number} common the tiles' usual height over width
	 */
	pageStyles(columns, common) {
		return (
			"body {\n" +
			"    background: #f0f0f0;\n" +
			"    margin: 0;\n" +
			"    padding: 12px;\n" +
			"    font-family: -apple-system, BlinkMacSystemFont, sans-serif;\n" +
			"}\n" +
			".grid {\n" +
			"    display: grid;\n" +
			"    grid-template-columns: repeat(" +
			columns +
			", 1fr);\n" +
			"    gap: 12px;\n" +
			"}\n" +
			".page {\n" +
			"    background: white;\n" +
			"    box-shadow: 0 1px 4px rgba(0,0,0,0.2);\n" +
			"    text-align: center;\n" +
			"    overflow: hidden;\n" +
			"    scroll-margin-top: " + this.scrollMargin(common, columns) + ";\n" +
			"}\n" +
			// The page jumped to should be findable once the eye arrives.
			// Two selectors for one look: :target when the jump was a real
			// navigation, the class when the script below did it instead.
			".page:target, .page.zl-current {\n" +
			"    outline: 3px solid #f5b841;\n" +
			"    outline-offset: 3px;\n" +
			"}\n" +
			".page:target .label, .page.zl-current .label {\n" +
			"    color: #1f2a33; font-weight: 600;\n" +
			"}\n" +
			".page img {\n" +
			"    width: 100%;\n" +
			"    height: auto;\n" +
			"    display: block;\n" +
			"}\n" +
			".page a {\n" +
			"    text-decoration: none;\n" +
			"    color: inherit;\n" +
			"    display: block;\n" +
			"}\n" +
			".page .label {\n" +
			"    font-size: 11px;\n" +
			"    color: #666;\n" +
			"    padding: 4px 0;\n" +
			"}\n" +
			".notice {\n" +
			"    font-size: 13px;\n" +
			"    color: #666;\n" +
			"    text-align: center;\n" +
			"    padding: 12px 0 0 0;\n" +
			"}\n" +
			// The same sheet in the dark, where the system is: the ground and
			// the labels turn, the pages stay the paper they are
			"@media (prefers-color-scheme: dark) {\n" +
			"  body { background: #1c1f24; }\n" +
			"  .page { box-shadow: 0 1px 4px rgba(0,0,0,0.6); }\n" +
			"  .page .label, .notice { color: #a9adb3; }\n" +
			"  .page:target .label, .page.zl-current .label { color: #f5f6f7; }\n" +
			"}\n" +
			this.MENU_CSS + "\n" +
			this.SEARCH_CSS + "\n"
		);
	},

	/**
	 * @param {object} spec
	 * @param {Array<{page: number, height: number, label?: string}>} spec.pages
	 *   Rendered pages, in order; label is the printed page number where
	 *   the document has one. A page the renderer could not draw is absent.
	 * @param {boolean} [spec.menuMouse] Whether a menu stays open after a
	 *   click on an entry; false folds it. Likewise
	 * @param {boolean} [spec.menuKeyboard] for Enter on an entry.
	 * @param {number} spec.columns Grid columns.
	 * @param {number} spec.width Rendered pixel width of a thumbnail.
	 * @param {string} spec.imageDir Directory name the thumbnails live in.
	 * @param {number} spec.pageCount Pages in the document.
	 * @param {string} [spec.linkBase] Reader link; thumbnails are not
	 *   clickable without one.
	 * @param {string} [spec.notice] Shown when not every page was rendered.
	 * @param {Array<{title: string, page: number, level?: number}>} [spec.toc]
	 *   The document's outline; entries whose page was not drawn are left out.
	 * @param {Array<{page: number, key?: string, label?: string, type?: string,
	 *   text?: string, comment?: string, color?: string}>} [spec.annotations]
	 *   Zotero's annotations, page being the 1-based page they sit on.
	 * @returns {string} A complete HTML document.
	 */
	html(spec) {
		let pages = spec.pages || [];
		let linkBase = spec.linkBase || "";
		let columns = Math.max(1, Number(spec.columns) || 1);
		let body = "";

		// The proportion most pages share goes into the stylesheet; a page
		// that differs — a fold-out, a landscape plate — carries its own
		let ratios = pages.map((p) => p.height / Math.max(1, spec.width));
		let common = ratios.length ? ratios[0] : 1.4142;
		let drawn = new Set(pages.map((p) => p.page));

		for (let entry of pages) {
			// width and height reserve the box before the image arrives, so
			// lazy loading does not make the grid jump while scrolling
			let thumb =
				'<img src="' +
				this.escape(spec.imageDir) +
				"/p" +
				entry.page +
				'.jpg" loading="lazy" width="' +
				spec.width +
				'" height="' +
				entry.height +
				'">\n<div class="label">' +
				// The printed number where the document has one, since that
				// is the number a reader knows the page by; the tile's own
				// stays in the data, for the keyboard and the links
				(entry.label ? this.escape(entry.label) : entry.page) +
				"</div>";
			// target="_blank" does two different jobs, and both were
			// measured by clicking the four combinations in a real preview.
			//
			// Under GNOME Sushi it keeps the sheet alive. Its WebKit view
			// really follows links and cannot load a zotero: URL; the load
			// fails, and a failed load is how it reports that it cannot show
			// the file at all, so a click replaced the sheet with an error
			// box. A new-window request raises "create" instead, which Sushi
			// does not handle, so the click does nothing and the sheet stays.
			//
			// Under Quick Look it is what makes the links work at all.
			// Ordinary navigation is refused there — the click just beeps —
			// but a new-window request is handed to the system handler,
			// whatever the scheme: zotero: opens the reader at that page,
			// http: opens the browser. The preview closes as it hands over.
			// Without target the same link does nothing but beep.
			let inner = linkBase
				? '<a target="_blank" href="' +
					this.escape(linkBase) +
					"?page=" +
					entry.page +
					'">' +
					thumb +
					"</a>"
				: thumb;
			let ratio = entry.height / Math.max(1, spec.width);
			let own = Math.abs(ratio - common) > 0.01
				? ' style="scroll-margin-top: ' +
					this.scrollMargin(ratio, columns) + ';"'
				: "";
			let labelAttr = entry.label
				? ' data-zl-label="' + this.escape(entry.label) + '"'
				: "";
			body +=
				'<div class="page" id="' + this.tileId(entry.page) + '" data-zl-tile="' +
				entry.page + '"' + labelAttr + own + ">\n" + inner + "</div>\n\n";
		}
		// The page field's placeholder names the range the way the tiles do
		let first = pages.length ? pages[0] : null;
		let last = pages.length ? pages[pages.length - 1] : null;
		let range = first && last
			? (first.label || first.page) + "–" + (last.label || last.page)
			: "";

		let notice = spec.notice
			? '<p class="notice">' + this.escape(spec.notice) + "</p>\n"
			: "";

		// The menus, where there is something to put in them. An entry is
		// only worth following to a page that is there: with a page limit
		// in force, the outline of the rest would point at nothing.
		let toc = this.tocHtml(
			(spec.toc || [])
				.filter((e) => drawn.has(e.page))
				.map((e) => ({
					title: e.title,
					level: e.level,
					target: this.tileId(e.page),
				}))
		);
		let annotations = this.annotationsHtml(
			(spec.annotations || [])
				.filter((a) => drawn.has(a.page))
				.map((a) => ({
					target: this.tileId(a.page),
					page: a.label || a.page,
					type: a.type,
					text: a.text,
					comment: a.comment,
					color: a.color,
					// The reader opened at the annotation itself, not just
					// its page — where the sheet has a reader to link to
					reader: linkBase && a.key
						? linkBase + "?annotation=" + encodeURIComponent(a.key)
						: "",
				}))
		);

		return (
			"<!DOCTYPE html>\n" +
			"<html" + this.menuAttrs(spec) + ">\n<head>\n" +
			'<meta charset="UTF-8">\n' +
			"<title>" + this.escape(this.TITLE) + "</title>\n" +
			"<style>\n" +
			this.pageStyles(columns, common) +
			"</style>\n" +
			"</head>\n<body>\n" +
			toc +
			annotations +
			this.gotoBoxHtml(range) +
			this.searchBoxHtml() +
			'<div class="grid" data-zl-columns="' + columns + '">\n\n' +
			body +
			"</div>\n" +
			notice +
			this.textsHtml(pages) +
			this.JUMP_SCRIPT +
			this.runtimeScript() +
			"</body>\n</html>"
		);
	},

	/**
	 * The collection sheet: one tile per item, its first page.
	 *
	 * Several items selected, one press, and every document is there at
	 * a glance — the first page of each, its title and creators under it,
	 * a click opening it in the reader. What the forum asked for as a
	 * gallery to browse a collection with the arrow keys; the keyboard of
	 * the page sheet does that here, the search finds a document by its
	 * title, its author, or what is on its first page.
	 *
	 * @param {object} spec
	 * @param {Array<{index: number, title: string, meta?: string,
	 *   image?: string, height?: number, fit?: boolean, link?: string,
	 *   text?: string}>}
	 *   spec.tiles — image is the tile's picture relative to the sheet, or
	 *   absent for an item without a page; height is the picture's, in
	 *   pixels at spec.width; link opens the item; text is what a search
	 *   finds it by. A tile with fit set has a picture nothing measured — a
	 *   book's cover, a picture of the item's own — and shows it fitted
	 *   into a tile of the common proportion
	 * @param {number} spec.columns
	 * @param {number} spec.width pixels the pictures were rendered at
	 * @param {string} [spec.notice] Shown when not every item was laid out
	 * @param {boolean} [spec.menuMouse] as on the page sheet; the collection
	 *   sheet has no menus, but its root says the same
	 * @param {boolean} [spec.menuKeyboard] likewise
	 */
	collectionHtml(spec) {
		let tiles = spec.tiles || [];
		let columns = Math.max(1, Number(spec.columns) || 1);
		let width = Math.max(1, Number(spec.width) || 1);
		let heights = tiles.filter((t) => t.image).map((t) => t.height / width);
		let common = heights.length
			? heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)]
			: 1.3;
		let body = "";
		let texts = [];
		for (let tile of tiles) {
			let caption =
				'<div class="label"><span class="zl-title">' +
				this.escape(tile.title || "") + "</span>" +
				(tile.meta ? '<span class="zl-meta">' + this.escape(tile.meta) + "</span>" : "") +
				"</div>";
			let picture = tile.image && tile.fit
				? '<div class="zl-cover" style="padding-top: ' + (common * 100).toFixed(1) +
					'%;"><img src="' + this.escape(tile.image) + '" loading="lazy" alt=""></div>\n'
				: tile.image
				? '<img src="' + this.escape(tile.image) + '" loading="lazy" width="' +
					width + '" height="' + tile.height + '">\n'
				: '<div class="zl-nopage" style="padding-top: ' +
					(common * 100).toFixed(1) + '%;"><span>' +
					this.escape(this.NO_PAGE_LABEL) + "</span></div>\n";
			let inner = tile.link
				? '<a target="_blank" href="' + this.escape(tile.link) + '">' +
					picture + caption + "</a>"
				: picture + caption;
			let ratio = tile.image && !tile.fit ? tile.height / width : common;
			let own = Math.abs(ratio - common) > 0.01
				? ' style="scroll-margin-top: ' + this.scrollMargin(ratio, columns) + ';"'
				: "";
			body +=
				'<div class="page" id="' + this.tileId(tile.index) + '" data-zl-tile="' +
				tile.index + '"' + own + ">\n" + inner + "</div>\n\n";
			texts.push({
				page: tile.index,
				text: [tile.title, tile.meta, tile.text].filter(Boolean).join(" "),
			});
		}
		return (
			"<!DOCTYPE html>\n" +
			"<html" + this.menuAttrs(spec) + ">\n<head>\n" +
			'<meta charset="UTF-8">\n' +
			"<title>" + this.escape(this.COLLECTION_TITLE) + "</title>\n" +
			"<style>\n" +
			this.pageStyles(columns, common) +
			// The caption: the title on up to two lines, the creators and
			// year under it; a tile without a page is grey paper with a word
			// Tiles of their own height: a row is as tall as its tallest,
			// and the others must not be stretched to it
			".grid { align-items: start; }\n" +
			".page .label { text-align: left; padding: 6px 8px 8px; line-height: 1.3; }\n" +
			".page .label .zl-title { display: block; color: #1f2a33; font-size: 12px;" +
			" overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2;" +
			" -webkit-box-orient: vertical; }\n" +
			".page .label .zl-meta { display: block; color: #666; font-size: 11px; margin-top: 2px; }\n" +
			".page .zl-nopage { position: relative; background: #e4e4e4; }\n" +
			".page .zl-nopage span { position: absolute; top: 50%; left: 0; right: 0;" +
			" transform: translateY(-50%); color: #8a8a8a; font-size: 13px; }\n" +
			// A cover or a picture: whole, in the middle of a tile of the
			// common proportion, on the same grey as an empty tile
			".page .zl-cover { position: relative; background: #e4e4e4; }\n" +
			".page .zl-cover img { position: absolute; top: 0; left: 0; width: 100%;" +
			" height: 100%; object-fit: contain; }\n" +
			"@media (prefers-color-scheme: dark) {\n" +
			"  .page .label .zl-title { color: #e8eaed; }\n" +
			"  .page .label .zl-meta { color: #a9adb3; }\n" +
			"  .page .zl-nopage, .page .zl-cover { background: #2a2f36; }\n" +
			"}\n" +
			"</style>\n" +
			"</head>\n<body>\n" +
			this.searchBoxHtml() +
			'<div class="grid" data-zl-columns="' + columns + '">\n\n' +
			body +
			"</div>\n" +
			(spec.notice ? '<p class="notice">' + this.escape(spec.notice) + "</p>\n" : "") +
			this.textsHtml(texts) +
			this.JUMP_SCRIPT +
			this.runtimeScript() +
			"</body>\n</html>"
		);
	},
};
