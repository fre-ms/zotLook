/* global zotLookUtil */

/**
 * EPUB Canonical Fragment Identifiers, read.
 *
 * Zotero stores the position of an EPUB annotation as a W3C FragmentSelector
 * whose value is a CFI:
 *
 *     epubcfi(/6/14!/4/2/6,/1:0,/1:671)
 *
 * A CFI addresses **structure**, not appearance — spine item, element path,
 * text node, character offset. A reflowable book has no pages, and font size
 * or window width change nothing about it, which is why a position expressed
 * in rendered coordinates, as a PDF's rectangles are, would be meaningless
 * here. That is the whole reason the format exists.
 *
 * Zotero's reader resolves these with a vendored copy of epub.js
 * (`./epubjs/epub.js/src/epubcfi.js` inside its bundle), but the bundle is a
 * UMD build that exports the reader and nothing else, and wants React with
 * it. So the reading is done here — only the reading: nothing in zotLook ever
 * writes a CFI.
 *
 * **Where this follows epub.js rather than the specification.** The strict
 * reading of EPUB CFI 1.1 interleaves elements and character data in one
 * numbering, so that odd steps address the text *between* elements. epub.js
 * indexes elements among elements and text nodes among text nodes, and it is
 * epub.js that wrote every CFI this will ever be asked to read. Matching the
 * writer is what makes the answer right; matching the paper would make it
 * wrong. The divergence is marked at the two places it shows.
 */

var zotLookCfi = {
	/**
	 * @param {string} value  an `epubcfi(...)` string, or its contents
	 * @returns {object|null} {spine, path, start, end} — each a step list, or
	 *   null when the string is not a CFI at all
	 */
	parse(value) {
		let text = String(value || "").trim();
		let wrapped = text.match(/^epubcfi\((.*)\)$/s);
		if (wrapped) text = wrapped[1];
		if (!text) return null;

		// Indirection: the package document, then the content document. A
		// CFI may cross more than once; what interests us is the first hop,
		// which names the spine item, and the last, which is inside the
		// document that hop leads to.
		let components = text.split("!");
		if (components.length < 2) return null;

		let spine = this._parsePath(components[0]);
		if (!spine.length) return null;

		let inside = components[components.length - 1];

		// A range is written as parent,start,end — the two ends relative to
		// the parent, which is what keeps a range short.
		let parts = inside.split(",");
		let path = this._parsePath(parts[0]);
		let start = parts.length === 3 ? this._parsePath(parts[1]) : null;
		let end = parts.length === 3 ? this._parsePath(parts[2]) : null;
		if (!path.length && !(start && start.length)) return null;

		return { spine, path, start, end };
	},

	/**
	 * Which spine item the CFI points into, or null.
	 *
	 * The first step of the package path selects the `<spine>` among the
	 * package element's children and the second selects an `<itemref>` in it;
	 * the itemref's own index is the position in reading order. epub.js reads
	 * it as `base.steps[1].index`, and Zotero's sortIndex begins with the
	 * same number — two independent statements of one fact.
	 */
	spineIndex(parsed) {
		if (!parsed || parsed.spine.length < 2) return null;
		let step = parsed.spine[1];
		return step.type === "element" ? step.index : null;
	},

	/**
	 * Resolves the CFI against a content document.
	 *
	 * @param {Document} doc  the spine item's document, as Zotero's EPUB
	 *   module hands it over — the very tree the CFI was written against
	 * @returns {object|null} {startNode, startOffset, endNode, endOffset}
	 */
	resolve(doc, parsed) {
		let root = doc && doc.documentElement;
		if (!root || !parsed) return null;

		let base = this._walk(root, parsed.path, doc);
		if (!base) return null;

		if (!parsed.start || !parsed.end) {
			// A point rather than a range: an annotation with no extent, or
			// a CFI written for a position. Both ends are the same place.
			let at = this._offsetOf(parsed.path, base);
			return {
				startNode: base.node,
				startOffset: at,
				endNode: base.node,
				endOffset: at,
			};
		}

		let from = this._walk(base.node, parsed.start, doc);
		let to = this._walk(base.node, parsed.end, doc);
		if (!from || !to) return null;

		return {
			startNode: from.node,
			startOffset: this._offsetOf(parsed.start, from),
			endNode: to.node,
			endOffset: this._offsetOf(parsed.end, to),
		};
	},

	/**
	 * The identifier that points at one node — the inverse of resolve().
	 *
	 * Written only for links out of a preview into Zotero's reader, which
	 * accepts a CFI on zotero://open-pdf. It follows the same step rules the
	 * reading side does, so the two are each other's inverse and a test can
	 * say so.
	 *
	 * @param {number} spineStep     the <spine>'s place among the package
	 *   element's element children, counted from zero
	 * @param {number} itemrefStep   the spine item's position, from zero
	 * @param {Node} node            in that spine item's document
	 * @returns {string|null}
	 */
	forNode(spineStep, itemrefStep, node) {
		let steps = this._stepsTo(node);
		if (!steps) return null;
		return this._wrap(spineStep, itemrefStep, steps.join("/"));
	},

	/**
	 * A range CFI over part of one text node.
	 *
	 * This is the form that actually travels. A CFI naming an element alone
	 * gives epub.js nothing to set a range end from — toRange() leaves the
	 * range collapsed — and Zotero's reader scrolls a range into view, so a
	 * link built that way arrives nowhere. Every CFI Zotero writes itself is
	 * of this shape: a path to the element, then a start and an end inside
	 * one of its text children.
	 */
	forTextRange(spineStep, itemrefStep, textNode, start, end) {
		let steps = this._stepsTo(textNode);
		if (!steps || steps.length < 2) return null;

		let last = "/" + steps[steps.length - 1];
		let path = steps.slice(0, -1).join("/");
		let from = Math.max(0, start | 0);
		let to = Math.max(from + 1, end | 0);
		return this._wrap(
			spineStep, itemrefStep,
			path + "," + last + ":" + from + "," + last + ":" + to
		);
	},

	/**
	 * A range CFI from one node to a text offset in another.
	 *
	 * Where forTextRange addresses inside a single text node, this spans two:
	 * a start node and an end text node that share an ancestor. Its use is the
	 * pagebreak marker — an empty span mid-paragraph — as the start, and the
	 * first character of the page's text as the end. Anchoring the range at
	 * the marker is what a page-list entry does, so the reader scrolls the
	 * marker to the top and reads the page as this one, not the one it ends.
	 *
	 * Returns null when the two do not straddle a shared parent — when one
	 * contains the other, there is no two-sided range to make, and the caller
	 * falls back to a plain text range.
	 */
	forRange(spineStep, itemrefStep, startNode, endNode, endOffset) {
		let s = this._stepsTo(startNode);
		let e = this._stepsTo(endNode);
		if (!s || !e) return null;
		let i = 0;
		while (i < s.length && i < e.length && s[i] === e[i]) i++;
		// A shared parent, and each side a step past it: anything else is one
		// nested in the other, which has no two-sided range
		if (i === 0 || i >= s.length || i >= e.length) return null;
		let parent = s.slice(0, i).join("/");
		let start = s.slice(i).join("/");
		let end = e.slice(i).join("/");
		let to = Math.max(0, endOffset | 0);
		return this._wrap(
			spineStep, itemrefStep,
			parent + ",/" + start + ",/" + end + ":" + to
		);
	},

	/** The document path to a node, as CFI steps, or null. */
	_stepsTo(node) {
		if (!node || !node.ownerDocument) return null;
		let root = node.ownerDocument.documentElement;
		if (!root) return null;

		let steps = [];
		for (let at = node; at && at !== root; at = at.parentNode) {
			let parent = at.parentNode;
			if (!parent) return null;   // detached: nothing to point at
			let step =
				at.nodeType === 1
					? (this._elementChildren(parent).indexOf(at) + 1) * 2
					: this._textChildren(parent).indexOf(at) * 2 + 1;
			if (step < 1) return null;
			steps.unshift(step);
		}
		return steps.length ? steps : null;
	},

	/** The package path every CFI into a spine item begins with. */
	_wrap(spineStep, itemrefStep, tail) {
		return (
			"epubcfi(/" +
			(spineStep + 1) * 2 +
			"/" +
			(itemrefStep + 1) * 2 +
			"!/" +
			tail +
			")"
		);
	},

	// ── Reading the notation ──────────────────────────────────────────

	_parsePath(text) {
		let steps = [];
		for (let piece of String(text || "").split("/")) {
			if (piece === "") continue;
			let step = this._parseStep(piece);
			if (step) steps.push(step);
		}
		return steps;
	},

	/**
	 * One step: a number, optionally an assertion in brackets, and on the
	 * last step of a path a `:offset`.
	 *
	 * Even numbers address elements, odd ones text — the halving is where the
	 * numbering shows itself. Spatial (`@x:y`) and temporal (`~t`) terminals
	 * exist in the format and are ignored: they describe positions in images
	 * and media, which carry no annotation of ours.
	 */
	_parseStep(piece) {
		let match = String(piece).match(
			/^(\d+)(?:\[([^\]]*)\])?(?::(\d+))?(?:\[([^\]]*)\])?/
		);
		if (!match) return null;
		let number = parseInt(match[1], 10);
		if (!Number.isFinite(number)) return null;

		return {
			type: number % 2 === 0 ? "element" : "text",
			index: number % 2 === 0 ? number / 2 - 1 : (number - 1) / 2,
			id: match[2] || null,
			offset: match[3] === undefined ? null : parseInt(match[3], 10),
			assertion: match[4] || null,
		};
	},

	// ── Walking the tree ──────────────────────────────────────────────

	/**
	 * Follows a step list from a starting node.
	 *
	 * @returns {object|null} {node} — the node the last step lands on
	 */
	_walk(from, steps, doc) {
		let node = from;
		for (let step of steps) {
			if (!node) return null;
			node =
				step.type === "element"
					? this._elementStep(node, step, doc)
					: this._textStep(node, step);
		}
		return node ? { node } : null;
	},

	/**
	 * An element child by index — or by the id the assertion names.
	 *
	 * The id wins where there is one. A book edited after the annotation was
	 * made can have gained or lost an element, which moves every index after
	 * it; the id is what survives that, and it is why the format carries
	 * assertions at all.
	 */
	_elementStep(node, step, doc) {
		if (step.id && doc && typeof doc.getElementById === "function") {
			let found = doc.getElementById(step.id);
			if (found) return found;
		}
		let children = this._elementChildren(node);
		let found = children[step.index];
		if (found && step.id && found.getAttribute) {
			// The index landed somewhere the assertion contradicts. Trust the
			// assertion and look for it among the siblings.
			if (found.getAttribute("id") && found.getAttribute("id") !== step.id) {
				let corrected = children.find(
					(child) => child.getAttribute && child.getAttribute("id") === step.id
				);
				if (corrected) return corrected;
			}
		}
		return found || null;
	},

	/** Element children, comments and processing instructions passed over. */
	_elementChildren(node) {
		if (!node || !node.childNodes) return [];
		return Array.prototype.filter.call(
			node.childNodes,
			(child) => child.nodeType === 1
		);
	},

	/** Text children, as the reading side counts them. */
	_textChildren(node) {
		if (!node || !node.childNodes) return [];
		return Array.prototype.filter.call(
			node.childNodes,
			(child) => child.nodeType === 3
		);
	},

	/**
	 * A text child by index.
	 *
	 * Counted among the text children alone, which is epub.js's reading and
	 * therefore the one the stored CFIs were written in.
	 */
	_textStep(node, step) {
		if (!node || !node.childNodes) return null;
		return this._textChildren(node)[step.index] || null;
	},

	/** The character offset a path ends on, or 0. */
	_offsetOf(steps, landed) {
		void landed;
		if (!steps || !steps.length) return 0;
		let last = steps[steps.length - 1];
		return last.offset === null ? 0 : last.offset;
	},

	// ── Marking what was found ────────────────────────────────────────

	/**
	 * Wraps everything between two points in elements the caller builds.
	 *
	 * A stretch crossing element boundaries becomes one wrapper per text node
	 * it touches, which is what a browser does with a selection and what
	 * keeps the markup valid. Applied back to front, because wrapping splits
	 * text nodes and every offset after a split would move.
	 *
	 * @param {function} make  (index, total) => Element, called once per
	 *   piece. The index counts in **reading order**, not in the order the
	 *   pieces are wrapped — those run backwards, and a caller marking the
	 *   start of a range would otherwise mark its end.
	 * @returns {number} how many pieces were wrapped
	 */
	wrapRange(range, make) {
		if (!range || !range.startNode || !range.endNode) return 0;

		let pieces = this._piecesOf(range);
		let total = pieces.length;
		let wrapped = 0;
		for (let at = total - 1; at >= 0; at--) {
			let piece = pieces[at];
			let node = piece.node;
			let parent = node.parentNode;
			let doc = node.ownerDocument;
			if (!parent || !doc) continue;

			let text = String(node.data || "");
			let from = Math.max(0, Math.min(piece.from, text.length));
			let to = Math.max(from, Math.min(piece.to, text.length));
			if (to === from) continue;

			// Split by hand rather than with splitText: the same three nodes
			// either way, and this asks nothing of the DOM beyond creating a
			// text node and inserting it.
			let wrapper = make(at, total);
			if (!wrapper) continue;
			wrapper.appendChild(doc.createTextNode(text.slice(from, to)));

			let after = text.slice(to);
			node.data = text.slice(0, from);
			parent.insertBefore(wrapper, node.nextSibling);
			if (after) {
				parent.insertBefore(doc.createTextNode(after), wrapper.nextSibling);
			}
			wrapped++;
		}
		return wrapped;
	},

	/** The text nodes a range covers, with the stretch of each. */
	_piecesOf(range) {
		if (range.startNode === range.endNode) {
			return [
				{
					node: range.startNode,
					from: range.startOffset,
					to: range.endOffset,
				},
			];
		}

		let pieces = [];
		let seenStart = false;
		let walk = (node) => {
			if (pieces.length && pieces[pieces.length - 1].node === range.endNode) {
				return true;
			}
			if (node.nodeType === 3) {
				if (node === range.startNode) {
					seenStart = true;
					pieces.push({
						node,
						from: range.startOffset,
						to: String(node.data || "").length,
					});
					return false;
				}
				if (node === range.endNode) {
					pieces.push({ node, from: 0, to: range.endOffset });
					return true;
				}
				if (seenStart) {
					pieces.push({
						node,
						from: 0,
						to: String(node.data || "").length,
					});
				}
				return false;
			}
			for (let child of Array.prototype.slice.call(node.childNodes || [])) {
				if (walk(child)) return true;
			}
			return false;
		};

		let root = this._commonRoot(range.startNode, range.endNode);
		if (root) walk(root);
		// The end was never met: the two points are not in one tree, or they
		// are the wrong way round. Marking part of it would be worse than
		// reporting that it could not be placed.
		let last = pieces[pieces.length - 1];
		if (!last || last.node !== range.endNode) return [];
		return pieces;
	},

	_commonRoot(a, b) {
		let ancestors = new Set();
		for (let node = a; node; node = node.parentNode) ancestors.add(node);
		for (let node = b; node; node = node.parentNode) {
			if (ancestors.has(node)) return node;
		}
		return null;
	},
};

void zotLookUtil;
