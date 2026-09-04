#!/usr/bin/env python3
"""The cut of the screencast: two takes, two title cards, the keys drawn in.

The recording script of each platform leaves two takes — the mouse and the
keyboard — and beside each a timeline of what it sent, and when::

    12.345<TAB>key<TAB>Ctrl+Alt+Space
    15.010<TAB>type<TAB>Tasten
    17.400<TAB>click<TAB>

This puts the takes one after the other, each behind its title card, and
shows every key from the timeline as a chip at the bottom of the frame for
as long as it is pressed — until the next key, or a good two seconds. No
key-display tool sees a scripted keystroke, so this is where the keys come
from. Clicks and scrolls are left to the pointer tool of the platform.

    script/screencast-post.py build/screencast --prefix macos --out asset/screenshot

writes <prefix>-screencast.mp4, .webm and .gif into --out. The GIF is the
mouse take alone, cut to the sheet and its surroundings at ten frames a
second, since it is for the README and has to stay small; the videos are
both takes, the whole window, halved from the Retina recording, for the
website's loop. The title card of each take is drawn over a darkened frame
of the take itself.

Wants ffmpeg with libx264 and libvpx, and Pillow for the chips.
"""

import argparse
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
TITLE_SECONDS = 2.5
FPS = 30

# The contact sheet window and a margin of its surroundings, in points of
# the 1512 × 949 Zotero window the takes show; the GIF is cut to this.
# --crop overrides it, as x,y,width,height
GIF_CROP = (30, 30, 1450, 890)  # x, y, width, height
GIF_WIDTH = 900


def font(size, bold=False):
    for regular, heavy in FONTS:
        try:
            return ImageFont.truetype(heavy if bold else regular, size)
        except OSError:
            continue
    return ImageFont.load_default()


def read_timeline(path):
    events = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        events.append((float(parts[0]), parts[1], parts[2]))
    return events


def chips(events):
    """(start, end, label) for every key or typed text, each ending with the
    next chip or after CHIP_SECONDS, whichever is first."""
    shown = [(t, kind, label) for t, kind, label in events if kind in ("key", "type")]
    out = []
    for i, (t, kind, label) in enumerate(shown):
        end = t + CHIP_SECONDS
        if i + 1 < len(shown):
            end = min(end, shown[i + 1][0])
        text = label if kind == "key" else "„" + label + "“"
        out.append((t, end, text))
    return out


def chip_image(text, scale):
    """A rounded dark chip with the key's name, at the video's scale
    (scale 1 = the 1512-point window)."""
    size = int(36 * scale)
    f = font(size)
    pad_x, pad_y = int(26 * scale), int(14 * scale)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    x0, y0, x1, y1 = probe.textbbox((0, 0), text, font=f)
    w, h = x1 - x0 + 2 * pad_x, y1 - y0 + 2 * pad_y
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=(20, 24, 30, 215))
    d.text((pad_x - x0, pad_y - y0), text, font=f, fill=(255, 255, 255, 255))
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


def take_with_chips(take, timeline, out, width, height, work, offset=0.0):
    """One take, halved to `width`, with its chips overlaid."""
    scale = width / 1512
    events = [(a + offset, b + offset, t) for a, b, t in chips(read_timeline(timeline))]
    inputs = ["-i", str(take)]
    filters = [f"[0:v]scale={width}:{height}:flags=lanczos,fps={FPS},format=yuv420p[v0]"]
    last = "v0"
    for i, (start, end, text) in enumerate(events):
        img = chip_image(text, scale)
        png = work / f"chip-{take.stem}-{i}.png"
        img.save(png)
        inputs += ["-i", str(png)]
        x = f"(W-w)/2"
        y = f"H-h-{int(60 * scale)}"
        filters.append(
            f"[{last}][{i + 1}:v]overlay={x}:{y}:enable='between(t,{start:.3f},{end:.3f})'[v{i + 1}]")
        last = f"v{i + 1}"
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
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-an",
        "-movflags", "+faststart", str(out)])
    listing.unlink()


def webm(src, out):
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
        "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-an", str(out)])


def gif(src, out, width, work, crop):
    scale = width / 1512
    x, y, w, h = (int(v * scale) for v in crop)
    vf = f"crop={w}:{h}:{x}:{y},fps=10,scale={GIF_WIDTH}:-1:flags=lanczos"
    palette = work / "palette.png"
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
        "-vf", vf + ",palettegen=max_colors=128:stats_mode=diff", str(palette)])
    subprocess.check_call([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-i", str(palette),
        "-lavfi", vf + "[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop", "0", str(out)])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("takes", type=Path, help="directory with <prefix>-mouse.mov/.tsv and <prefix>-keyboard.mov/.tsv")
    ap.add_argument("--prefix", default="macos")
    ap.add_argument("--out", type=Path, default=Path("asset/screenshot"))
    ap.add_argument("--width", type=int, default=1512, help="width of the videos")
    ap.add_argument("--keep", action="store_true", help="keep the intermediate files")
    ap.add_argument("--crop", help="the GIF's cut, x,y,width,height in points of the window")
    ap.add_argument("--offset", type=float, default=0.0,
                    help="seconds added to every timeline entry, for a recording that started later than the timeline assumed")
    ap.add_argument("--gif-take", default="mouse", choices=["mouse", "keyboard", "both"],
                    help="which take the GIF shows (default: the mouse)")
    args = ap.parse_args()
    crop = tuple(int(v) for v in args.crop.split(",")) if args.crop else GIF_CROP

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
        for part, title in (("mouse", "mouse navigation"), ("keyboard", "keyboard navigation")):
            card = work / f"{part}-title.mp4"
            title_clip(title, card, width, height, work, frame_of(takes[part][0], 0.2, work))
            clip = work / f"{part}-take.mp4"
            take_with_chips(takes[part][0], takes[part][1], clip, width, height, work, args.offset)
            parts += [card, clip]
            clips[part] = clip
        mp4 = args.out / f"{args.prefix}-screencast.mp4"
        concat(parts, mp4)
        webm(mp4, args.out / f"{args.prefix}-screencast.webm")
        gif_src = mp4 if args.gif_take == "both" else clips[args.gif_take]
        gif(gif_src, args.out / f"{args.prefix}-screencast.gif", width, work, crop)
        for name in ("mp4", "webm", "gif"):
            p = args.out / f"{args.prefix}-screencast.{name}"
            print(f"{p}  {p.stat().st_size / 1e6:.1f} MB")
    finally:
        if args.keep:
            print("intermediates in", work)
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
