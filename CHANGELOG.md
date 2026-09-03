<!-- Generated from doc/en/history.qmd by tool/changelog.mjs. Edit there. -->
# Changelog

Every release of zotLook, newest first, with the notes it was published
with. This text is the source of the release notes on GitHub and of
`CHANGELOG.md` in the repository. Versions are the plugin's own; a date is
the day the release was published.

## 1.4.1 — 2026-09-03

Two repairs to the sheet in its own Zotero window, both found on GNOME.

**A menu entry jumps without a dialog.** Following an entry of the contents
or the annotations menu in the windowed sheet raised a dialog asking which
application should handle file links: a menu entry is a fragment link, a
fragment link is a navigation, and the window's browser shim turned that
navigation into a file for something to open. The click is now answered
instead — the sheet scrolls to the tile and marks it as the jump would have
— and the address never changes. Where scripts do not run, as in the system
previews, the entries are the plain anchors they were and jump as before. A
page tile's link still leads to the reader, since that navigation is the
point of it.

**The window closes again when it hands over.** A click on a page opens the
reader, and the sheet's window is meant to close behind it; it had stopped
doing so, because it decided whether the reader was its own doing by who
held the keyboard — and the window Gecko opens for a page link takes the
keyboard first. The sheet now knows which attachment it was drawn from, and
a reader opening for that attachment is its own handoff, whoever holds the
keyboard. A reader opening for anything else leaves the window standing.

**Requires** Zotero 10 — the version zotLook is developed and tested against.
macOS 12+, or Linux with GNOME Sushi, or Windows with QuickLook running.

## 1.4.0 — 2026-09-02

The contact sheet gets the two buttons the EPUB preview has: the document's
contents in one corner, its annotations in the other, and every entry a jump
to its page — the tile framed and brought to the middle of the window. A click
on the tile still hands over to the reader. The page overview of an EPUB has
the same two buttons.

**Contents** come out of the PDF's outline, read by the renderer and resolved
to pages, named destinations included. A PDF without an outline gets no button.

**Annotations** come from Zotero's database, in reading order: the quotation
marked as it is marked on the page, the comment, and "Page 12" — the printed
label where the PDF names its pages. Notes, areas and ink are listed by their
kind.

**Two settings**, both on by default, switch the buttons off. They count
towards a kept sheet, as does the state of the annotations on its own account,
so a new highlight reaches the list even where nothing is drawn in.

None of it uses a script — a preview panel runs none — which is why it works in
Quick Look, GNOME Sushi and QuickLook alike. The documentation shows it in
motion, and its PDF now carries version and date in the footer.

**Requires** Zotero 10 — the version zotLook is developed and tested against.
macOS 12+, or Linux with GNOME Sushi, or Windows with QuickLook running.

## 1.3.4 — 2026-09-02

Internal hardening. Nothing changes for a reader; this is the release the
plugin's own checks now stand behind.

**The modules are closed.** Each of the plugin's four modules is sealed or
frozen, and three fields that used to appear on first use are declared. That
is what lets the type checker — which now runs in `npm test` — see a misspelt
method name anywhere in the plugin, the mistake it could not see before.

**A preference call loses two arguments** it had carried since the XPCOM
days, ignored since Zotero 7. Comments that described two functions as
returning the opposite of what they return are corrected.

**Requires** Zotero 10 — the version zotLook is developed and tested against.
macOS 12+, or Linux with GNOME Sushi, or Windows with QuickLook running.

## 1.3.3 — 2026-09-02

Windows preview follow-ups.

- The QuickLook and GNOME Sushi previews now close when you click a page of the contact sheet, opening the reader behind them — as the windowed sheet already did.
- EPUB page links address the exact position the reader keeps for each page. Where a page's mark falls mid-column, Zotero's paginated reader names the containing page (its own page navigation does the same); scrolled flow lands on it exactly.

The macOS build carries the signed qlpreview helper. Windows and Linux need no bundled binary.

## 1.3.2 — 2026-09-01

Linux, mostly — and one change to the windowed contact sheet.

**Escape closes a Sushi preview from Zotero.** The moment a preview opens,
GNOME hands it the keyboard, and Sushi answers only its own keys: Space,
Escape and q close it, the arrows are its accelerators, and a chord it does
not know falls on the floor. No plugin can hear a key the compositor gave to
someone else, so zotLook answers well where it does hear: Escape back in
Zotero now sends Sushi's own Close over the bus, and the documentation says
plainly which keys never arrive.

**Arrows walk the item list from inside the preview,** the way GNOME's Files
walks a folder. Sushi puts every arrow press on the bus, and zotLook listens:
the selection moves at once and the preview follows once the keys come to
rest, so a held arrow is one preview rather than a storm of them — and no
download per row on a download-as-needed library. It is a setting, since
whether arrows should do this at all is taste.

**The windowed contact sheet closes when it hands over.** Clicking a page
opened the reader behind the window, which stayed in front of it. Standing
beside the reader had been the window's advertised reason to exist, and the
opposite turned out to be the right behaviour — the system preview already
closed as it handed over. Now the window does too, on every route.

**Its own window answers the preview's keys.** A bare Space or q closes the
windowed sheet, as either closes Sushi and QuickLook — kept out of modifier
chords and typing fields.

**Requires** Zotero 10 — the version zotLook is developed and tested against.
macOS 12+, or Linux with GNOME Sushi, or Windows with QuickLook running.

## 1.3.1 — 2026-09-01

Windows preview fixes, and the shortcuts now close what they open.

**Kept previews survive a restart on Windows.** They had been written inside
Zotero's own temp directory, which Zotero empties on every shutdown — so the
contact sheet and the EPUB preview were rebuilt from scratch each time, and
the settings pane always reported 0 B.

**A kept entry whose EPUB assets were read-only can be removed.** On Windows
such an entry lingered for good; the write bit is put back before the entry
is deleted.

**Escape and the shortcut close the preview.** Pressing the shortcut again,
or Escape, now dismisses the QuickLook preview and the windowed contact
sheet, from every route that can open one — and a preview opened from the
context menu no longer takes the keyboard away from Zotero. The windowed
sheet closes through its own command rather than through the reference the
plugin holds, so it also survives the stray unload the window fires while
loading.

Nothing else changes. There are no new features and no settings to revisit.

**Requires** Zotero 10 — the version zotLook is developed and tested against.
macOS 12+, or Linux with GNOME Sushi, or Windows with QuickLook running.

## 1.3.0 — 2026-08-30

### A page overview for books

`Ctrl+Shift+Space` on an EPUB now gives a contact sheet, which sounds
impossible: a reflowable book has no pages. It has none of its own. But a book
published beside a print edition usually carries that edition's pagination
along with it — marked in the text, listed in the navigation — so that a
citation to page 212 still means something. Where those marks are there,
zotLook cuts the book at them and shows a page at a time.

- Each tile is that page's own text in the book's own typography, shrunk rather
  than re-typeset, so the line breaks and the proportions are the book's.
- Clicking a page opens the book at it in Zotero's reader, as the PDF sheet's
  thumbnails do.
- Annotations are drawn in, as on the PDF sheet and in the EPUB preview.
- A book carrying no printed page numbers says so, rather than showing
  arbitrary slices. Most trade fiction carries none; Springer, O'Reilly and
  most textbooks do.

The sheet goes through the same store as the EPUB preview, so it survives
restarts and is cleared and aged out with everything else. Nothing else about
the plugin changes.

**Requires** Zotero 7 or later. macOS 12+, or Linux with GNOME Sushi, or
Windows with QuickLook running.

## 1.2.3 — 2026-08-30

### The windowed contact sheet moves to Ctrl+Alt+Space

**Ctrl+Shift+Space** shows the contact sheet in the system's preview panel; **Ctrl+Alt+Space** now shows it in a Zotero window. The same work in a different frame, one modifier apart — where the previous default, Ctrl+Shift+Tab, said nothing about what it does.

Checked on all three systems rather than assumed. Microsoft's own list of Windows shortcuts claims Alt+Space (window menu), Ctrl+Space (Chinese IME) and Win+Space with Win+Shift+Space (input languages) — and not Ctrl+Alt+Space. That list is also why the Windows key is no candidate: Win+Space is spoken for, and Win combinations rarely reach an application at all. GNOME takes Alt+Space and usually Super+Space, not this one. Zotero binds no key to the space bar and keeps its own configurable shortcuts on single letters.

**One caveat, stated rather than left to be discovered.** macOS lists Ctrl+Option+Space as **previous input source** — switched off where a machine has one input source, and on where it has several. On such a Mac the default is swallowed and nothing happens; **Settings → zotLook → Shortcuts** is where that gets put right.

Your own choice is unaffected: this is the default, and **Restore defaults** is what writes it.

## 1.2.2 — 2026-08-30

### The windowed contact sheet moves to Ctrl+Shift+Tab

Shift+Alt+Space was awkward to reach. Bare **Shift+Tab** could not have it: Zotero moves focus backwards with that key across twenty-two targets — collections pane, item list, item pane, toolbars, tab bar — and since zotLook consumes a matched keystroke, taking it would have stopped anyone tabbing out of the item list.

With Control held, Zotero's focus handler returns at once: it drops any Tab carrying a modifier other than Shift. Its own tab switching sits on Ctrl+PageUp and Ctrl+PageDown, on macOS also on Cmd+Shift+[ / ]; its tab bar is not a XUL tabbox, so the toolkit does not claim Ctrl+Tab the way a browser does; and macOS lists no system shortcut on the Tab key at all.

Your own choice is unaffected — this is the default, and **Restore defaults** is what writes it.

### The conflict check sees more

It was built from the main window's `<key>` elements, which is everything the DOM can be asked for. Zotero binds a good deal in its own keydown listeners instead, so the pane reported **no conflict** for Shift+Tab — worse than reporting nothing, because it sounds like an answer.

Those keys are in the registry now and named, so a warning says what holds the combination.

## 1.2.1 — 2026-08-30

### Kept previews survive a restart

They never did. The store sat inside Zotero's own temp directory, and Zotero registers a shutdown blocker that removes that directory whole at every exit — so a contact sheet or an EPUB preview was gone by the next start, on every platform, and the settings pane truthfully reported 0 B beside **Delete kept previews**.

They live in the profile's cache directory now — `AppData\Local` on Windows, `~/Library/Caches` on macOS, `~/.cache` on Linux. Per-profile, cleared by nobody else, and still not backed up with your library. The settings pane names the folder, so you can delete it by hand with Zotero closed.

Reported from Windows, fixed there, and confirmed on Linux and macOS: a kept entry now outlives repeated restarts, while entries left by an earlier build or an earlier layout are still cleared at startup.

### Wording

The German settings said *behaltene Vorschauen*, which reads like something left lying about; it now says *zwischengespeicherte*.

The EPUB help claimed a preview extension "will usually render the book better". That was fair when the conversion was a few chapters concatenated — it is not a claim to keep making now that the page carries the book's own typography, its table of contents and its annotations, and it is not zotLook's place to rank someone else's extension either way. The setting is offered as a choice instead.

## 1.2.0 — 2026-08-30

### EPUB previews grow up

An EPUB preview now shows your **annotations**, in their own colours and with the distinction between a highlight and an underline kept — the same way Zotero draws them, because the styling is taken from its reader rather than guessed at.

Zotero stores the position of an EPUB annotation as an [EPUB CFI](https://idpf.org/epub/linking/cfi/): spine item, element path, text node, character offsets. That identifier is now read and resolved against the chapter it addresses, so a passage is marked where it was actually marked — not where a search for its wording happened to land. Palettes beyond Zotero's own eight work too, [zotQDA](https://github.com/fre-ms/zotQDA)'s among them.

The book is also **read out of its archive** now, through Gecko's own zip reader and the EPUB module Zotero uses for its full-text indexing. Gone with them: an external `unzip` (and `bsdtar` on Windows), a subprocess with a timeout, and a directory of loose files to clean up afterwards.

### Contents and annotations as menus

Both sit behind a button in the corner of the preview and open over the text instead of pushing the book down. Each annotation entry shows two lines and unfolds on demand; clicking one takes you to the passage.

All of it is `<details>` and CSS — a preview panel runs no scripts, so a menu that needed one would never open.

### Previews that outlive the session

The contact sheet, the EPUB preview and the annotated copy of a PDF now go through **one store** instead of three arrangements, two of which forgot everything on restart. An EPUB converted once is there in the next session.

Two settings are renamed to say what they govern — **Keep converted previews** and **Drop previews unused for** — and your old values are carried over. Annotations get **a switch per format**: drawing them into a PDF costs a copy of the document, marking an EPUB costs nothing worth naming, so the two are worth deciding separately.

### Also

- Shortcut recording says so when a combination never reaches Zotero, instead of waiting silently for a key the system has already taken.
- A collision with another shortcut is shown under the row it concerns, and stays shown.
- Nine screenshots of the plugin at work on macOS, Linux and Windows, in the README and the documentation.
- The English documentation is declared as en-GB.

## 1.1.9 — 2026-08-29

### The figure beside the delete button

1.1.8 added a button to clear the kept contact sheets and was meant to show, beside it, how much they occupy. It did not — and the button itself did nothing either. It sits in the pane's markup, so it was visible; it simply ran into nothing.

Zotero hands the preferences window only the scripts named in the pane registration. The plugin object lives elsewhere and is not among them, so every call from the pane threw, and the error landed in a `catch` that hid the label. Nothing said why.

The plugin now reaches the pane through `Zotero.zotLook`, the one scope both share, and the pane no longer swallows the error in silence. Two tests cover it: one checks that only names the pane is actually handed are used, the other that the object is published on startup and taken away again on shutdown.

### The name

The plugin is called zotLook, with a small z, and its objects now say so — `zotLook`, `zotLookUtil`, `zotLookEpub`, `zotLookSheet`, `zotLookWinPreview`. Nothing about this is visible in use; it is a matter of the code saying what the thing is called.

## 1.1.8 — 2026-08-29

### Kept sheets can be got rid of

1.1.7 kept contact sheets so a second press would not redraw them. That bought back the wait, but it gave the sheets no way out: a directory nobody looks at, holding a megabyte per book, and no figure anywhere saying so.

Two ways out now, both under **Settings → zotLook**.

**Delete kept sheets** empties them at once, with the space they occupy shown beside the button — without that figure, pressing it would be a guess, and the zero afterwards is the confirmation that it did something.

**Drop sheets unused for 30 days** does it unattended. It counts from the last *use* rather than from when the sheet was built: the key file beside each sheet is rewritten on every hit, so a book you open every week stays and one you looked at once in March goes. The check runs when Zotero starts rather than while you work — a sheet vanishing mid-session would be more confusing than the space it took. A `0` switches it off, and sheets then stay until the system clears its temporary area, which macOS and Linux do on their own and Windows rarely.

### Documentation

The English documentation is now declared as en-GB rather than a bare `en` — on the pages and in the PDF, whose `/Lang` had been resolving to Typst's default region. The prose did not need changing; it was already British.

## 1.1.7 — 2026-08-29

### A contact sheet is kept and shown again

Drawing every page of a long book takes seconds, and until now it was done on every press — the sheet was rebuilt each time, into a directory that Zotero empties on startup, so it could not have survived even if it had been kept.

It is now written beside that directory and shown again unchanged, until something that would make it the wrong answer has changed: the file, its annotations, the column count or the page limit.

The file is recognised by its size and modification time rather than by a digest of its contents. Reading a hundred megabytes to decide whether to skip seven seconds of drawing can cost more than it saves, and Zotero rewrites an attachment rather than editing it in place — so the modification time moves exactly when it matters.

Kept sheets live in the system's temporary area, not in your Zotero library: they are not backed up with it, and the system clears them in its own time.

**Settings → zotLook → Keep contact sheets and show them again**, on by default. Switched off, a sheet is drawn on every call and none outlives the session.

## 1.1.6 — 2026-08-25

### ⌘C copies from the preview

Select text in a preview, press ⌘C, and nothing happened — while the same text copied fine from the context menu. It does now.

The cause was not where it looked. macOS turns ⌘C into a `copy:` action by matching the keystroke against the *main menu's* key equivalents, and only then sends it down the responder chain. zotLook's preview helper had no menu bar at all, so there was no ⌘C to send, however capable the view underneath was. The context menu worked all along because it dispatches `copy:` directly and never consults a menu bar.

The helper now carries a minimal menu — Copy, Select All, Close, Quit. It is never displayed: the helper runs as an accessory application, so it still has no Dock icon and never becomes the active application. The menu exists so that the key equivalents resolve.

This was [reported against the upstream plugin](https://github.com/gchapron/Zotero7QuickLook/issues/4), where it was attributed to `qlmanage`. zotLook does not use `qlmanage` and had the same fault, so that was not the cause.

## 1.1.5 — 2026-08-24

### A table of contents in the EPUB preview

Press Space on an e-book and the preview now opens with the book's contents at the top. It folds away, and clicking an entry jumps to that chapter.

This was the one thing a dedicated e-book viewer offered that zotLook's conversion did not — and it looked impossible to do here. macOS renders previews with JavaScript disabled and refuses ordinary navigation, which rules out every usual way of building one.

It turns out neither is needed. `<details>` opens natively, without a line of script, and an anchor within the same page is followed. Both were measured by clicking them in a real preview rather than assumed, and that is why the contents are built the way they are.

The titles and their nesting come from the navigation the book itself carries — EPUB 3 keeps it in a navigation document, EPUB 2 in an NCX file — so the wording is the publisher's rather than something guessed from headings. Both formats are read. A book that carries no navigation gets no box, because a preview of something without chapters should look like the document rather than like a feature that failed.

## 1.1.4 — 2026-08-24

### The contact sheet says how far it has got

A sheet of a long book takes seconds, and the window said only that it was working. It now names the page it is on — `147 / 300` — and the indicator beside it advances.

Zotero's progress window offers a circular indicator rather than a bar, so the exact count goes in the text beside it. On a three-hundred-page book that tells you more than a bar's position would: not only that it is moving, but how fast.

It never shows the last step as finished. The final page still has to be written and the sheet assembled around it, and an indicator that completed before the window closed would be a small lie.

## 1.1.3 — 2026-08-20

Windows gets a real preview panel, and the plugin gets a face.

### Space works on Windows

zotLook now drives [QuickLook](https://github.com/QL-Win/QuickLook) through its named pipe, `QuickLook.App.Pipe.<user SID>`: one UTF-8 line shows the preview, the same line again dismisses it, and a different path switches. **Space** therefore keeps the toggle it has everywhere else — with no process to hold open and no helper binary to compile, on any platform.

**Both builds answer the pipe.** The Microsoft Store package declares `runFullTrust`, which retires the old conclusion that it was sandboxed away from it. The SID comes from the process token and the line goes out through js-ctypes: a handful of Win32 calls, nothing bundled, nothing new to build.

The **contact sheet** is enabled there too, on a measurement rather than a hope: QuickLook's viewer renders the sheet, loads the thumbnails beside it, and takes no focus from Zotero, so the item list keeps the keyboard. Clicking a page opens Zotero's reader at it, the same as under Quick Look and Sushi.

One rule runs through the implementation: never probe. QuickLook's pipe server takes a line per connection and dereferences whatever it got, so any is-it-there check kills the listener silently until the app is restarted. Every connection made here carries one complete line. That QuickLook is not running is learned from the connect failing, and the log says where to get it.

### EPUBs unpack there

The extractor was `/usr/bin/unzip`, which is a macOS and Linux address — on Windows every EPUB preview would have failed at its first step. Windows has shipped bsdtar since Windows 10; it reads zip containers, the EPUB included, and detects the format itself, so the plugin still bundles nothing.

### The plugin has an icon

The add-ons list drew the generic plugin symbol, and the preference pane sat in the sidebar with no image at all. Both now carry a mark of the plugin's own: a contact sheet, four by four page thumbnails, ten of them marked in the three highlight colours so that together they form a Z.

The letter is carried by marked against unmarked rather than by hue, so it survives greyscale, a dark background and colour blindness alike. Each size is drawn on its own pixel grid rather than scaled from one file — 24 px for the preference sidebar, 32 for the add-ons list, 96 for that list on a 2x display.

### Also

- `build.sh` reads the manifest on one line. pyenv-win relays `python3` through a cmd batch file, and cmd cannot pass an argument with embedded newlines: the version came out empty and the script packaged `zotlook-.xpi` without a word. An empty version now stops the build instead of naming the package after it.
- The suites run on a Windows host, where a URL pathname is not a path.
- There is no 1.1.2. It was built while Windows support was still unreleased, and never published.

## 1.1.1 — 2026-08-20

Repairs for Linux, one change everyone will notice, and something that turned out to work on macOS after all.

### Clicking a page in the Quick Look preview opens it

The contact sheet has always wrapped each thumbnail in a link to that page in Zotero's reader, and those links were thought to be inert under Quick Look, which refuses ordinary navigation. They are not. A **new-window request** takes a different path through WebKit, and Quick Look hands those to the system handler — so a click on a thumbnail opens the reader at that page and closes the preview as it goes.

This was not designed; it fell out of a repair made for Linux, and was then measured properly: the same link without the attribute does nothing but beep.

### The contact sheet shortcut has moved

**Ctrl+Shift+Space**, where it used to be Alt+Space.

Alt+Space was never going to work outside macOS: it is the window menu on GNOME and on Windows, and a window manager claims its combinations before the application is asked, so Zotero never saw the key. The context menu entry worked; the shortcut could not.

Ctrl+Shift+Space is free on all three systems — checked against the system shortcuts on each — so it is now the default everywhere rather than a per-platform choice. Plain Ctrl+Space would not do: it toggles the input method on Linux and switches input source on macOS.

If you had set your own shortcut, it is untouched. Only the default moves.

### Linux

- **The preview arrives.** zotLook asked GNOME Sushi to show a file and carried on without waiting for the reply, so the preview often never appeared.
- **The contact sheet survives a click.** Sushi's HTML view is a real WebKit view and really does follow links, unlike Quick Look. It cannot load a `zotero:` URL, and a failed load is how it reports that it cannot show the file at all — so one click on a thumbnail replaced the whole sheet with "Unable to display". The links now open elsewhere, which Sushi ignores, and the sheet stays up. Where the links do work — Zotero's own window, or a browser — they work as before.
- **The plugin can be built there.** `build.sh` began with `swiftc` under `set -e`, so on Linux it stopped before packaging anything. It now builds the macOS helper only where there is something to build it with.

### Also

The README no longer describes the plugin as though macOS were the only platform it runs on.

## 1.1.0 — 2026-08-20

First release of this fork, and a large one. Compatible with Zotero 7 and Zotero 10.

### Annotations

Zotero keeps PDF annotations in its database rather than in the file, so previewing a stored PDF showed an unmarked document. Highlights, underlines, notes, areas and ink now appear in previews **and** on contact sheets. Attachments without annotations are recognised before any work starts, and an export is reused until an annotation is added or edited, so the common case costs nothing. The behaviour can be switched off under **Settings → zotLook**.

### The contact sheet works everywhere

It used to need a macOS-only binary. Pages are now rendered with the pdf.js build Zotero already ships, in several workers at once, so Linux and Windows get it too. On Windows there is no system preview, so the sheet opens in a Zotero window — the first zotLook feature to work there at all.

The sheet also has a window of its own on every platform (**Shift+Option+Space**), where the page links are live: click a thumbnail to open that page in Zotero's reader.

### Settings

A preference pane under **Settings → zotLook**:

- Every shortcut is configurable, and checked against Zotero's own so a clash is caught before it is saved
- Column count for the contact sheet, and an optional page limit (no limit by default)
- Which attachment gets previewed when an item has several, as a ranking you arrange yourself
- Whether annotations are drawn in
- Whether zotLook renders EPUBs itself, for people who have a Quick Look extension that does it better

### Also

- **Video previews** no longer crash. `qlmanage` cannot drive Apple's movie generator; a small helper drives `QLPreviewPanel` the way Finder does.
- **Preview on Linux** through GNOME Sushi.
- **German translation.**
- Only one attachment is ever resolved — previously every synced attachment of every selected item was downloaded and all but one discarded.
- Automatic updates, lint, tests and a release build in CI.

### Credit

The original Quick Look plugin is Mikko Rönkkö's idea; this line of the code comes from Guillaume Chapron's [Zotero7QuickLook](https://github.com/gchapron/Zotero7QuickLook), about half of which is still in place.
