# Item context menu
zotlook-menu-preview = Quick Look
zotlook-menu-contactsheet = Quick Look Contact Sheet
zotlook-menu-contactsheet-window = Contact Sheet in a Window (clickable)

# Progress window shown while a contact sheet is being rendered
zotlook-progress-headline = Quick Look
zotlook-progress-contactsheet = Generating contact sheet…
zotlook-progress-download = Downloading file…

# Preference pane
zotlook-prefs-shortcuts-title = Keyboard shortcuts
zotlook-prefs-shortcuts-help = Click a button and press the combination you want. Escape leaves it unchanged.
zotlook-prefs-shortcuts-reset =
    .label = Restore defaults
zotlook-prefs-key-preview = Preview
zotlook-prefs-key-notes = Preview notes
zotlook-prefs-key-contactsheet = Contact sheet
zotlook-prefs-key-contactsheet-window = Contact sheet in a window
zotlook-prefs-key-clear =
    .label = Reset
zotlook-prefs-key-unset =
    .label = Not set
zotlook-prefs-key-recording =
    .label = Press keys…
zotlook-prefs-conflict = { $shortcut } is already used by { $conflicts }. It can still be used here — note that shortcuts of other plugins and of the system itself cannot be checked.

zotlook-prefs-key-unreachable = That combination did not reach Zotero. The system or another application claims it before Zotero sees it, so zotLook cannot use it — neither macOS nor Windows publishes a list of such shortcuts, which is why this shows up only on trying.
zotlook-prefs-contactsheet-title = Contact sheet
zotlook-prefs-contactsheet-help = The contact sheet shows every page of a PDF as a thumbnail.
zotlook-prefs-contactsheet-maxpages-help = Pages are rendered in parallel and stored as separate image files, so a 300-page book takes about seven seconds and the preview itself stays small — there is normally no reason to limit it. Set a number here only if you work with unusually large scans and want to cap how long generation may take and how much temporary disk space it may use. 0 shows every page.
zotlook-prefs-contactsheet-columns = Columns
zotlook-prefs-contactsheet-columns-hint = fewer columns means larger thumbnails
zotlook-prefs-contactsheet-maxpages = Limit to at most
zotlook-prefs-contactsheet-unit = pages (0 = no limit)
zotlook-prefs-contactsheet-menus-help = A button in each corner of the sheet opens the document's contents and its annotations; a click on an entry brings that page to the middle of the window. The same two buttons are on the page overview of an EPUB.
zotlook-prefs-contactsheet-contents =
    .label = Show the contents button
zotlook-prefs-contactsheet-annotations =
    .label = Show the annotations button
zotlook-prefs-contactsheet-fallback-help = Where there is no system preview to answer Space — Sushi not installed, QuickLook not running — the sheet can open in its window instead, which needs none.
zotlook-prefs-contactsheet-fallback =
    .label = Without a system preview, open the sheet in a window
zotlook-prefs-contactsheet-window-help = The sheet's own window (see the shortcut above) opens at the size it was last left at; drag it to the size you like, or set one here. 0 leaves it to Zotero, which opens it at its minimum. The system previews decide their own size.
zotlook-prefs-contactsheet-window = Window size
zotlook-prefs-contactsheet-window-by = ×
zotlook-prefs-contactsheet-window-hint = pixels (0 = Zotero's minimum)

# Arrow keys in the system preview (Linux only; hidden elsewhere)
zotlook-prefs-arrows-title = Arrow keys in the preview
zotlook-prefs-arrows-help = The system preview keeps the arrow keys and reports each press as selection movement — that is how Files walks its list with the preview open. With this on, zotLook answers the same way: arrows walk your item list and the preview follows. Off, they do nothing there. Scrolling inside the preview itself is the wheel's job, or the Page keys after a click into the window.
zotlook-prefs-arrows-walk =
    .label = Arrow keys in the preview walk the item list

# Attachment priority
zotlook-prefs-attachment-title = Which attachment to preview
zotlook-prefs-attachment-help = When an item holds more than one attachment, only one is previewed. This decides which.
zotlook-prefs-attachment-mode = Choose by
zotlook-prefs-attachment-mode-type =
    .label = Preferred type (order below)
zotlook-prefs-attachment-mode-first =
    .label = First attachment in the item
zotlook-prefs-order-up =
    .label = Move up
zotlook-prefs-order-down =
    .label = Move down
zotlook-prefs-type-pdf = PDF
zotlook-prefs-type-epub = EPUB
zotlook-prefs-type-html = HTML / snapshot
zotlook-prefs-type-image = Image
zotlook-prefs-type-video = Video
zotlook-prefs-type-other = Anything else

# EPUB rendering
zotlook-prefs-epub-title = EPUB
zotlook-prefs-epub-help = No system preview shows an EPUB on its own, so zotLook builds one: the book is unpacked and its chapters joined into a single styled page. If you would rather use a preview extension of the operating system than the one built into zotLook, you can switch zotLook's EPUB preview off here. With no such extension installed, EPUB attachments then have no preview at all.
zotlook-prefs-epub-own =
    .label = Render EPUB with zotLook

# PDF annotations

zotlook-sheet-truncated = Showing the first { $shown } of { $total } pages.

zotlook-epub-contents = Contents

zotlook-epub-annotations = Annotations

zotlook-epub-goto = Go to the passage

zotlook-epub-nopages = This book carries no printed page numbers.

zotlook-epub-nopages-hint = An EPUB reflows and has no pages of its own. A page overview can only show the pagination of a printed edition where the file carries it — this one does not. Use the ordinary preview to read the book.

zotlook-epub-frontmatter = Before page one

# The annotations menu of a sheet: the link an entry carries ("Page 12"),
# and what an annotation with nothing to quote and nothing said is called
zotlook-sheet-page = Page
zotlook-sheet-note = Note
zotlook-sheet-image = Image
zotlook-sheet-ink = Ink
zotlook-sheet-text = Text
# The search field of a sheet in its own window: placeholder, the answer
# with no match, and the unit beside the count of matching pages
zotlook-sheet-search = Search pages
zotlook-sheet-search-none = No matches
zotlook-sheet-pages = pages
# Over the window while the sheet is still loading
zotlook-sheet-loading = Laying out the contact sheet…
# The window's title
zotlook-sheet-title = Contact Sheet
# The link on an annotation that opens the reader at the annotation
zotlook-sheet-open = Open in the reader
# The item pane's section: its header, the sidenav button's tooltip, and
# the three buttons in it
zotlook-pane-header = zotLook
zotlook-pane-sidenav =
    .tooltiptext = zotLook: preview, contact sheet, window
zotlook-pane-preview = Preview
zotlook-pane-sheet = Contact sheet
zotlook-pane-window = Sheet in a window

zotlook-prefs-keep-title = Kept previews

zotlook-prefs-keep =
    .label = Keep converted previews and show them again

zotlook-prefs-keep-help = Drawing every page of a long book, or reading an EPUB out of its archive and reassembling it, takes seconds. What has been made once is shown again unchanged until the file, its annotations or the settings behind it have changed. Kept previews live in the profile's cache area and are not backed up with your library.

zotlook-prefs-keep-days = Drop previews unused for

zotlook-prefs-keep-days-hint = days (0 keeps them until the system clears its temporary files)

zotlook-prefs-keep-size = Currently kept: { $size }

zotlook-prefs-keep-purge =
    .label = Delete kept previews

zotlook-prefs-annotations-title = Annotations

zotlook-prefs-annotations-help = Zotero keeps annotations in its database rather than in the file, so previewing the stored document shows it unmarked. Attachments that carry none are recognised before any work begins, so the settings only matter for documents you have actually marked up.

zotlook-prefs-pdf-annotations =
    .label = Draw them into PDF previews and contact sheets

zotlook-prefs-epub-annotations =
    .label = Mark them in EPUB previews
