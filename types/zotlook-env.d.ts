// What the plugin's environment provides that Zotero's published types do
// not. Declarations only — nothing here is shipped, and nothing here excuses
// a mistake in the plugin itself: each entry says why the checker cannot know
// about it on its own.

/**
 * addon/prefs.js is read by Zotero's preference loader, which calls it with
 * pref() in scope. The file is not a script the plugin loads itself.
 */
declare function pref(name: string, value: string | number | boolean): void;

/**
 * The plugin hangs itself on Zotero so a preference pane — which Zotero runs
 * in its own sandbox, where the plugin's own globals are out of reach — can
 * find it. That assignment happens at run time, so no published type has it.
 */
declare namespace Zotero {
  let zotLook: any;
}

/**
 * The renderer worker imports Zotero's bundled pdf.js by chrome URL. There is
 * no package to resolve and no types to find; what it is used for is checked
 * by test/render.test.mjs against a stub of the same shape.
 */
declare module "resource://zotero/reader/pdf/build/pdf.mjs" {
  const pdfjs: any;
  export = pdfjs;
}
