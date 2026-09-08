#!/usr/bin/env python3
"""The cut of the screencast: two takes, two title cards, the keys drawn in.

The recording script of each platform leaves two takes — the mouse and the
keyboard — and beside each a timeline of what it sent, and when::

    12.345<TAB>key<TAB>Ctrl+Alt+Space
    15.010<TAB>type<TAB>Tasten
    17.400<TAB>click<TAB>
    19.250<TAB>click<TAB><TAB>1395,895

This puts the takes one after the other, each behind its title card, and
shows every key from the timeline as a chip at the bottom of the frame for
as long as it is pressed — until the next key, or a good two seconds. On
macOS no key-display tool sees a scripted keystroke, so this is where the
keys come from; on Windows Keyviz does, and --no-chips leaves the keys to
the take. A click that names its place — a fourth column, x,y in points
of the window — gets a ring there for a moment: on Linux no pointer tool
sees a scripted click either. Clicks without a place, and scrolls, are
left to the pointer tool of the platform.

    script/screencast-post.py build/screencast --prefix macos --out asset/screenshot

writes <prefix>-screencast.mp4, .webm and .gif into --out. The GIF is the
mouse take alone, cut to the sheet and its surroundings at eight frames
a second, since it is for the README and has to stay small; the videos are
both takes, the whole window, halved from the Retina recording, for the
website's loop. The title card of each take is drawn over a darkened frame
of the take itself.

Wants ffmpeg with libx264 and libvpx, and Pillow for the chips.
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Arial rather than Helvetica: the chips show arrows, and Helvetica has
# none. Every candidate here has them
FONTS = [
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
]
CHIP_SECONDS = 2.2
RING_SECONDS = 0.6
RING_DIAMETER = 64      # points of the 1512-point window
TITLES = {
    "en": ("mouse navigation", "keyboard navigation"),
    "de": ("Navigation mit der Maus", "Navigation mit der Tastatur"),
}
TITLE_SECONDS = 2.5
FPS = 30

# The contact sheet window and a margin of its surroundings, in points of
# the 1512 × 949 Zotero window the takes show; the GIF is cut to this.
# --crop overrides it, as x,y,width,height
GIF_CROP = (30, 30, 1450, 890)  # x, y, width, height
GIF_WIDTH = 900
GIF_FPS = 8


# The modifier symbols — ⌘ ⌥ ⌃ ⇧ ⌫ ↩ — are not in Arial; these fonts have them
SYMBOL_FONTS = [
    "/System/Library/Fonts/Apple Symbols.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/seguisym.ttf",
]


def symbol_font(size):
    for path in SYMBOL_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return font(size)


def font(size, bold=False):
    for regular, heavy in FONTS:
        try:
            return ImageFont.truetype(heavy if bold else regular, size)
        except OSError:
            continue
    return ImageFont.load_default()


def read_timeline(path):
    """(seconds, kind, label, place) per line; the place is (x, y) when the
    line has a fourth column, else None."""
    events = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        place = None
        if len(parts) > 3 and "," in parts[3]:
            x, y = parts[3].split(",", 1)
            place = (float(x), float(y))
        events.append((float(parts[0]), parts[1], parts[2], place))
    return events


# ── the key caps ─────────────────────────────────────────────────────
# Drawn after Keystro's caps, so that the three platforms look alike: a
# dark frame with a lighter face, a plain key as one large letter, a
# modifier with its symbol top right and its name bottom left. Keystro
# itself cannot draw a scripted key on macOS (it shows only what comes from
# the keyboard device), and on Linux nothing draws keys at all — the cut
# draws them everywhere, and Keystro (Sushi's counterpart on Linux has
# none) is left to draw the clicks.
CAP_H = 46            # a cap's height, in points of the 1512-wide window
CAP_MIN_W = 46
CAP_GAP = 12
CAP_RIM = 4           # the dark frame around the lighter face
CAP_BOTTOM = 112      # the caps' lower edge above the window's bottom edge
CAP_FRAME = (33, 32, 32, 235)
CAP_FACE = (72, 72, 72, 235)

# A modifier or special key: (symbol, name); the symbol is macOS's, the
# other platforms show the name alone
MODIFIERS = {
    "ctrl": ("⌃", "ctrl"), "control": ("⌃", "ctrl"),
    "alt": ("⌥", "alt"), "option": ("⌥", "option"),
    "cmd": ("⌘", "command"), "command": ("⌘", "command"), "meta": ("⌘", "command"),
    "shift": ("⇧", "Shift"),
    "enter": ("↩", "enter"), "return": ("↩", "return"),
    "backspace": ("⌫", "delete"), "delete": ("⌦", "delete"),
    "space": ("", "Space"), "tab": ("⇥", "tab"), "escape": ("⎋", "esc"),
    "page down": ("⇟", "page down"), "page up": ("⇞", "page up"),
}
# The names the other platforms give the same keys
MODIFIER_NAMES = {
    "win": {"option": "Alt", "alt": "Alt", "command": "Win", "delete": "Backspace", "enter": "Enter"},
    "linux": {"option": "Alt", "alt": "Alt", "command": "Super", "delete": "Backspace", "enter": "Enter"},
}


def caps_of(kind, label, platform):
    """The caps one timeline entry stands for: a chord split at its plus
    signs, a typed word one cap per character. Each cap is (symbol, name,
    plain) — plain caps carry one large label, the others symbol and name."""
    out = []
    if kind == "type":
        for ch in label:
            out.append(("", ch.upper() if ch.isalpha() else ch, True))
        return out
    parts = [p for p in re.split(r"\+(?!$)", label) if p] if label != "+" else ["+"]
    for part in parts:
        key = part.strip().lower()
        if key in MODIFIERS:
            symbol, name = MODIFIERS[key]
            if platform != "mac":
                symbol = ""
                name = MODIFIER_NAMES.get(platform, {}).get(name, name)
            out.append((symbol, name, key == "space"))
        elif len(part) == 1:
            out.append(("", part.upper() if part.isalpha() else part, True))
        else:
            out.append(("", part, True))
    return out


def chips(events, platform="mac"):
    """(start, end, caps) for every key or typed text, each ending with the
    next chip or after CHIP_SECONDS, whichever is first."""
    shown = [(t, kind, label) for t, kind, label, _place in events if kind in ("key", "type")]
    out = []
    for i, (t, kind, label) in enumerate(shown):
        end = t + CHIP_SECONDS
        if i + 1 < len(shown):
            end = min(end, shown[i + 1][0])
        out.append((t, end, caps_of(kind, label, platform)))
    return out


def rings(events):
    """(start, end, x, y) for every click that names its place."""
    return [(t, t + RING_SECONDS, place[0], place[1])
            for t, kind, _label, place in events if kind == "click" and place]


def ring_image(scale):
    """The ring a click leaves: the sheet's yellow, with a dark rim so it
    stands on white and on the dark chips alike."""
    d = int(RING_DIAMETER * scale)
    stroke = max(2, int(4 * scale))
    img = Image.new("RGBA", (d + 4, d + 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((1, 1, d + 2, d + 2), outline=(20, 24, 30, 110), width=stroke + 2)
    draw.ellipse((2, 2, d + 1, d + 1), outline=(245, 184, 65, 235), width=stroke)
    return img


def cap_image(symbol, name, plain, scale):
    """One cap: the frame, the face, and the label — one large character
    for a plain key, symbol top right and name bottom left otherwise."""
    h = int(CAP_H * scale)
    rim = max(2, int(CAP_RIM * scale))
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    if plain:
        f = font(int(24 * scale))
        x0, y0, x1, y1 = probe.textbbox((0, 0), name, font=f)
        w = max(int(CAP_MIN_W * scale), x1 - x0 + int(30 * scale))
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=int(10 * scale), fill=CAP_FRAME)
        d.rounded_rectangle((rim, rim, w - 1 - rim, h - 1 - rim), radius=int(7 * scale), fill=CAP_FACE)
        d.text(((w - (x1 - x0)) / 2 - x0, (h - (y1 - y0)) / 2 - y0), name, font=f, fill=(255, 255, 255, 255))
        return img
    fn = font(int(13 * scale))
    fs = symbol_font(int(15 * scale))
    nx0, ny0, nx1, ny1 = probe.textbbox((0, 0), name, font=fn)
    sx0, sy0, sx1, sy1 = probe.textbbox((0, 0), symbol, font=fs) if symbol else (0, 0, 0, 0)
    w = max(int(CAP_MIN_W * scale), (nx1 - nx0) + int(26 * scale), (sx1 - sx0) + int(26 * scale))
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=int(10 * scale), fill=CAP_FRAME)
    d.rounded_rectangle((rim, rim, w - 1 - rim, h - 1 - rim), radius=int(7 * scale), fill=CAP_FACE)
    if symbol:
        d.text((w - (sx1 - sx0) - int(10 * scale) - sx0, int(6 * scale) - sy0), symbol, font=fs, fill=(255, 255, 255, 255))
        d.text((int(10 * scale) - nx0, h - (ny1 - ny0) - int(8 * scale) - ny0), name, font=fn, fill=(255, 255, 255, 255))
    else:
        d.text(((w - (nx1 - nx0)) / 2 - nx0, (h - (ny1 - ny0)) / 2 - ny0), name, font=fn, fill=(255, 255, 255, 255))
    return img


def chip_image(caps, scale):
    """The caps of one chip side by side, as Keystro lays them out."""
    images = [cap_image(sym, name, plain, scale) for sym, name, plain in caps]
    gap = int(CAP_GAP * scale)
    w = sum(i.width for i in images) + gap * (len(images) - 1)
    h = max(i.height for i in images)
    img = Image.new("RGBA", (max(w, 1), h), (0, 0, 0, 0))
    x = 0
    for i in images:
        img.paste(i, (x, 0), i)
        x += i.width + gap
    return img


def title_image(text, width, height, backdrop=None):
    """The title on a card, over a darkened frame of the take when one is
    given — the window the take is about, seen through the card."""
    if backdrop is not None:
        img = backdrop.convert("RGB").resize((width, height), Image.LANCZOS)
        shade = Image.new("RGBA", (width, height), (20, 28, 36, 150))
        img = Image.alpha_composite(img.convert("RGBA"), shade)
    else:
        img = Image.new("RGBA", (width, height), (31, 42, 51, 255))
    f = font(int(height * 0.07), bold=True)
    probe = ImageDraw.Draw(img)
    x0, y0, x1, y1 = probe.textbbox((0, 0), text, font=f)
    tw, th = x1 - x0, y1 - y0
    pad_x, pad_y = int(height * 0.06), int(height * 0.04)
    cw, ch = tw + 2 * pad_x, th + 2 * pad_y
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, cw - 1, ch - 1), radius=int(ch * 0.28),
                                           fill=(31, 42, 51, 225))
    ImageDraw.Draw(card).text((pad_x - x0, pad_y - y0), text, font=f, fill=(245, 184, 65))
    img.alpha_composite(card, ((width - cw) // 2, (height - ch) // 2))
    return img.convert("RGB")


def frame_of(take, at, work):
    """One frame of a take, `at` seconds in, as an image."""
    png = work / f"frame-{take.stem}.png"
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", str(at), "-i", str(take), "-frames:v", "1", str(png)])
    return Image.open(png)


def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "csv=p=0", str(path)]).decode().split()
    w, h = out[0].split(",")[:2]
    duration = float(out[-1].split(",")[-1])
    return int(w), int(h), duration


def take_with_chips(take, timeline, out, width, height, work, offset=0.0, with_chips=True, platform="mac"):
    """One take, halved to `width`, with its chips overlaid — or without
    them, for a take whose keys were drawn on screen as it was recorded."""
    scale = width / 1512
    timeline_events = read_timeline(timeline)
    events = []
    if with_chips:
        events = [(a + offset, b + offset, t) for a, b, t in chips(timeline_events, platform)]
    inputs = ["-i", str(take)]
    filters = [f"[0:v]scale={width}:{height}:flags=lanczos,fps={FPS},format=yuv420p[v0]"]
    last = "v0"
    for i, (start, end, caps) in enumerate(events):
        img = chip_image(caps, scale)
        png = work / f"chip-{take.stem}-{i}.png"
        img.save(png)
        inputs += ["-i", str(png)]
        x = f"(W-w)/2"
        y = f"H-h-{int(CAP_BOTTOM * scale)}"
        filters.append(
            f"[{last}][{i + 1}:v]overlay={x}:{y}:enable='between(t,{start:.3f},{end:.3f})'[v{i + 1}]")
        last = f"v{i + 1}"
    # The rings, one input for all of them, laid at each click's place
    clicks = [(a + offset, b + offset, x, y) for a, b, x, y in rings(timeline_events)]
    if clicks:
        png = work / f"ring-{take.stem}.png"
        ring_image(scale).save(png)
        n = len(inputs) // 2
        inputs += ["-i", str(png)]
        for j, (start, end, x, y) in enumerate(clicks):
            tag = f"r{j}"
            filters.append(
                f"[{last}][{n}:v]overlay={int(x * scale)}-w/2:{int(y * scale)}-h/2"
                f":enable='between(t,{start:.3f},{end:.3f})'[{tag}]")
            last = tag
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + inputs + [
        "-filter_complex", ";".join(filters), "-map", f"[{last}]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-an", str(out)]
    subprocess.check_call(cmd)


def title_clip(text, out, width, height, work, backdrop=None):
    png = work / f"title-{out.stem}.png"
    title_image(text, width, height, backdrop).save(png)
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-loop", "1", "-framerate", str(FPS), "-i", str(png),
        "-t", str(TITLE_SECONDS), "-vf", "format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-an", str(out)])


def concat(parts, out):
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(listing),
        "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-an",
        "-movflags", "+faststart", str(out)])
    listing.unlink()


def webm(src, out):
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
        "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-an", str(out)])


def gif(src, out, width, work, crop, seconds=None):
    # seconds ends the GIF early: the README's loop need not carry every
    # scene, and a take that grew a scene grows past what a README should
    # load
    scale = width / 1512
    x, y, w, h = (int(v * scale) for v in crop)
    vf = f"crop={w}:{h}:{x}:{y},fps={GIF_FPS},scale={GIF_WIDTH}:-1:flags=lanczos"
    until = ["-t", f"{seconds:.2f}"] if seconds else []
    palette = work / "palette.png"
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *until, "-i", str(src),
        "-vf", vf + ",palettegen=max_colors=128:stats_mode=diff", str(palette)])
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *until, "-i", str(src), "-i", str(palette),
        "-lavfi", vf + "[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop", "0", str(out)])


# ── the takes on their own, and the keys one by one ──────────────────
# For the documentation: each take as a file of its own, and short loops of
# the keyboard take, one per key or key group, cut where the timeline says
# the key fell. A scene runs from half a second before its first key to a
# moment after its last, cropped to the sheet and its surroundings.
SNIPPET_WIDTH = 720
SNIPPET_LEAD = 0.5


def _find(events, start, pred):
    for i in range(start, len(events)):
        if pred(events[i]):
            return i
    return None


def key_scenes(events):
    """(name, start, end) for the key scenes of the keyboard take, found by
    the keys the screenplay lays down; a scene the take lacks is skipped."""
    key = lambda label: (lambda e: e[1] == "key" and e[2] == label)
    typed = lambda e: e[1] == "type"
    scenes = []

    def add(name, i0, i1, tail):
        if i0 is not None and i1 is not None:
            scenes.append((name, events[i0][0] - SNIPPET_LEAD, events[i1][0] + tail))

    # the columns: from the first + to the key before the first c
    plus = _find(events, 0, key("+"))
    c = _find(events, plus or 0, key("c"))
    if plus is not None and c is not None:
        last = c - 1
        while last > plus and events[last][1] != "key":
            last -= 1
        add("columns", plus, last, 1.6)
    if c is not None:
        add("contents", c, _find(events, c, key("o")), 1.8)
    a = _find(events, (c or 0) + 1, key("a"))
    if a is not None:
        add("annotations", a, _find(events, a, key("o")), 1.8)
    word = _find(events, (a or 0) + 1, lambda e: typed(e) and not e[2].replace("-", "").isdigit())
    if word is not None:
        enters = []
        i = word
        while len(enters) < 3:
            i = _find(events, i + 1, key("Enter"))
            if i is None:
                break
            enters.append(i)
        if enters:
            add("search", word, enters[-1], 1.6)
            down = _find(events, enters[-1], key("↓"))
            if down is not None:
                add("arrows", down, _find(events, down, key("←")), 1.2)
        pd = _find(events, word, key("Page Down"))
        if pd is not None:
            add("pages", pd, _find(events, pd, key("Page Up")), 1.8)
    number = _find(events, (word or 0) + 1, lambda e: typed(e) and e[2].isdigit())
    if number is not None:
        add("page", number, _find(events, number, key("Enter")), 2.2)
        g = _find(events, number, key("Ctrl+G"))
        if g is not None:
            add("range", g, _find(events, g, key("→")), 1.4)
    last_o = None
    for i, e in enumerate(events):
        if e[1] == "key" and e[2] == "o":
            last_o = i
    if last_o is not None:
        add("open", last_o, last_o, 3.0)
    return scenes


def snippet(src, out, poster, start, end, width, crop):
    """One scene of a take as a short loop and its poster, cropped to the
    sheet with its surroundings and scaled to SNIPPET_WIDTH."""
    scale = width / 1512
    x, y, w, h = (int(v * scale) for v in crop)
    vf = f"crop={w}:{h}:{x}:{y},scale={SNIPPET_WIDTH}:-2:flags=lanczos"
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{max(0, start):.3f}", "-t", f"{end - max(0, start):.3f}", "-i", str(src),
        "-vf", vf + ",format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
        "-an", "-movflags", "+faststart", str(out)])
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{max(0, start) + 0.3:.3f}", "-i", str(src), "-frames:v", "1", "-vf", vf, str(poster)])


def snippets(clip, timeline, prefix, out_dir, width, crop, offset=0.0):
    events = [(t + offset, k, l, p) for t, k, l, p in read_timeline(timeline)]
    made = []
    for name, start, end in key_scenes(events):
        mp4 = out_dir / f"{prefix}-key-{name}.mp4"
        png = out_dir / f"{prefix}-key-{name}.png"
        snippet(clip, mp4, png, start, end, width, crop)
        made.append((name, mp4.stat().st_size / 1e6, end - start))
    return made


def take_file(clip, out):
    """A take as a file of its own, at the delivery quality."""
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(clip),
        "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-an",
        "-movflags", "+faststart", str(out)])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("takes", type=Path, help="directory with <prefix>-mouse.mov/.tsv and <prefix>-keyboard.mov/.tsv")
    ap.add_argument("--prefix", default="macos")
    ap.add_argument("--out", type=Path, default=Path("asset/screenshot"))
    ap.add_argument("--width", type=int, default=1512, help="width of the videos")
    ap.add_argument("--keep", action="store_true", help="keep the intermediate files")
    ap.add_argument("--crop", help="the GIF's cut, x,y,width,height in points of the window")
    ap.add_argument("--lang", default="en", choices=sorted(TITLES),
                    help="language of the title cards (default: en)")
    ap.add_argument("--offset", type=float, default=0.0,
                    help="seconds added to every timeline entry, for a recording that started later than the timeline assumed")
    ap.add_argument("--gif-take", default="mouse", choices=["mouse", "keyboard", "both"],
                    help="which take the GIF shows (default: the mouse)")
    ap.add_argument("--gif-seconds", type=float, default=None,
                    help="end the GIF after so many seconds of its take (default: the whole take)")
    ap.add_argument("--platform", choices=["mac", "win", "linux"], default=None,
                    help="how the caps name the modifiers (default: from the prefix)")
    ap.add_argument("--snippets", action="store_true",
                    help="also write each take as <prefix>-mouse.mp4 / -keyboard.mp4 and the keyboard take's key scenes as <prefix>-key-<scene>.mp4 with posters")
    ap.add_argument("--no-chips", action="store_true",
                    help="draw no key chips: the keys are already in the picture, as Keyviz puts them there on Windows")
    args = ap.parse_args()
    crop = tuple(int(v) for v in args.crop.split(",")) if args.crop else GIF_CROP
    platform = args.platform or ("win" if args.prefix.startswith("windows") else "linux" if args.prefix.startswith("linux") else "mac")

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is not on the PATH")
    takes = {}
    for part in ("mouse", "keyboard"):
        mov = args.takes / f"{args.prefix}-{part}.mov"
        tsv = args.takes / f"{args.prefix}-{part}.tsv"
        if not mov.exists() or not tsv.exists():
            sys.exit(f"missing {mov} or {tsv}")
        takes[part] = (mov, tsv)

    src_w, src_h, _ = probe(takes["mouse"][0])
    width = args.width
    height = round(src_h * width / src_w / 2) * 2
    args.out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="screencast-"))
    try:
        parts = []
        clips = {}
        for part, title in zip(("mouse", "keyboard"), TITLES[args.lang]):
            card = work / f"{part}-title.mp4"
            title_clip(title, card, width, height, work, frame_of(takes[part][0], 0.2, work))
            clip = work / f"{part}-take.mp4"
            take_with_chips(takes[part][0], takes[part][1], clip, width, height, work, args.offset,
                            with_chips=not args.no_chips, platform=platform)
            parts += [card, clip]
            clips[part] = clip
        mp4 = args.out / f"{args.prefix}-screencast.mp4"
        concat(parts, mp4)
        webm(mp4, args.out / f"{args.prefix}-screencast.webm")
        gif_src = mp4 if args.gif_take == "both" else clips[args.gif_take]
        gif(gif_src, args.out / f"{args.prefix}-screencast.gif", width, work, crop, args.gif_seconds)
        for name in ("mp4", "webm", "gif"):
            p = args.out / f"{args.prefix}-screencast.{name}"
            print(f"{p}  {p.stat().st_size / 1e6:.1f} MB")
        if args.snippets:
            for part in ("mouse", "keyboard"):
                p = args.out / f"{args.prefix}-{part}.mp4"
                take_file(clips[part], p)
                print(f"{p}  {p.stat().st_size / 1e6:.1f} MB")
            for name, mb, secs in snippets(clips["keyboard"], takes["keyboard"][1], args.prefix, args.out, width, crop, args.offset):
                print(f"{args.out / (args.prefix + '-key-' + name + '.mp4')}  {mb:.2f} MB  {secs:.1f} s")
    finally:
        if args.keep:
            print("intermediates in", work)
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
