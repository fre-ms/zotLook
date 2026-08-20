# Item context menu
zotlook-menu-preview = Quick Look
zotlook-menu-contactsheet = Quick Look Contact Sheet
zotlook-menu-contactsheet-window = Contact Sheet in a Window (clickable)

# Progress window shown while a contact sheet is being rendered
zotlook-progress-headline = Quick Look
zotlook-progress-contactsheet = Generating contact sheet…

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
zotlook-prefs-conflict = { $shortcut } is already used by { $conflicts }. It can still be used here — note that shortcuts of other plugins and of macOS itself cannot be checked.
zotlook-prefs-contactsheet-title = Contact sheet
zotlook-prefs-contactsheet-help = The contact sheet shows every page of a PDF as a thumbnail.
zotlook-prefs-contactsheet-maxpages-help = Pages are rendered in parallel and stored as separate image files, so a 300-page book takes about seven seconds and the preview itself stays small — there is normally no reason to limit it. Set a number here only if you work with unusually large scans and want to cap how long generation may take and how much temporary disk space it may use. 0 shows every page.
zotlook-prefs-contactsheet-columns = Columns
zotlook-prefs-contactsheet-columns-hint = fewer columns means larger thumbnails
zotlook-prefs-contactsheet-maxpages = Limit to at most
zotlook-prefs-contactsheet-unit = pages (0 = no limit)

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
zotlook-prefs-epub-help = macOS shows no EPUB preview on its own, so zotLook builds one: the book is unpacked and its chapters joined into a single styled page. A Quick Look extension that handles EPUB will usually render the book better. Turn this off to let such an extension take over — with none installed, EPUB attachments then have no preview at all.
zotlook-prefs-epub-own =
    .label = Render EPUB with zotLook

# PDF annotations
zotlook-prefs-pdf-title = PDF
zotlook-prefs-pdf-help = Zotero stores annotations in its database, not in the PDF itself, so previewing the stored file shows an unmarked document. With this on, a copy with the annotations drawn in is exported and used instead — for the preview and for the contact sheet alike. Attachments without annotations are recognised beforehand and cost nothing. Turn this off to see the files exactly as they are stored.
zotlook-prefs-pdf-annotations =
    .label = Show annotations in previews and contact sheets

zotlook-sheet-truncated = Showing the first { $shown } of { $total } pages.
