# Kontextmenü der Eintragsliste
# "Übersicht" ist Apples eigener Begriff für Quick Look im deutschen Finder
# (Finder MenuBar.strings, 300780.title), daher hier übernommen.
zotlook-menu-preview = Übersicht
zotlook-menu-contactsheet = Seitenübersicht
zotlook-menu-contactsheet-window = Seitenübersicht im Fenster (klickbar)

# Fortschrittsfenster während die Seitenübersicht erzeugt wird
zotlook-progress-headline = Übersicht
zotlook-progress-contactsheet = Seitenübersicht wird erstellt …
zotlook-progress-download = Datei wird geladen …

# Einstellungsbereich
zotlook-prefs-shortcuts-title = Tastenkürzel
zotlook-prefs-shortcuts-help = Knopf anklicken und die gewünschte Kombination drücken. Escape lässt sie unverändert.
zotlook-prefs-shortcuts-reset =
    .label = Vorgaben wiederherstellen
zotlook-prefs-key-preview = Übersicht
zotlook-prefs-key-notes = Notizen anzeigen
zotlook-prefs-key-contactsheet = Seitenübersicht
zotlook-prefs-key-contactsheet-window = Seitenübersicht im Fenster
zotlook-prefs-key-clear =
    .label = Zurücksetzen
zotlook-prefs-key-unset =
    .label = Nicht belegt
zotlook-prefs-key-recording =
    .label = Tasten drücken …
zotlook-prefs-conflict = { $shortcut } ist bereits belegt durch { $conflicts }. Die Kombination lässt sich dennoch verwenden — Kürzel anderer Plugins und des Systems selbst sind nicht prüfbar.

zotlook-prefs-key-unreachable = Diese Kombination ist nicht bei Zotero angekommen. Das System oder eine andere Anwendung greift vor Zotero zu, zotLook kann sie also nicht verwenden — weder macOS noch Windows veröffentlicht eine Liste solcher Kürzel, deshalb zeigt sich das erst beim Versuch.
zotlook-prefs-contactsheet-title = Seitenübersicht
zotlook-prefs-contactsheet-help = Die Seitenübersicht zeigt jede Seite eines PDFs als Miniatur.
zotlook-prefs-contactsheet-maxpages-help = Die Seiten werden parallel gerendert und als einzelne Bilddateien abgelegt; ein 300-seitiges Buch dauert damit rund sieben Sekunden, und die Vorschau selbst bleibt klein — eine Begrenzung ist im Regelfall nicht nötig. Trage hier nur dann eine Zahl ein, wenn Du mit ungewöhnlich großen Scans arbeitest und begrenzen willst, wie lange die Erzeugung dauern und wie viel temporären Speicherplatz sie belegen darf. 0 zeigt alle Seiten.
zotlook-prefs-contactsheet-columns = Spalten
zotlook-prefs-contactsheet-columns-hint = weniger Spalten bedeutet größere Miniaturen
zotlook-prefs-contactsheet-maxpages = Höchstens
zotlook-prefs-contactsheet-unit = Seiten (0 = ohne Begrenzung)

# Anhang-Priorität
zotlook-prefs-attachment-title = Welcher Anhang angezeigt wird
zotlook-prefs-attachment-help = Enthält ein Eintrag mehrere Anhänge, wird nur einer angezeigt. Das hier entscheidet, welcher.
zotlook-prefs-attachment-mode = Auswahl nach
zotlook-prefs-attachment-mode-type =
    .label = Bevorzugtem Typ (Reihenfolge unten)
zotlook-prefs-attachment-mode-first =
    .label = Erstem Anhang im Eintrag
zotlook-prefs-order-up =
    .label = Nach oben
zotlook-prefs-order-down =
    .label = Nach unten
zotlook-prefs-type-pdf = PDF
zotlook-prefs-type-epub = EPUB
zotlook-prefs-type-html = HTML / Schnappschuss
zotlook-prefs-type-image = Bild
zotlook-prefs-type-video = Video
zotlook-prefs-type-other = Alles Übrige

# EPUB-Darstellung
zotlook-prefs-epub-title = EPUB
zotlook-prefs-epub-help = Keine Systemvorschau zeigt EPUBs von sich aus an, deshalb baut zotLook selbst eine: das Buch wird entpackt und seine Kapitel zu einer gestalteten Seite zusammengefügt. Eine Vorschau-Erweiterung für EPUB stellt das Buch in aller Regel besser dar — schalte dies aus, um ihr den Vortritt zu lassen. Ohne eine solche Erweiterung haben EPUB-Anhänge dann gar keine Vorschau.
zotlook-prefs-epub-own =
    .label = EPUB mit zotLook darstellen

# PDF-Annotationen

zotlook-sheet-truncated = Es werden die ersten { $shown } von { $total } Seiten gezeigt.

zotlook-epub-contents = Inhalt

zotlook-epub-annotations = Annotationen

zotlook-epub-goto = Zur Stelle im Text

zotlook-prefs-keep-title = Behaltene Vorschauen

zotlook-prefs-keep =
    .label = Erzeugte Vorschauen behalten und wiederverwenden

zotlook-prefs-keep-help = Jede Seite eines langen Buches zu zeichnen oder ein EPUB zu entpacken und neu zusammenzusetzen dauert Sekunden. Einmal Erzeugtes wird unverändert wieder gezeigt, bis sich die Datei, ihre Annotationen oder die Einstellungen darunter geändert haben. Behaltene Vorschauen liegen im temporären Bereich des Systems und werden nicht mit Ihrer Bibliothek gesichert.

zotlook-prefs-keep-days = Ungenutzte Vorschauen verwerfen nach

zotlook-prefs-keep-days-hint = Tagen (0 behält sie, bis das System seine temporären Dateien räumt)

zotlook-prefs-keep-size = Derzeit belegt: { $size }

zotlook-prefs-keep-purge =
    .label = Behaltene Vorschauen löschen

zotlook-prefs-annotations-title = Annotationen

zotlook-prefs-annotations-help = Zotero bewahrt Annotationen in seiner Datenbank auf und nicht in der Datei; eine Vorschau des gespeicherten Dokuments zeigt es deshalb unmarkiert. Anhänge ohne Annotationen werden erkannt, bevor irgendeine Arbeit beginnt — die Einstellungen wirken sich also nur auf Dokumente aus, die Sie tatsächlich bearbeitet haben.

zotlook-prefs-pdf-annotations =
    .label = In PDF-Vorschau und Seitenübersicht einzeichnen

zotlook-prefs-epub-annotations =
    .label = In EPUB-Vorschauen markieren
