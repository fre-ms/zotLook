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
zotlook-prefs-contactsheet-menus-help = In den Ecken der Übersicht öffnen zwei Knöpfe das Inhaltsverzeichnis des Dokuments und seine Annotationen; ein Klick auf einen Eintrag holt die Seite in die Mitte des Fensters. Dieselben Knöpfe hat die Seitenübersicht eines EPUB.
zotlook-prefs-contactsheet-contents =
    .label = Knopf für das Inhaltsverzeichnis anzeigen
zotlook-prefs-contactsheet-annotations =
    .label = Knopf für die Annotationen anzeigen
zotlook-prefs-contactsheet-fallback-help = Wo keine Systemvorschau auf die Leertaste antwortet — Sushi nicht installiert, QuickLook nicht gestartet —, kann sich stattdessen der Bogen in seinem Fenster öffnen, das keine braucht.
zotlook-prefs-contactsheet-fallback =
    .label = Ohne Systemvorschau den Bogen im Fenster öffnen
zotlook-prefs-contactsheet-window-help = Das eigene Fenster des Bogens (Kürzel oben) öffnet in der Größe, in der es zuletzt gelassen wurde; ziehen Sie es nach Wunsch auf, oder tragen Sie hier eine Größe ein. 0 überlässt es Zotero, das es in seiner Mindestgröße öffnet. Die Systemvorschauen bestimmen ihre Größe selbst.
zotlook-prefs-contactsheet-window = Fenstergröße
zotlook-prefs-contactsheet-window-by = ×
zotlook-prefs-contactsheet-window-hint = Pixel (0 = Zoteros Minimum)

# Pfeiltasten in der Systemvorschau (nur Linux; sonst verborgen)
zotlook-prefs-arrows-title = Pfeiltasten in der Vorschau
zotlook-prefs-arrows-help = Die Systemvorschau behält die Pfeiltasten und meldet jeden Druck als Auswahlbewegung — so wandert Dateien bei offener Vorschau durch seine Liste. Ist dies an, antwortet zotLook genauso: Pfeiltasten wandern durch die Trefferliste, die Vorschau zieht nach. Aus heißt: sie tun dort nichts. Geblättert wird in der Vorschau selbst mit dem Mausrad — oder mit den Bild-Tasten nach einem Klick in das Fenster.
zotlook-prefs-arrows-walk =
    .label = Pfeiltasten in der Vorschau wandern durch die Trefferliste

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
zotlook-prefs-epub-help = Keine Systemvorschau zeigt EPUBs von sich aus an, deshalb baut zotLook selbst eine: das Buch wird entpackt und seine Kapitel zu einer gestalteten Seite zusammengefügt. Wenn Sie statt der in zotLook integrierten Vorschau lieber eine Vorschau-Erweiterung des Betriebssystems nutzen möchten, können Sie die zotLook-EPUB-Vorschau hier deaktivieren. Ohne eine solche Erweiterung haben EPUB-Anhänge dann gar keine Vorschau.
zotlook-prefs-epub-own =
    .label = EPUB mit zotLook darstellen

# PDF-Annotationen

zotlook-sheet-truncated = Es werden die ersten { $shown } von { $total } Seiten gezeigt.

zotlook-epub-contents = Inhalt

zotlook-epub-annotations = Annotationen

zotlook-epub-goto = Zur Stelle im Text

zotlook-epub-nopages = Dieses Buch führt keine gedruckten Seitenzahlen.

zotlook-epub-nopages-hint = Ein EPUB fließt um und hat keine eigenen Seiten. Eine Seitenübersicht kann nur die Paginierung einer gedruckten Ausgabe zeigen, sofern die Datei sie mitführt — diese tut es nicht. Zum Lesen dient die gewöhnliche Vorschau.

zotlook-epub-frontmatter = Vor Seite eins

# Das Annotationsmenü einer Seitenübersicht: der Verweis eines Eintrags
# („Seite 12") und die Bezeichnung einer Annotation ohne Zitat und Kommentar
zotlook-sheet-page = Seite
zotlook-sheet-note = Notiz
zotlook-sheet-image = Bild
zotlook-sheet-ink = Freihand
zotlook-sheet-text = Text
# Das Suchfeld einer Übersicht im eigenen Fenster: Platzhalter, die Antwort
# ohne Treffer und die Einheit neben der Zahl der Seiten mit Treffern
zotlook-sheet-search = Seiten durchsuchen
zotlook-sheet-search-none = Keine Treffer
zotlook-sheet-pages = Seiten
# Über dem Fenster, solange die Übersicht noch lädt
zotlook-sheet-loading = Kontaktbogen wird aufgebaut …
# Der Fenstertitel
zotlook-sheet-title = Kontaktbogen
# Der Link an einer Annotation, der den Reader an der Annotation öffnet
zotlook-sheet-open = Im Reader öffnen
# Der Abschnitt im Eintragsfenster: Überschrift, Tooltip des Seitenleisten-Knopfs
# und die drei Knöpfe darin
zotlook-pane-header = zotLook
zotlook-pane-sidenav =
    .tooltiptext = zotLook: Vorschau, Kontaktbogen, Fenster
zotlook-pane-preview = Vorschau
zotlook-pane-sheet = Kontaktbogen
zotlook-pane-window = Bogen im Fenster

zotlook-prefs-keep-title = Zwischengespeicherte Vorschauen

zotlook-prefs-keep =
    .label = Erzeugte Vorschauen zwischenspeichern und wiederverwenden

zotlook-prefs-keep-help = Jede Seite eines langen Buches zu zeichnen oder ein EPUB zu entpacken und neu zusammenzusetzen dauert Sekunden. Einmal Erzeugtes wird unverändert wieder gezeigt, bis sich die Datei, ihre Annotationen oder die Einstellungen darunter geändert haben. Zwischengespeicherte Vorschauen liegen im Cache-Bereich des Profils und werden nicht mit Ihrer Bibliothek gesichert.

zotlook-prefs-keep-days = Ungenutzte Vorschauen verwerfen nach

zotlook-prefs-keep-days-hint = Tagen (0 behält sie, bis das System seine temporären Dateien räumt)

zotlook-prefs-keep-size = Derzeit belegt: { $size }

zotlook-prefs-keep-purge =
    .label = Zwischengespeicherte Vorschauen löschen

zotlook-prefs-annotations-title = Annotationen

zotlook-prefs-annotations-help = Zotero bewahrt Annotationen in seiner Datenbank auf und nicht in der Datei; eine Vorschau des gespeicherten Dokuments zeigt es deshalb unmarkiert. Anhänge ohne Annotationen werden erkannt, bevor irgendeine Arbeit beginnt — die Einstellungen wirken sich also nur auf Dokumente aus, die Sie tatsächlich bearbeitet haben.

zotlook-prefs-pdf-annotations =
    .label = In PDF-Vorschau und Seitenübersicht einzeichnen

zotlook-prefs-epub-annotations =
    .label = In EPUB-Vorschauen markieren
