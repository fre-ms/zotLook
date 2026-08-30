// Runs the preference pane script against a real DOM.
//
// Zotero loads a pane's scripts into a Cu.Sandbox whose prototype is the
// preferences window, and only then inserts the markup. What that buys the
// tests is that the whole file can be evaluated with the globals it will
// actually see — Zotero, zotLookUtil, document, window — and then driven by
// dispatching the same events the window would.
import fs from 'node:fs';
import { ADDON, loadPlugin } from './load.mjs';

/**
 * @param {object} [prefs] Seed values, keyed by full preference name.
 * @param {boolean} [isMac] Decides how shortcuts are written on the buttons.
 * @param {object} [zotero] Extra Zotero stubs, e.g. getMainWindow.
 * @returns {Promise<{doc, store, debug}>}
 */
export async function openPane(prefs = {}, isMac = true, zotero = {}) {
  const { DOMParser } = await import('linkedom');
  // Zotero resolves the html: prefix; linkedom needs it stripped
  const fragment = fs.readFileSync(ADDON + 'prefs-pane.xhtml', 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(\/?)html:/g, '<$1');
  const doc = new DOMParser().parseFromString(
    '<html><body>' + fragment + '</body></html>', 'text/html');
  doc.createXULElement = (t) => doc.createElement(t);
  // Enough of Fluent for the tests: what matters is which id an element was
  // given and with what arguments, not the translated text
  doc.l10n = {
    setAttributes: (el, id, args) => {
      el.setAttribute('data-l10n-id', id);
      el.l10nArgs = args || null;
    },
  };

  const store = { ...prefs };
  const debug = [];
  const Zotero = {
    debug: (m) => debug.push(m),
    isMac,
    getMainWindow: () => null,
    Prefs: {
      get: (n) => store[n],
      set: (n, v) => { store[n] = v; },
      rootBranch: { getChildList: () => [] },
    },
    ...zotero,
  };
  const { zotLookUtil } = loadPlugin();
  const src = fs.readFileSync(ADDON + 'prefs-pane.js', 'utf8');
  new Function('Zotero', 'zotLookUtil', 'document', 'window', 'MutationObserver', src)(
    Zotero, zotLookUtil, doc, { document: doc },
    class { observe() {} disconnect() {} });
  return { doc, store, debug };
}

/** Fires a XUL command event, which is what a click on a button raises. */
export function command(doc, id) {
  doc.getElementById(id).dispatchEvent(new doc.defaultView.Event('command'));
}

/**
 * Fires a key event at the window, where the recorder listens.
 *
 * The modifier flags are given as the browser gives them: on a modifier's own
 * keyup the flag is already false, which is how the recorder can tell that
 * the last one has been let go.
 */
export function key(doc, type, props) {
  const event = new doc.defaultView.Event(type, { bubbles: true });
  Object.assign(event, {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
  }, props);
  doc.defaultView.dispatchEvent(event);
}
