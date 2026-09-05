#!/usr/bin/env python3
"""The screencast of the contact sheet, Linux take.

The Linux counterpart of script/screencast-macos.applescript and
script/screencast-windows.ps1: it drives Zotero through the sequence the
screenplay lays down — the same on every platform — and records it in two
takes, one for the mouse and one for the keyboard, each as the whole Zotero
window. The cut, the title cards and the key chips are made afterwards by
script/screencast-post.py from the timeline this script writes beside each
take.

The session has to be X11, and that is a choice, not a limitation: the
keyboard and the mouse go in through xdotool, which is XTEST — synthetic
events at the X protocol level that a GTK application takes for real. Under
Wayland there is no such door. Windows are found and placed the EWMH way
through python3-xlib, because the xdotool Debian ships cannot take a window
out of its maximized state. Recording is ffmpeg's x11grab on the main
window's visible rectangle, with the pointer drawn in; it is stopped with a
"q" on its stdin, which closes the file properly.

The keys are not shown on screen while recording. A key-display tool such
as showmethekey reads evdev, the raw input devices, and XTEST events never
pass through there — the same wall the macOS take hit with its tools. So the
keys are put in afterwards, from the record of what was sent and when,
which is what the cut does by default. Clicks are drawn the same way, from
the timeline's fourth column.

    script/screencast-linux.py [--out build/screencast] [--lang de|en]
                               [--stage all|prepare|probe|mouse|keyboard]

--stage probe runs the warm-up only and leaves screenshots of the main
window, the sheet window and each of its menus in --out, with their
rectangles, for measuring the offsets below on a new machine.

Wants: Zotero running under X11 in the language of the take, with zotLook
1.6 or later, the sheet window shortcut at Ctrl+Alt+Space, four columns
and the window size kept at 1400 × 860; the collection "zotLook" holding
"zotLook Dokumentation" with the German documentation PDF and its three
annotations; xdotool, ffmpeg with x11grab and libx264, python3-xlib,
Pillow. During the roughly four minutes the mouse and the keyboard are not
yours.
"""

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

from PIL import ImageGrab
from Xlib import X, display
from Xlib.protocol import event as xevent

# ── the plan, in numbers ─────────────────────────────────────────────────
#
# Every offset is from the top left of a window as it is seen: the main
# window's without the shadow GTK draws around it, the sheet window's with
# the title bar the window manager puts over it. That is what the macOS and
# Windows takes measure too, so the numbers can be compared.

COLLECTION_KEY = "QLDZQ9F5"
# The rows of the two documentation items in the main window. Measured with
# --stage probe on the placed window
DOCS_ROW = {"de": (600, 190), "en": (600, 162)}
SEARCH_WORD = {"de": "Tasten", "en": "keys"}
READER_CLOSE = (399, 54)            # the reader tab's close button
READER_SIDEBAR_TOGGLE = (22, 92)    # the reader toolbar's sidebar button

# The main window is 1512 × 949 like the other takes'. Where it stands is
# dictated by the sheet window: GNOME centres every new window on the
# screen (Mutter's center-new-windows), whatever place the viewer asks for.
# The sheet window opens at its minimum of 1000 × 700 and is then sized by
# zotLook, the first time as content, which makes it taller than the screen
# has room for below the centre, so GNOME pushes it up against the bottom;
# the second sizing, to the outer measure, leaves it there. On a
# 1920 × 1080 screen with the top bar its frame ends up at (460, 183),
# every time. The main window is put so that this is (56, 78) inside it,
# the other takes' place; on another screen, measure and move it
MAIN_ORIGIN = (404, 105)
MAIN_SIZE = (1512, 949)
# The sheet window: the place is GNOME's, the size zotLook's (its
# windowWidth and windowHeight preferences); both are checked in the
# warm-up and put right if they are off
SHEET_ORIGIN = (MAIN_ORIGIN[0] + 56, MAIN_ORIGIN[1] + 78)
SHEET_SIZE = (1400, 860)

# Positions inside the sheet window, measured on that window with four
# columns. Filled in from --stage probe
BTN_CONTENTS = (1339, 817)
BTN_ANNOTATIONS = (96, 817)
SEARCH_FIELD = (1264, 110)
ENTRY_WAS_ES_KANN = {"de": (1150, 563), "en": (1150, 543)}   # "2. Was es kann" / "2. What it does": entry 1.4 is one line in English
ENTRY_BLUE_ANNOTATION = {"de": (219, 707), "en": (219, 707)}
LINK_SEITE_6 = {"de": (78, 718), "en": (78, 718)}
TILE_AFTER_CONTENTS = (873, 468)    # page 11, framed in the middle after the jump
TILE_AFTER_ANNOTATION = (526, 468)  # page 6, likewise
TILE_AFTER_SEARCH = (526, 490)      # page 14 after the scroll, with its twelve hits
SCROLL_TO_14 = 10                   # wheel notches down, 138 px each
SHEET_TITLES = ("Kontaktbogen", "Contact Sheet", "Sammlungsbogen", "Collection Sheet")

# x11grab has its first frame a moment after the launch; the timeline
# counts from then
CAPTURE_LATENCY = 0.3

# ── X11 ──────────────────────────────────────────────────────────────────

D = display.Display()
ROOT = D.screen().root


def atom(name):
    return D.intern_atom(name)


def window(wid):
    return D.create_resource_object("window", wid)


def title_of(wid):
    try:
        prop = window(wid).get_full_property(atom("_NET_WM_NAME"), 0)
        if prop and prop.value:
            v = prop.value
            return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)
        return window(wid).get_wm_name() or ""
    except Exception:
        return ""


def windows(pattern):
    """(id, title) of every visible window whose title matches."""
    rx = re.compile(pattern)
    out = []
    prop = ROOT.get_full_property(atom("_NET_CLIENT_LIST"), X.AnyPropertyType)
    for wid in (prop.value if prop else []):
        try:
            if window(wid).get_attributes().map_state != X.IsViewable:
                continue
        except Exception:
            continue
        t = title_of(wid)
        if rx.search(t):
            out.append((wid, t))
    return out


def geom(wid):
    """x y w h of the client window, in root coordinates."""
    w = window(wid)
    g = w.get_geometry()
    t = w.translate_coords(ROOT, 0, 0)
    return -t.x, -t.y, g.width, g.height


def extents(wid, name):
    """left, right, top, bottom of a frame property, or None."""
    try:
        prop = window(wid).get_full_property(atom(name), X.AnyPropertyType)
    except Exception:
        return None
    if prop and len(prop.value) >= 4:
        return tuple(int(v) for v in prop.value[:4])
    return None


def seen(wid):
    """The window as it is seen. A GTK window that draws its own frame
    claims a margin around it for the shadow (_GTK_FRAME_EXTENTS), which
    the client rectangle includes and the eye does not; a window the
    manager frames has its title bar outside the client rectangle
    (_NET_FRAME_EXTENTS), and the eye counts it."""
    x, y, w, h = geom(wid)
    gtk = extents(wid, "_GTK_FRAME_EXTENTS")
    if gtk:
        l, r, t, b = gtk
        return x + l, y + t, w - l - r, h - t - b
    wm = extents(wid, "_NET_FRAME_EXTENTS")
    if wm:
        l, r, t, b = wm
        return x - l, y - t, w + l + r, h + t + b
    return x, y, w, h


def client_message(wid, name, data):
    ev = xevent.ClientMessage(window=window(wid), client_type=atom(name),
                              data=(32, (list(data) + [0] * 5)[:5]))
    ROOT.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
    D.flush()


def place(wid, origin, size):
    """Put the window, as seen, at origin with size — through the window
    manager, the only party allowed to move or size a maximized window,
    which is taken out of that state first."""
    client_message(wid, "_NET_WM_STATE", [0, atom("_NET_WM_STATE_MAXIMIZED_VERT"),
                                          atom("_NET_WM_STATE_MAXIMIZED_HORZ"), 1])
    D.sync(); time.sleep(0.4)
    x, y = origin
    w, h = size
    gtk = extents(wid, "_GTK_FRAME_EXTENTS")
    wm = extents(wid, "_NET_FRAME_EXTENTS")
    if gtk:
        l, r, t, b = gtk
        x -= l; y -= t; w += l + r; h += t + b
    elif wm:
        # The manager places its frame at x, y and sizes the client to w, h
        l, r, t, b = wm
        w -= l + r; h -= t + b
    flags = 1 | (0xF << 8) | (2 << 12)   # NorthWest gravity, x y w h given, from a pager
    client_message(wid, "_NET_MOVERESIZE_WINDOW", [flags, x, y, w, h])
    D.sync(); time.sleep(0.5)
    window(wid).configure(x=x, y=y, width=w, height=h)   # and the plain way, for a manager that ignores the message
    D.sync(); time.sleep(0.4)


def activate(wid):
    client_message(wid, "_NET_ACTIVE_WINDOW", [2, X.CurrentTime, 0])
    D.sync(); time.sleep(0.4)


def main_window():
    for _ in range(6):
        found = windows(r" - Zotero$")
        if found:
            return found[0][0]
        time.sleep(0.25)
    return None


def main_title():
    m = main_window()
    return title_of(m) if m else ""


def sheet_window():
    for wid, _t in windows(r"^(" + "|".join(SHEET_TITLES) + r")$"):
        return wid
    return None


def need_sheet_id():
    for _ in range(8):
        wid = sheet_window()
        if wid:
            return wid
        time.sleep(0.25)
    raise RuntimeError("the contact sheet window is gone")


def wait_sheet(half_seconds):
    for _ in range(half_seconds):
        if sheet_window():
            return True
        time.sleep(0.5)
    return False


def need_sheet():
    if not wait_sheet(60):
        raise RuntimeError("the contact sheet did not open")


def wait_no_sheet():
    for _ in range(40):
        if not sheet_window():
            return
        time.sleep(0.5)
    raise RuntimeError("the contact sheet did not close")


# ── recording and the timeline ───────────────────────────────────────────

REC = None
T0 = None
TIMELINE = None
OUT = Path("build/screencast")


def start_recording(file, tsv):
    global REC, T0, TIMELINE
    for p in (file, tsv):
        Path(p).unlink(missing_ok=True)
    x, y, w, h = seen(main_window())
    w -= w % 2; h -= h % 2                       # yuv420p wants even sizes
    REC = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "x11grab", "-framerate", "30", "-draw_mouse", "1",
        "-video_size", f"{w}x{h}", "-i", f":0.0+{x},{y}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-f", "mov", str(file)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    T0 = time.time() + CAPTURE_LATENCY
    TIMELINE = Path(tsv)
    time.sleep(2.5)


def stop_recording():
    global REC, T0
    time.sleep(1)
    if REC:
        try:
            REC.stdin.write(b"q"); REC.stdin.flush()
            REC.wait(timeout=20)
        except Exception:
            REC.kill()
        REC = None
    T0 = None


def mark(kind, label, at=None):
    """One line of the timeline: seconds since the capture began, the kind,
    the label — and for a click, where it was, relative to the frame."""
    if T0 is None:
        return
    t = time.time() - T0
    line = f"{t:.3f}\t{kind}\t{label}"
    if at is not None:
        x, y, _, _ = seen(main_window())
        line += f"\t{at[0] - x},{at[1] - y}"
    with open(TIMELINE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ── keys, with their record ──────────────────────────────────────────────

def xdo(*args):
    subprocess.run(["xdotool", *args], check=False)


def press(label, keysym):
    """A key, with its modifiers held around it explicitly: xdotool's own
    chord with --clearmodifiers was seen to drop Ctrl+Alt+Space after a
    restart of Zotero, the explicit sequence never."""
    mark("key", label)
    parts = keysym.split("+")
    mods, key = parts[:-1], parts[-1]
    args = []
    for m in mods:
        args += ["keydown", m]
    args += ["key", key]
    for m in reversed(mods):
        args += ["keyup", m]
    xdo(*args)


def chord():
    press("Ctrl+Alt+Space", "ctrl+alt+space")


def letter(ch):
    mark("key", ch)
    xdo("key", ch)


ARROWS = {"Down": ("↓", "Down"), "Up": ("↑", "Up"), "Left": ("←", "Left"), "Right": ("→", "Right")}


def arrow(direction):
    glyph, keysym = ARROWS[direction]
    press(glyph, keysym)


def type_text(text):
    mark("type", text)
    xdo("type", "--delay", "70", text)


# ── the mouse ────────────────────────────────────────────────────────────

def pointer():
    p = ROOT.query_pointer()
    return p.root_x, p.root_y


def glide(x, y, ms):
    """An eased glide of small steps, the way a hand moves; then a rest,
    long enough for the eye to arrive too."""
    sx, sy = pointer()
    steps = max(8, ms // 16)
    for i in range(1, steps + 1):
        t = i / steps
        s = t * t * (3 - 2 * t)
        xdo("mousemove", str(int(sx + (x - sx) * s)), str(int(sy + (y - sy) * s)))
        time.sleep(ms / steps / 1000)
    xdo("mousemove", str(x), str(y))


def click_at(x, y, ms):
    glide(x, y, ms); time.sleep(0.6)
    mark("click", "", at=(x, y))
    xdo("click", "1")


def click_main(pt, ms):
    x, y, _, _ = seen(main_window())
    click_at(x + pt[0], y + pt[1], ms)


def click_sheet(pt, ms):
    x, y, _, _ = seen(need_sheet_id())
    click_at(x + pt[0], y + pt[1], ms)


def scroll_sheet(notches):
    x, y, w, h = seen(need_sheet_id())
    glide(x + w // 2, y + h // 2, 400)
    mark("scroll", str(notches))
    button = "5" if notches > 0 else "4"
    for _ in range(abs(notches)):
        xdo("click", button); time.sleep(0.09)


# ── looking at the screen ────────────────────────────────────────────────

def grab(rect):
    x, y, w, h = rect
    return ImageGrab.grab(bbox=(x, y, x + w, y + h))


def shot(wid, name):
    r = seen(wid)
    grab(r).save(OUT / name)
    line = f"{name}  rect={','.join(str(v) for v in r)}"
    print(line)
    with open(OUT / "probe.txt", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def dark_count(img, step, limit=300):
    """How many of the pixels sampled are darker than the limit (the sum
    of the three channels), and the sum over all of them."""
    px = img.load()
    w, h = img.size
    dark = 0; total = 0
    for yy in range(0, h, step):
        for xx in range(0, w, step):
            r, g, b = px[xx, yy][:3]
            v = r + g + b
            total += v
            if v < limit:
                dark += 1
    return dark, total


def wait_reader_page():
    """The reader draws its page some seconds after the tab is there, and
    not the same twice; a fixed wait cut the page off on Windows. The page
    area is watched: text is dark, a blank page and the spinner are not,
    and the picture has to hold still for a moment besides."""
    m = main_window()
    if not m:
        return
    x, y, _, _ = seen(m)
    last = None; still = 0
    for _ in range(60):
        dark, total = dark_count(grab((x + 380, y + 120, 990, 780)), 6)
        sig = (dark, total)
        still = still + 1 if sig == last else 0
        last = sig
        if dark > 60 and still >= 2:
            break
        time.sleep(0.4)


def wait_items():
    """Right after a start Zotero shows "Loading items…" for a while, and a
    click on the row then hits nothing. The band where the rows will be is
    watched for text first."""
    m = main_window()
    if not m:
        return
    x, y, _, _ = seen(m)
    for _ in range(120):
        dark, _ = dark_count(grab((x + 340, y + 150, 800, 90)), 3)
        if dark > 40:
            return
        time.sleep(1)


def hide_reader_sidebar():
    """The reader opens with its sidebar as it was last left; the takes
    want the page alone. The sidebar's own toolbar, three icons under the
    reader's, is looked for where it would be, and the toggle clicked if
    it is there. Zotero keeps the state, so this is once per session."""
    m = main_window()
    if not m:
        return
    x, y, _, _ = seen(m)
    # The icons are grey, not black: anything well off the background counts
    ink, _ = dark_count(grab((x + 10, y + 120, 90, 30)), 2, limit=600)
    if ink > 12:
        click_main(READER_SIDEBAR_TOGGLE, 400); time.sleep(1.2)


def close_reader_tabs():
    """Tabs left over move the item list down by the tab bar's height, so
    the row click would miss; whatever is open is closed first."""
    for _ in range(12):
        t = main_title()
        if not t:
            return
        if re.match(r"^zotLook - Zotero$", t):
            press("Ctrl+Tab", "ctrl+Tab"); time.sleep(0.7)
            if main_title() == t:
                return
        press("Ctrl+W", "ctrl+w"); time.sleep(0.9)


# ── before the takes ─────────────────────────────────────────────────────

def prepare(lang, stage):
    subprocess.run(["xdg-open", f"zotero://select/library/collections/{COLLECTION_KEY}"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    m = main_window()
    if not m:
        raise RuntimeError("no Zotero main window")
    activate(m)
    place(m, MAIN_ORIGIN, MAIN_SIZE)
    time.sleep(1)
    close_reader_tabs()
    wait_items()
    time.sleep(1)
    if stage == "probe":
        shot(m, f"probe-main-{lang}.png")
    # The first shortcut after a zotero://select has been seen to do
    # nothing; the row is clicked and the shortcut sent until the sheet is there
    for _ in range(4):
        click_main(DOCS_ROW[lang], 300)
        time.sleep(0.8)
        chord()
        if wait_sheet(20):
            break
    if not sheet_window():
        raise RuntimeError("the contact sheet did not open")
    time.sleep(2)
    if seen(need_sheet_id()) != (*SHEET_ORIGIN, *SHEET_SIZE):
        print("the sheet window stands at", seen(need_sheet_id()), "and is moved to", (*SHEET_ORIGIN, *SHEET_SIZE))
        place(need_sheet_id(), SHEET_ORIGIN, SHEET_SIZE)
        time.sleep(1)
    if stage == "probe":
        shot(need_sheet_id(), f"probe-sheet-{lang}.png")
        # the menus open, for measuring their entries; and, once those are
        # known, the sheet after the jump each entry makes, for the tile
        click_sheet(BTN_CONTENTS, 400); time.sleep(1.2); shot(need_sheet_id(), f"probe-sheet-contents-{lang}.png")
        if ENTRY_WAS_ES_KANN[lang] != (0, 0):
            click_sheet(ENTRY_WAS_ES_KANN[lang], 400); time.sleep(2)
        click_sheet(BTN_CONTENTS, 300); time.sleep(1)
        if ENTRY_WAS_ES_KANN[lang] != (0, 0):
            shot(need_sheet_id(), f"probe-sheet-after-contents-{lang}.png")
        click_sheet(BTN_ANNOTATIONS, 400); time.sleep(1.2); shot(need_sheet_id(), f"probe-sheet-annotations-{lang}.png")
        if ENTRY_BLUE_ANNOTATION[lang] != (0, 0):
            click_sheet(ENTRY_BLUE_ANNOTATION[lang], 400); time.sleep(1); shot(need_sheet_id(), f"probe-sheet-annotation-open-{lang}.png")
            if LINK_SEITE_6[lang] != (0, 0):
                click_sheet(LINK_SEITE_6[lang], 400); time.sleep(2)
        click_sheet(BTN_ANNOTATIONS, 300); time.sleep(1)
        if LINK_SEITE_6[lang] != (0, 0):
            shot(need_sheet_id(), f"probe-sheet-after-annotation-{lang}.png")
        # the search and the scroll to the page with the most hits
        click_sheet(SEARCH_FIELD, 400); type_text(SEARCH_WORD[lang]); time.sleep(1.5)
        shot(need_sheet_id(), f"probe-sheet-search-{lang}.png")
        scroll_sheet(SCROLL_TO_14); time.sleep(1)
        shot(need_sheet_id(), f"probe-sheet-scrolled-{lang}.png")
    # The warm-up ends the way the takes do: a page into the reader, whose
    # tab is then closed
    press("Enter", "Return"); time.sleep(0.8)
    letter("o"); wait_no_sheet(); wait_reader_page(); time.sleep(1)
    hide_reader_sidebar()
    if stage == "probe":
        shot(main_window(), f"probe-reader-{lang}.png")
    press("Ctrl+W", "ctrl+w"); time.sleep(1)
    activate(main_window())
    # Closing the tab leaves the keyboard nowhere in particular; the take
    # that begins with the shortcut needs it in the item list, so the row is
    # clicked once more, before the recording
    click_main(DOCS_ROW[lang], 300); time.sleep(0.8)


# ── the two takes ────────────────────────────────────────────────────────

def mouse_part(lang):
    click_main(DOCS_ROW[lang], 500); time.sleep(1)
    chord(); need_sheet(); time.sleep(1.5)

    click_sheet(BTN_CONTENTS, 700); time.sleep(1.4)
    click_sheet(ENTRY_WAS_ES_KANN[lang], 700); time.sleep(2.4)
    click_sheet(BTN_CONTENTS, 600); time.sleep(1.2)
    click_sheet(TILE_AFTER_CONTENTS, 800); wait_no_sheet(); wait_reader_page(); time.sleep(2.5)
    click_main(READER_CLOSE, 800); time.sleep(1.5)

    chord(); need_sheet(); time.sleep(1.5)
    click_sheet(BTN_ANNOTATIONS, 700); time.sleep(1.4)
    click_sheet(ENTRY_BLUE_ANNOTATION[lang], 700); time.sleep(1.2)
    click_sheet(LINK_SEITE_6[lang], 500); time.sleep(2.4)
    click_sheet(BTN_ANNOTATIONS, 600); time.sleep(1.2)
    click_sheet(TILE_AFTER_ANNOTATION, 800); wait_no_sheet(); wait_reader_page(); time.sleep(2.5)
    click_main(READER_CLOSE, 800); time.sleep(1.5)

    chord(); need_sheet(); time.sleep(1.5)
    click_sheet(SEARCH_FIELD, 700); time.sleep(0.6)
    type_text(SEARCH_WORD[lang]); time.sleep(2)
    scroll_sheet(SCROLL_TO_14); time.sleep(2.2)
    click_sheet(TILE_AFTER_SEARCH, 800); wait_no_sheet(); wait_reader_page(); time.sleep(2.5)
    click_main(READER_CLOSE, 800); time.sleep(1.5)


def keyboard_part(lang):
    chord(); need_sheet(); time.sleep(2)
    letter("c"); time.sleep(1)
    for _ in range(8):
        arrow("Down"); time.sleep(0.35)
    time.sleep(0.6)
    press("Enter", "Return"); time.sleep(2.2)
    letter("o"); wait_no_sheet(); wait_reader_page(); time.sleep(2.5)
    press("Ctrl+W", "ctrl+w"); time.sleep(1.5)

    chord(); need_sheet(); time.sleep(1.5)
    letter("a"); time.sleep(1)
    arrow("Down"); time.sleep(0.8)
    press("Enter", "Return"); time.sleep(2.2)
    letter("o"); wait_no_sheet(); wait_reader_page(); time.sleep(2.5)
    press("Ctrl+W", "ctrl+w"); time.sleep(1.5)

    chord(); need_sheet(); time.sleep(1.5)
    press("Ctrl+F", "ctrl+f"); time.sleep(0.6)
    type_text(SEARCH_WORD[lang]); time.sleep(1.4)
    for _ in range(3):
        press("Enter", "Return"); time.sleep(1)
    time.sleep(0.6)
    arrow("Down"); time.sleep(1)
    arrow("Up"); time.sleep(1)
    arrow("Right"); time.sleep(1)
    arrow("Left"); time.sleep(1)
    press("Page Down", "Next"); time.sleep(2.2)
    press("Page Up", "Prior"); time.sleep(2)
    letter("o"); wait_no_sheet(); wait_reader_page(); time.sleep(2.5)
    press("Ctrl+W", "ctrl+w"); time.sleep(1.5)


# ── run ──────────────────────────────────────────────────────────────────

def main():
    global OUT
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "build" / "screencast")
    ap.add_argument("--lang", default="de", choices=["de", "en"])
    ap.add_argument("--stage", default="all", choices=["all", "prepare", "probe", "mouse", "keyboard"])
    args = ap.parse_args()
    OUT = args.out
    OUT.mkdir(parents=True, exist_ok=True)

    prepare(args.lang, args.stage)
    if args.stage in ("prepare", "probe"):
        print(f"prepared; probes in {OUT}")
        return
    if args.stage in ("all", "mouse"):
        start_recording(OUT / f"linux-{args.lang}-mouse.mov", OUT / f"linux-{args.lang}-mouse.tsv")
        try:
            mouse_part(args.lang)
        finally:
            stop_recording()
    if args.stage in ("all", "keyboard"):
        start_recording(OUT / f"linux-{args.lang}-keyboard.mov", OUT / f"linux-{args.lang}-keyboard.tsv")
        try:
            keyboard_part(args.lang)
        finally:
            stop_recording()
    print(f"recorded into {OUT}")


if __name__ == "__main__":
    main()
