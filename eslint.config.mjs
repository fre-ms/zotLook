// Static checks for the plugin sources. The one that matters most here is
// no-undef: a lost function parameter leaves an identifier that still parses
// but throws at runtime, which `node --check` cannot see.
export default [
  {
    files: ['addon/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        // Provided by Zotero's plugin sandbox
        Zotero: 'readonly', ChromeUtils: 'readonly', PathUtils: 'readonly',
        IOUtils: 'readonly', Services: 'readonly', Localization: 'readonly',
        DOMParser: 'readonly', fetch: 'readonly', globalThis: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        // Browser-ish globals available in the preferences window
        document: 'readonly', window: 'readonly', MutationObserver: 'readonly',
        ChromeWorker: 'readonly', Worker: 'readonly',
        TextEncoder: 'readonly', btoa: 'readonly',
        // The plugin's own modules, loaded into one shared scope
        zotLook: 'writable', zotLookUtil: 'writable', zotLookEpub: 'writable',
        zotLookSheet: 'writable', zotLookWinPreview: 'writable',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^zotLook' }],
      // The sources carry /* global */ comments as documentation; those are
      // not redeclarations of the environment described above.
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
    },
  },
  {
    files: ['test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly', globalThis: 'readonly',
                 setTimeout: 'readonly', clearTimeout: 'readonly', setImmediate: 'readonly',
                 Event: 'readonly', URL: 'readonly', Buffer: 'readonly',
                 queueMicrotask: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-redeclare': ['error', { builtinGlobals: false }] },
  },
  {
    // The defaults file is evaluated with a pref() function supplied by Zotero
    files: ['addon/prefs.js'],
    languageOptions: { globals: { pref: 'readonly' } },
  },
  {
    // Worker scripts have their own globals rather than the window's, and
    // are loaded as modules — a classic worker may not import() at all
    files: ['addon/*.worker.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { self: 'readonly', OffscreenCanvas: 'readonly', postMessage: 'readonly' },
    },
  },
];
