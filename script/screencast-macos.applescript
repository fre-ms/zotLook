-- The screencast of the contact sheet, macOS take.
--
-- Drives Zotero through the sequence the screenplay lays down — the same on
-- every platform — and records it in two takes, one for the mouse and one
-- for the keyboard. What is recorded is the whole Zotero window; the cut
-- and the two title cards are made afterwards by script/screencast-post.py,
-- which also draws the keys pressed, from the timeline this script writes
-- beside each take: no key-display tool sees a scripted keystroke, so the
-- keys are put in from the record of what was sent, and when.
--
-- The pointer is Cursor Pro's business, if it is running: it draws the ring
-- around the pointer and the clicks, and it does see the scripted mouse,
-- since that goes in at the HID level through script/screencast-mouse.swift,
-- which this script compiles on first use.
--
--   osascript script/screencast-macos.applescript [output directory]
--
-- Wants: Zotero running with zotLook from the tree (tool/dev.mjs) and the
-- window shortcut at Ctrl+Alt+Space; the collection "zotLook" holding the
-- item "zotLook Dokumentation" with the German documentation PDF as its
-- attachment; the terminal allowed to record the screen and to control the
-- computer (Accessibility); swiftc. Takes about four minutes, during which
-- the mouse and keyboard are not yours.

property collectionKey : "QLDZQ9F5"
property docsRow : {480, 164} -- the item's row, relative to the main window
property readerClose : {481, 18} -- the reader tab's close button, likewise

-- The sheet window is put at a fixed place and size before the takes: the
-- viewer remembers the place, and zotLook (from 1.5.1) the size, so every
-- opening lands there. Larger than the default, so that the tiles can be
-- read in the cut
property sheetOrigin : {56, 78}
property sheetSize : {1400, 860}

-- Positions inside the contact sheet window, measured on that window with
-- four columns, relative to its top left
property btnContents : {1340, 819}
property btnAnnotations : {96, 819}
property searchField : {1264, 59}
property entryWasEsKann : {1194, 515} -- "2. Was es kann" in the contents menu
property entryBlueAnnotation : {219, 718} -- the middle, blue annotation
property linkSeite6 : {79, 718} -- its "Seite 6" link, once the fold is open
property tileAfterContents : {873, 442} -- page 11, framed after the jump
property tileAfterAnnotation : {526, 442} -- page 6, likewise
property tileAfterSearch : {526, 297} -- page 14, after the scroll
property scrollTo14 : 1515 -- three rows of tiles

global helper, timeline, t0, outDir, mainPos

on run argv
	set repoDir to do shell script "cd " & quoted form of (POSIX path of ((path to me as text) & "::")) & "/.. && pwd"
	if (count of argv) > 0 then
		set outDir to item 1 of argv
	else
		set outDir to repoDir & "/build/screencast"
	end if
	do shell script "mkdir -p " & quoted form of outDir
	set helper to buildHelper(repoDir)
	set t0 to ""
	set timeline to ""

	prepare()

	set outFile to outDir & "/macos-mouse.mov"
	set timeline to outDir & "/macos-mouse.tsv"
	startRecording(outFile)
	mousePart()
	stopRecording()

	set outFile to outDir & "/macos-keyboard.mov"
	set timeline to outDir & "/macos-keyboard.tsv"
	startRecording(outFile)
	keyboardPart()
	stopRecording()

	return "recorded into " & outDir
end run

-- ── the two takes ────────────────────────────────────────────────────────

on mousePart()
	-- the item, then the sheet
	clickMain(docsRow, 500)
	delay 1
	chord("Ctrl+Alt+Space")
	needSheet()
	delay 1.5

	-- contents: "Was es kann", the menu away, the framed page into the reader
	clickSheet(btnContents, 700)
	delay 1.4
	clickSheet(entryWasEsKann, 700)
	delay 2.4
	clickSheet(btnContents, 600)
	delay 1.2
	clickSheet(tileAfterContents, 800)
	waitForNoSheet()
	delay 3.5
	clickMain(readerClose, 800)
	delay 1.5

	-- annotations: the blue one, its page link, the menu away, the page
	chord("Ctrl+Alt+Space")
	needSheet()
	delay 1.5
	clickSheet(btnAnnotations, 700)
	delay 1.4
	clickSheet(entryBlueAnnotation, 700)
	delay 1.2
	clickSheet(linkSeite6, 500)
	delay 2.4
	clickSheet(btnAnnotations, 600)
	delay 1.2
	clickSheet(tileAfterAnnotation, 800)
	waitForNoSheet()
	delay 3.5
	clickMain(readerClose, 800)
	delay 1.5

	-- search: "Tasten", scroll to page 14 and its twelve hits, open it
	chord("Ctrl+Alt+Space")
	needSheet()
	delay 1.5
	clickSheet(searchField, 700)
	delay 0.6
	typeText("Tasten")
	delay 2
	scrollSheet(scrollTo14)
	delay 2.2
	clickSheet(tileAfterSearch, 800)
	waitForNoSheet()
	delay 3.5
	clickMain(readerClose, 800)
	delay 1.5
end mousePart

on keyboardPart()
	-- the sheet; the contents menu, down to "2. Was es kann", Enter follows
	chord("Ctrl+Alt+Space")
	needSheet()
	delay 2
	letter("c")
	delay 1
	repeat 8 times
		arrow("Down")
		delay 0.35
	end repeat
	delay 0.6
	press("Enter", 36, {})
	delay 2.2
	letter("o")
	waitForNoSheet()
	delay 3.5
	chordKey("Cmd+W", 13, {command down})
	delay 1.5

	-- the annotations menu, down to the blue one, Enter, the page
	chord("Ctrl+Alt+Space")
	needSheet()
	delay 1.5
	letter("a")
	delay 1
	arrow("Down")
	delay 0.8
	press("Enter", 36, {})
	delay 2.2
	letter("o")
	waitForNoSheet()
	delay 3.5
	chordKey("Cmd+W", 13, {command down})
	delay 1.5

	-- the search: into the field, "Tasten", Enter walks the hits to page 14;
	-- then the arrows between hits, then the page keys scroll, then open
	chord("Ctrl+Alt+Space")
	needSheet()
	delay 1.5
	chordKey("Ctrl+F", 3, {control down})
	delay 0.6
	typeText("Tasten")
	delay 1.4
	repeat 3 times
		press("Enter", 36, {})
		delay 1
	end repeat
	delay 0.6
	arrow("Down")
	delay 1
	arrow("Up")
	delay 1
	arrow("Right")
	delay 1
	arrow("Left")
	delay 1
	press("Page Down", 121, {})
	delay 2.2
	press("Page Up", 116, {})
	delay 2
	letter("o")
	waitForNoSheet()
	delay 3.5
	chordKey("Cmd+W", 13, {command down})
	delay 1.5
end keyboardPart

-- ── before the takes ─────────────────────────────────────────────────────

-- The collection open, the item selected, the sheet rendered once so that
-- the takes show it appearing rather than being made
on prepare()
	do shell script "open 'zotero://select/library/collections/" & collectionKey & "'"
	delay 3
	tell application "Zotero" to activate
	delay 0.8
	set mainPos to mainWindowPosition()
	-- The first shortcut after a zotero://select has been seen to do
	-- nothing; the row is clicked and the shortcut sent until the sheet is
	-- there
	repeat 4 times
		clickMain(docsRow, 300)
		delay 0.8
		tell application "System Events" to key code 49 using {control down, option down}
		if waitForSheet(20) then exit repeat
	end repeat
	if not sheetOpen() then error "the contact sheet did not open"
	delay 2
	placeSheet()
	delay 1
	-- Up to 1.5.0, a sheet closed with Cmd+W left the next shortcut doing
	-- nothing (fixed since), so the warm-up ends the way the takes do: a
	-- page into the reader, whose tab is then closed
	tell application "System Events" to key code 36
	delay 0.8
	tell application "System Events" to keystroke "o"
	waitForNoSheet()
	delay 2
	tell application "System Events" to keystroke "w" using {command down}
	delay 1
	tell application "Zotero" to activate
	delay 0.5
end prepare

on buildHelper(repoDir)
	set src to repoDir & "/script/screencast-mouse.swift"
	set bin to outDir & "/screencast-mouse"
	do shell script "[ " & quoted form of bin & " -nt " & quoted form of src & " ] || swiftc -O " & quoted form of src & " -o " & quoted form of bin & " 2>&1 | grep -v warning || true"
	return bin
end buildHelper

-- ── recording and the timeline ───────────────────────────────────────────

on startRecording(outFile)
	do shell script "rm -f " & quoted form of outFile & " " & quoted form of timeline
	set r to mainWindowRect()
	do shell script "screencapture -v -C -R " & r & " " & quoted form of outFile & " > /dev/null 2>&1 &"
	-- the capture is running a tenth of a second after the launch — measured
	-- with a cursor sent into the frame at a known moment, and the frame it
	-- first shows in. The moment is kept as the shell wrote it: a number
	-- passed through AppleScript would come back with the locale's decimal
	-- comma
	set t0 to do shell script "perl -MTime::HiRes=time -e 'printf \"%.3f\", time + 0.1'"
	delay 2.5
end startRecording

on stopRecording()
	delay 1
	do shell script "pkill -INT -x screencapture || true"
	repeat 40 times
		delay 0.5
		try
			do shell script "pgrep -x screencapture"
		on error
			exit repeat
		end try
	end repeat
end stopRecording

-- Nothing is written before a take runs
on mark(kind, label)
	if t0 is "" then return
	do shell script "perl -MTime::HiRes=time -e 'printf \"%.3f\\t%s\\t%s\\n\", time - " & t0 & ", @ARGV' " & kind & " " & quoted form of label & " >> " & quoted form of timeline
end mark

-- ── keys, with their record ──────────────────────────────────────────────

on press(label, code, mods)
	mark("key", label)
	if (count of mods) is 0 then
		tell application "System Events" to key code code
	else
		tell application "System Events" to key code code using mods
	end if
end press

on chord(label)
	press(label, 49, {control down, option down})
end chord

on chordKey(label, code, mods)
	press(label, code, mods)
end chordKey

on letter(ch)
	mark("key", ch)
	tell application "System Events" to keystroke ch
end letter

on arrow(direction)
	if direction is "Down" then
		press("↓", 125, {})
	else if direction is "Up" then
		press("↑", 126, {})
	else if direction is "Left" then
		press("←", 123, {})
	else
		press("→", 124, {})
	end if
end arrow

on typeText(txt)
	mark("type", txt)
	tell application "System Events" to keystroke txt
end typeText

-- ── the mouse ────────────────────────────────────────────────────────────

on clickMain(pt, ms)
	set {x, y} to pt
	do shell script quoted form of helper & " move " & ((item 1 of mainPos) + x) & " " & ((item 2 of mainPos) + y) & " " & ms
	delay 0.6
	mark("click", "")
	do shell script quoted form of helper & " click " & ((item 1 of mainPos) + x) & " " & ((item 2 of mainPos) + y) & " 0"
end clickMain

-- The pointer travels to the target, rests on it for a moment — long
-- enough for the eye to arrive too — and then clicks
on clickSheet(pt, ms)
	set {x, y} to pt
	set p to sheetPosition()
	do shell script quoted form of helper & " move " & ((item 1 of p) + x) & " " & ((item 2 of p) + y) & " " & ms
	delay 0.6
	mark("click", "")
	do shell script quoted form of helper & " click " & ((item 1 of p) + x) & " " & ((item 2 of p) + y) & " 0"
end clickSheet

on scrollSheet(points)
	set p to sheetPosition()
	mark("scroll", points as text)
	-- div, not /: a real would reach the shell with the locale's comma
	do shell script quoted form of helper & " scroll " & ((item 1 of p) + ((item 1 of sheetSize) div 2)) & " " & ((item 2 of p) + ((item 2 of sheetSize) div 2)) & " " & points
end scrollSheet

-- ── the windows ──────────────────────────────────────────────────────────

on mainWindowPosition()
	tell application "System Events" to tell process "Zotero"
		repeat with w in windows
			if name of w ends with "- Zotero" then return position of w
		end repeat
		return position of window 1
	end tell
end mainWindowPosition

on mainWindowRect()
	tell application "System Events" to tell process "Zotero"
		repeat with w in windows
			if name of w ends with "- Zotero" then
				set {x, y} to position of w
				set {wd, ht} to size of w
				return (x as text) & "," & y & "," & wd & "," & ht
			end if
		end repeat
	end tell
	error "no Zotero main window"
end mainWindowRect

-- The sheet window, by its title in either language
property sheetTitles : {"Kontaktbogen", "Contact Sheet"}

on sheetName()
	tell application "System Events" to tell process "Zotero"
		repeat with t in sheetTitles
			if exists window (t as text) then return t as text
		end repeat
	end tell
	return ""
end sheetName

on sheetOpen()
	return sheetName() is not ""
end sheetOpen

on placeSheet()
	set t to sheetName()
	tell application "System Events" to tell process "Zotero"
		set position of window t to sheetOrigin
		set size of window t to sheetSize
	end tell
end placeSheet

on sheetPosition()
	set t to sheetName()
	tell application "System Events" to tell process "Zotero"
		return position of window t
	end tell
end sheetPosition

on waitForSheet(halfSeconds)
	repeat halfSeconds times
		if sheetOpen() then return true
		delay 0.5
	end repeat
	return false
end waitForSheet

on needSheet()
	if not waitForSheet(60) then error "the contact sheet did not open"
end needSheet

on waitForNoSheet()
	repeat 40 times
		if not sheetOpen() then return
		delay 0.5
	end repeat
	error "the contact sheet did not close"
end waitForNoSheet
