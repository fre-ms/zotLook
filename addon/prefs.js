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
// Not Alt+Space: that is the window menu on GNOME and on Windows, and a window
// manager takes its combinations before the application is asked, so the
// shortcut could never fire there. Ctrl+Shift+Space is free on all three
// systems. Plain Ctrl+Space is not — it toggles the input method on Linux and
// switches input source on macOS.
pref("extensions.zotlook.key.contactSheet", "Ctrl+Shift+Space");
// Shift+Option+Space rather than Ctrl+Option+Space: the latter is the macOS
// default for cycling input sources, which springs back into life as soon as
// a second keyboard layout is enabled.
pref("extensions.zotlook.key.contactSheetWindow", "Shift+Alt+Space");

// Columns in the contact sheet grid. Fewer columns means larger thumbnails,
// and the renderer raises the rendered resolution to match.
pref("extensions.zotlook.contactSheetColumns", 5);

// Keep a contact sheet once it is built and show it again unchanged, rather
// than drawing every page a second time. It is kept beside the working
// directory, in the system's temp area, so it is not backed up with the
// library. A sheet is redrawn when the file, its annotations, the column
// count or the page limit have changed since — see _sheetCacheKey.
pref("extensions.zotlook.cacheContactSheet", true);

// How long a kept sheet may go unused before it is dropped at the next start.
// By last use rather than by age, so a book opened weekly stays and one opened
// once in March does not. 0 keeps them until the system clears its temp area —
// which macOS and Linux do on their own, and Windows rarely.
pref("extensions.zotlook.contactSheetKeepDays", 30);

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

