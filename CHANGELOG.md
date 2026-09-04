<!-- Generated from doc/en/history.qmd by tool/changelog.mjs. Edit there. -->
# Changelog

Every release of zotLook, newest first, with the notes it was published
with. This text is the source of the release notes on GitHub and of
`CHANGELOG.md` in the repository. Versions are the plugin's own; a date is
the day the release was published.

## 1.5.1 — 2026-09-04

The sheet in its own Zotero window can search and answers the keyboard.

- **Search.** A field in the top corner; Ctrl+F reaches it. Pages without
  the word are dimmed, pages with it show how often, the first is framed in
  the middle, and Enter walks on. For a PDF the text is read off the pages as
  the sheet is drawn; in a book's overview the hits are marked in the tiles.
- **Keyboard.** Enter frames the next page and Shift+Enter the previous, the
  arrows move the frame across the grid — under a search, left and right go
  hit by hit and up and down to the nearest row with a hit — o or Ctrl+Enter
  opens the framed page in the reader, and c and a open the contents and the
  annotations, where the arrows walk the entries and Enter follows one. Enter
  in the search field walks on and hands the keyboard back to the page. Page
  Up and Page Down scroll, as before.
- The system previews are as they were: they run no scripts, so they show no
  field and answer no keys.
- A sheet window closed by hand, with Cmd+W or its red button, swallowed the
  next shortcut; it took a second press to open a new one. Fixed.
- The window says that the sheet is on its way while it is still empty, and
  it comes back at the size it was last left at rather than at Zotero's
  minimum; the size can also be set in the preferences. Its title is in the
  language of the rest of the sheet.
- An annotation in the sheet's menu opens the reader at the annotation
  itself, by its own link or with o in the window.
- The sheet is dark where the system is dark.
- Where no system preview answers Space, the sheet opens in its window
  instead; a setting turns that off.
- A page field in the window's top left corner, Ctrl+G, takes a page number
  and frames the page — the printed number first, where the PDF labels its
  pages, and the tiles show those numbers too.
- In the window, digits and Enter frame a page by its number, plus and minus
  change the columns on the spot, p prints, and a word in Zotero's search
  field goes along as the sheet's first search.
- An item pane section named zotLook offers the three actions as buttons.
- Space shows every attachment of an item, the best first, and the arrows
  walk them; with several items, one file each. Quick Look walks on its own;
  under Sushi and QuickLook the preview follows the arrows and the selection.
- Several selected items make a collection sheet: the first page of each
  item's PDF with its title, a click opening it, the keyboard and the search
  as on a page sheet.
- The documentation gives the sheet in its window a page of its own, and the
  front page tells the three tiers: the attachment, the sheet, the window.
- Update checks go to zotlook.org from this version on; the update itself
  still comes from GitHub. The privacy page says what that means.

**Requires** Zotero 10. macOS 12+, or Linux with GNOME Sushi, or Windows with
QuickLook running.

## 1.4.1 — 2026-09-03

Two fixes for the sheet in its own Zotero window, both found on GNOME.

**Menu entries no longer open a dialog.** Clicking an entry in the contents
or annotations menu asked which application should handle file links. The
click now scrolls to the page instead of navigating to it. The system
previews were never affected.

**The window closes again when it hands over.** It had stopped closing after
a click opened the reader, because it judged by keyboard focus, and the page
link takes the focus first. It now recognises its own handoff by the
attachment.

**Requires** Zotero 10. macOS 12+, or Linux with GNOME Sushi, or Windows with
QuickLook running.

## 1.4.0 — 2026-09-02

The contact sheet gets the two buttons the EPUB preview has: the document's
contents in one corner, its annotations in the other. An entry scrolls its
page to the middle of the sheet and frames it; a click on the page still
opens the reader. The EPUB page overview has the same buttons.

The contents come from the PDF's outline, so a PDF without one gets no
button. The annotations are listed in reading order, with the quotation, the
comment and the page.

Both buttons can be switched off in the settings. Nothing here needs a
script, so it works in Quick Look, GNOME Sushi and QuickLook alike.

**Requires** Zotero 10. macOS 12+, or Linux with GNOME Sushi, or Windows with
QuickLook running.

## 1.3.4 — 2026-09-02

Internal hardening; nothing changes for a reader.

- The four modules are sealed or frozen, and the type checker now runs in
  `npm test`. A misspelt method name anywhere in the plugin is caught before
  it ships.
- A preference call loses two arguments Zotero 7 had stopped reading. Two
  wrong comments corrected.

**Requires** Zotero 10. macOS 12+, or Linux with GNOME Sushi, or Windows with
QuickLook running.

## 1.3.3 — 2026-09-02

Windows follow-ups.

- The QuickLook and GNOME Sushi previews close when you click a page of the
  contact sheet, and the reader opens behind them, as the windowed sheet
  already did.
- EPUB page links land on the position the reader keeps for the page. In
  paginated mode a mark that falls mid-column shows the column's page;
  scrolled mode lands exactly.

The macOS build carries the signed qlpreview helper; Windows and Linux need
no binary.

## 1.3.2 — 2026-09-01

Mostly Linux, and one change to the windowed sheet.

- **Escape closes a Sushi preview from Zotero.** GNOME hands the preview the
  keyboard, so Zotero's keys cannot reach it; Escape in Zotero now sends
  Sushi its own Close command. The documentation says which keys never
  arrive.
- **Arrow keys in the preview walk the item list,** as they do in GNOME's
  Files, and the preview follows once the keys come to rest. It is a setting.
- **The windowed sheet closes when it hands over** to the reader, as the
  system previews do.
- **Space or q closes the windowed sheet,** as either closes Sushi and
  QuickLook.

**Requires** Zotero 10. macOS 12+, or Linux with GNOME Sushi, or Windows with
QuickLook running.

## 1.3.1 — 2026-09-01

Windows fixes, and the shortcuts close what they open.

- Kept previews survive a restart on Windows. They had been written into
  Zotero's temp directory, which Zotero empties on shutdown.
- A kept entry with read-only EPUB files can be deleted on Windows.
- Escape, or the shortcut a second time, closes the QuickLook preview and the
  windowed sheet. A preview opened from the context menu no longer takes the
  keyboard from Zotero.

No new features, no settings to revisit.

**Requires** Zotero 10. macOS 12+, or Linux with GNOME Sushi, or Windows with
QuickLook running.

## 1.3.0 — 2026-08-30

**A page overview for books.** Ctrl+Shift+Space on an EPUB now gives a
contact sheet. A reflowable book has no pages of its own, but one published
beside a print edition usually carries that edition's page marks, and the
sheet cuts the book at them.

- Each tile is the page's own text in the book's typography, shrunk.
- A click opens the book at that page in Zotero's reader.
- Annotations are drawn in.
- A book without printed page numbers says so.

The sheet is kept like the EPUB preview and survives restarts.

**Requires** Zotero 7 or later. macOS 12+, or Linux with GNOME Sushi, or
Windows with QuickLook running.

## 1.2.3 — 2026-08-30

**The windowed sheet moves to Ctrl+Alt+Space.** Ctrl+Shift+Space shows the
contact sheet in the system's preview, Ctrl+Alt+Space in a Zotero window.
The combination is free on all three systems, checked against their own
shortcut lists. One caveat: on a Mac with several input sources, macOS takes
Ctrl+Option+Space for switching between them; set another combination under
Settings → zotLook → Shortcuts. Your own shortcuts are untouched; only the
default moves.

## 1.2.2 — 2026-08-30

- **The windowed sheet moves to Ctrl+Shift+Tab.** Shift+Alt+Space was hard
  to reach, and plain Shift+Tab is how Zotero moves focus backwards. Your own
  choice is untouched.
- **The conflict check sees more.** It only knew the main window's `<key>`
  elements; Zotero binds many shortcuts in code instead, so Shift+Tab was
  reported as free. Those keys are in the register now, with names.

## 1.2.1 — 2026-08-30

- **Kept previews survive a restart.** They never did: the store sat in
  Zotero's temp directory, which Zotero removes on exit. It is now in the
  profile's cache directory, per profile and not backed up with the library;
  the settings pane names the folder.
- **Wording.** The German settings say *zwischengespeicherte* rather than
  *behaltene* previews, and the EPUB help no longer claims a preview extension
  renders the book better; the setting is a choice.

## 1.2.0 — 2026-08-30

- **EPUB previews show your annotations,** in their colours, highlights and
  underlines drawn as Zotero draws them. The stored EPUB CFI is resolved, so a
  passage is marked where you marked it. Other plugins' palettes work too.
- **The book is read from its archive** through Gecko's own zip reader; no
  more external `unzip` or `bsdtar`, no temp directory.
- **Contents and annotations as menus,** behind a button in each corner,
  opening over the text. All markup and CSS, since a preview panel runs no
  scripts.
- **Previews outlive the session.** Contact sheet, EPUB preview and the
  annotated PDF copy share one store. Two settings renamed, values carried
  over; annotations get a switch per format.
- Also: shortcut recording reports a combination that never reaches Zotero; a
  conflict is shown under its row and stays; nine screenshots in README and
  docs; the English documentation is en-GB.

## 1.1.9 — 2026-08-29

- **The delete button works, and the figure beside it shows.** Both had been
  running into nothing: the preferences pane could not reach the plugin
  object. It reaches it through `Zotero.zotLook` now, and two tests keep it
  that way.
- The plugin's objects are named after it, with a small z: `zotLook`,
  `zotLookUtil` and so on.

## 1.1.8 — 2026-08-29

- **Kept sheets can be deleted.** Under Settings → zotLook: a button clears
  them at once, with the space they take shown beside it, and sheets unused
  for 30 days are dropped at startup. A `0` switches that off.
- The English documentation is declared as en-GB, pages and PDF alike.

## 1.1.7 — 2026-08-29

**A contact sheet is kept and shown again.** Drawing every page of a long
book takes seconds and was done on every press. The sheet is now kept until
the file, its annotations, the column count or the page limit change. It
lives in the system's temp area, not in your library. Settings → zotLook →
Keep contact sheets, on by default.

## 1.1.6 — 2026-08-25

**⌘C copies from the preview.** It did nothing before, while the context
menu copied fine: the preview helper had no menu bar, and macOS resolves ⌘C
through the main menu. The helper now carries a minimal, never shown menu.
Reported against the upstream plugin as a `qlmanage` problem; it was not.

## 1.1.5 — 2026-08-24

**A table of contents in the EPUB preview.** It opens at the top, folds away,
and an entry jumps to the chapter. Built from the book's own navigation, EPUB
3 and EPUB 2 alike, without a script: `<details>` and in-page anchors work in
Quick Look. A book without navigation gets no box.

## 1.1.4 — 2026-08-24

**The contact sheet says how far it has got.** The progress window names the
page it is on, `147 / 300`, and the indicator advances.

## 1.1.3 — 2026-08-20

Windows gets a real preview, and the plugin an icon.

- **Space works on Windows,** through QuickLook's named pipe: the same line
  shows and dismisses the preview, so Space toggles as everywhere else. Both
  the Store and the website build answer. The contact sheet is enabled there
  too; a click on a page opens Zotero's reader.
- **EPUBs unpack on Windows** with the bundled bsdtar; before, the first step
  failed for lack of `unzip`.
- **The plugin has an icon:** a four-by-four contact sheet whose marked pages
  form a Z, drawn per size.
- Also: `build.sh` no longer packages a nameless XPI when the version comes
  out empty; the tests run on Windows. There is no 1.1.2.

## 1.1.1 — 2026-08-20

- **A click on a page in the Quick Look preview opens it** in Zotero's reader
  at that page. Quick Look refuses ordinary navigation but hands a new-window
  request to the system.
- **The contact sheet shortcut moves to Ctrl+Shift+Space.** Alt+Space is the
  window menu on GNOME and Windows and never reached Zotero. Your own
  shortcut is untouched.
- **Linux:** the preview arrives, as zotLook now waits for Sushi's reply; a
  click on the sheet no longer replaces it with an error; the plugin builds
  without `swiftc`.
- The README no longer reads as if macOS were the only platform.

## 1.1.0 — 2026-08-20

First release of this fork. Compatible with Zotero 7 and 10.

- **Annotations** appear in previews and on contact sheets: highlights,
  underlines, notes, areas and ink. Attachments without any cost nothing; the
  export is reused until an annotation changes. Can be switched off.
- **The contact sheet works everywhere,** rendered with Zotero's own pdf.js
  instead of a macOS-only binary. On Windows it opens in a Zotero window;
  that window exists on every platform, with live page links.
- **Settings** under Settings → zotLook: shortcuts, checked against Zotero's;
  columns and page limit; which attachment wins; annotations; whether zotLook
  renders EPUBs itself.
- Also: video previews no longer crash; preview on Linux through GNOME Sushi;
  German translation; only one attachment is resolved per item; automatic
  updates, lint, tests and a release build in CI.
- **Credit:** the Quick Look plugin is Mikko Rönkkö's idea; this code comes
  from Guillaume Chapron's
  [Zotero7QuickLook](https://github.com/gchapron/Zotero7QuickLook), about
  half of which is still in place.
