// Defaults for zotLook. Zotero loads this file on startup; the preference pane
// reads and writes the same branch.

// Safety limit for the contact sheet. Pages render concurrently and thumbnails
// are written as files, so this is a guard against pathological documents
// rather than a performance ceiling: a 300-page book takes about seven seconds.
// Hence no limit by default; set a number only if a huge scan is a problem.
pref("extensions.zotlook.contactSheetMaxPages", 0);

// Keyboard shortcuts. Format: modifiers joined with "+", then either a physical
// key code ("Space", "KeyY") or a produced character ("y"). See
// ZotLookUtil.parseShortcut for why both forms exist.
pref("extensions.zotlook.key.preview", "Space");
pref("extensions.zotlook.key.notes", "Shift+Space");
pref("extensions.zotlook.key.contactSheet", "Alt+Space");
// Shift+Option+Space rather than Ctrl+Option+Space: the latter is the macOS
// default for cycling input sources, which springs back into life as soon as
// a second keyboard layout is enabled.
pref("extensions.zotlook.key.contactSheetWindow", "Shift+Alt+Space");

// Columns in the contact sheet grid. Fewer columns means larger thumbnails,
// and the renderer raises the rendered resolution to match.
pref("extensions.zotlook.contactSheetColumns", 5);

// Which attachment a preview uses when an item has several.
// "type": follow attachmentOrder below. "first": take the first attachment
// the item lists, whatever it is.
pref("extensions.zotlook.attachmentMode", "type");
// Preferred types, best first. A type omitted here is never previewed.
pref("extensions.zotlook.attachmentOrder", "pdf,epub,html,image,video,other");

// macOS shows no EPUB preview on its own, so the plugin renders one itself.
// A Quick Look extension that handles EPUB would do it better, but the plugin
// cannot tell whether one is installed — hence a switch rather than a guess.
pref("extensions.zotlook.epubOwnRenderer", true);

// Zotero keeps annotations in its database rather than in the PDF, so a plain
// preview shows an unmarked document. Exporting a copy with them drawn in is
// skipped entirely for attachments that have none.
pref("extensions.zotlook.previewAnnotations", true);

// Which renderer draws the contact sheet. "auto" uses the bundled binary on
// macOS and pdf.js elsewhere, which is what everyone wants; "portable" forces
// pdf.js. Deliberately absent from the preference pane — it exists so the
// portable renderer can be exercised on a Mac, where it would otherwise never
// run and so never be tested by anyone able to fix it.
pref("extensions.zotlook.renderer", "auto");
