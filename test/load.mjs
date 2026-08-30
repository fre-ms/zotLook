import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DOMParser } = require('linkedom');

/** Repository root and the directory that becomes the XPI root. */
// fileURLToPath, not URL.pathname: the latter renders a Windows path as
// /C:/…, which the fs calls then read as C:\C:\…. The suites are meant to
// be platform-independent, and since the plugin runs on Windows they should
// run there too.
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ADDON = ROOT + 'addon/';

/**
 * The plugin's shipped defaults, parsed out of addon/prefs.js. Reading the real
 * file rather than restating the values means the tests exercise the defaults
 * users actually get.
 */
export function defaultPrefs() {
  const src = fs.readFileSync(ADDON + 'prefs.js', 'utf8');
  const prefs = {};
  for (const m of src.matchAll(/^\s*pref\(\s*"([^"]+)"\s*,\s*("([^"]*)"|[^)]+)\)/gm)) {
    prefs[m[1]] = m[3] !== undefined ? m[3] : JSON.parse(m[2].trim());
  }
  return prefs;
}

/**
 * A stand-in for Zotero.Prefs backed by a plain object, seeded with the
 * shipped defaults.
 */
export function stubPrefs(initial = {}) {
  const store = { ...defaultPrefs(), ...initial };
  const observers = new Map();
  let next = 0;
  return {
    store,
    get: (name) => store[name],
    set: (name, value) => {
      store[name] = value;
      for (const [, [n, h]] of observers) if (n === name) h(value);
    },
    registerObserver: (name, handler) => {
      const symbol = Symbol('pref' + next++);
      observers.set(symbol, [name, handler]);
      return symbol;
    },
    unregisterObserver: (symbol) => observers.delete(symbol),
    rootBranch: {
      getChildList: (branch) => Object.keys(store).filter((k) => k.startsWith(branch)),
    },
  };
}

/**
 * Evaluates the plugin's scripts in one scope with the Zotero sandbox
 * globals stubbed, and returns the objects they define. Overrides replace
 * individual globals so a suite can drive the parts it is exercising.
 */
export function loadPlugin(overrides = {}) {
  const logs = [];
  const prefs = overrides.Prefs ?? stubPrefs(overrides.prefValues);
  const g = {
    Zotero: {
      debug: (m) => logs.push(m),
      isMac: true,
      getTempDirectory: () => ({ path: '/tmp/zt' }),
      Items: overrides.Items,
      Prefs: prefs,
      PreferencePanes: overrides.PreferencePanes,
      ...(overrides.zotero ?? {}),
    },
    DOMParser,
    Localization: overrides.Localization ?? function () { throw new Error('no l10n'); },
    ChromeUtils: overrides.ChromeUtils ?? { importESModule: () => ({ Subprocess: {} }) },
    PathUtils: {
      join: (...a) => a.filter((x) => x !== '').join('/').replace(/\/+/g, '/'),
      filename: (p) => p.split('/').pop(),
      parent: (p) => p.split('/').slice(0, -1).join('/'),
      toFileURI: (p) => 'file://' + p,
    },
    IOUtils: overrides.IOUtils ?? {},
    ChromeWorker: overrides.ChromeWorker ?? function () {
      throw new Error('no ChromeWorker in this test');
    },
    Services: overrides.Services ?? {},
    Components: overrides.Components ?? {},
    setTimeout, clearTimeout, console,
  };
  const src = ['util.js', 'cfi.js', 'sheet.js', 'epub.js', 'winpreview.js', 'zotlook.js']
    .map((f) => fs.readFileSync(ADDON + f, 'utf8'))
    .join('\n;\n');
  const out = new Function(
    ...Object.keys(g),
    src +
      '\n;return {zotLook, zotLookUtil, zotLookCfi, zotLookEpub, zotLookSheet, '
      + 'zotLookWinPreview};'
  )(...Object.values(g));
  return { ...out, logs, prefs, zotero: g.Zotero };
}
