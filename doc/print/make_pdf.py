#!/usr/bin/env python3
"""Render a documentation language project as one PDF.

    python3 make_pdf.py LANG_DIR OUTPUT_PDF [AUTHOR]

Assembles a temporary Quarto *book* from the pages of the website
project in LANG_DIR — the chapter order is the sidebar order, read from
the project's _quarto.yml, so the PDF cannot fall behind a page that was
added; top-level sidebar sections become book parts carrying the
section's title. Renders with Typst: no TeX toolchain, Noto Sans
embedded from the fonts/ directory beside this script, a linked table
of contents, and citations linked to one bibliography at the end (the
pages' own ``::: {#refs}`` placements are stripped — in a single volume
the literature belongs in one place).

The cover takes its title from website.title and its subtitle from the
front matter of the language's index.qmd (falling back to
"Documentation"/"Dokumentation"), so cover and website cannot drift
apart. The author — mandatory, the orange-book cover Quarto uses for
Typst books fails without one — is resolved centrally: the AUTHOR
argument wins, then the same front matter's ``author:``, then the theme
extension's ``author:`` (``_extensions/zotqda-theme/_extension.yml``,
mirrored into every language project), so a site needs no per-page
author to build.

If the project keeps page graphics in an asset/ or figures/ directory
(the layout the build scripts mirror into each language project), it is
copied into the book so no image breaks. Executable pages run exactly
as they do for the site; set QUARTO_PYTHON before calling, as the site
build already does. Needs PyYAML.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

def fonts_dir():
    # The Noto Sans TTFs sit beside this script in the theme repository
    # (print/fonts/); a site that vendors the script into code/ keeps
    # them under asset/fonts/ttf instead (excluded from publishing —
    # the woff2 subsets serve the website). Both layouts work
    # unpatched.
    here = Path(__file__).resolve().parent
    for cand in (here / "fonts", here.parent / "asset" / "fonts" / "ttf"):
        if cand.is_dir():
            return cand
    raise SystemExit(f"make_pdf: no font directory (looked beside {here} "
                     "and under asset/fonts/ttf)")

REFS_BLOCK = re.compile(
    r"\n#+ [^\n]*\{\.unnumbered\}\n+::: \{#refs\}\n:::\n?|\n::: \{#refs\}\n:::\n?")

FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---", re.S)


def index_front_matter(lang_dir):
    m = FRONT_MATTER.match((lang_dir / "index.qmd").read_text("utf-8"))
    return yaml.safe_load(m.group(1)) if m else {}


def theme_author(lang_dir):
    # The ecosystem author lives once, in the theme extension, and the
    # build mirrors that extension into every language project. Reading
    # it here means a site inherits the author centrally and no PDF
    # breaks for want of a per-page ``author:``.
    ext = lang_dir / "_extensions" / "zotqda-theme" / "_extension.yml"
    if ext.exists():
        return (yaml.safe_load(ext.read_text("utf-8")) or {}).get("author")
    return None


def walk_hrefs(node):
    if isinstance(node, list):
        for item in node:
            yield from walk_hrefs(item)
    elif isinstance(node, dict):
        if "href" in node:
            yield node["href"]
        yield from walk_hrefs(node.get("contents", []))


def book_structure(cfg):
    """Mirror the sidebar in the book: top-level sections become book
    parts carrying the section's title, with their pages — including
    those of nested subsections, which Quarto books cannot nest
    further — flattened in sidebar order; plain top-level entries stay
    top-level chapters. Returns the chapters value for _quarto.yml and
    the flat page list."""
    book, flat = [], []
    for item in cfg["website"]["sidebar"]["contents"]:
        pages = list(walk_hrefs(item))
        if isinstance(item, dict) and "section" in item:
            book.append({"part": item["section"], "chapters": pages})
        else:
            book.extend(pages)
        flat.extend(pages)
    return book, flat


def main(lang_dir, output_pdf, author=None):
    lang_dir = Path(lang_dir).resolve()
    output_pdf = Path(output_pdf).resolve()
    cfg = yaml.safe_load((lang_dir / "_quarto.yml").read_text("utf-8"))
    book_chapters, pages = book_structure(cfg)
    lang = cfg.get("lang", "en")
    title = cfg["website"]["title"]
    meta = index_front_matter(lang_dir)
    # the cover prints plain text; strip markdown emphasis markers
    subtitle = re.sub(r"\*+", "", meta.get("subtitle", "")) or (
        "Dokumentation" if lang == "de" else "Documentation")
    author = author or meta.get("author") or theme_author(lang_dir)
    if isinstance(author, list):
        author = ", ".join(str(a) for a in author)
    if not author:
        raise SystemExit(
            "make_pdf: no author — the Typst book cover fails without "
            "one. Pass it as the third argument, set `author:` in "
            f"{lang_dir.name}/index.qmd's front matter, or give the theme "
            "extension an `author:`.")

    with tempfile.TemporaryDirectory(prefix="qda-pdf-") as tmp:
        tmp = Path(tmp)
        # index.qmd must lead a Quarto book; the sidebar starts with it.
        assert pages[0] == "index.qmd", "the sidebar must start with index.qmd"
        for page in pages:
            src = lang_dir / page
            dst = tmp / page
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(REFS_BLOCK.sub("\n", src.read_text("utf-8")),
                           encoding="utf-8")

        # Pages may reference graphics under asset/ or figures/ (mirrored
        # into the language project by the site build); without the copy
        # every image would break the book render.
        for graphics in ("asset", "figures"):
            src = lang_dir / graphics
            if src.exists():
                shutil.copytree(src, tmp / graphics)

        book = {
            "project": {"type": "book"},
            "lang": lang,
            "book": {"title": title, "subtitle": subtitle,
                     "author": author, "chapters": book_chapters},
            "format": {"typst": {
                "toc": True,
                "toc-depth": 2,
                "papersize": "a4",
                "mainfont": "Noto Sans",
                "font-paths": [str(fonts_dir())],
                "link-citations": True,
                "keep-typ": False,
            }},
        }
        bib = lang_dir / "references.bib"
        if bib.exists():
            shutil.copy(bib, tmp / "references.bib")
            book["bibliography"] = "references.bib"
        (tmp / "_quarto.yml").write_text(
            yaml.safe_dump(book, allow_unicode=True, sort_keys=False),
            encoding="utf-8")

        subprocess.run(["quarto", "render", str(tmp), "--to", "typst"],
                       check=True)
        made = list((tmp / "_book").glob("*.pdf"))
        assert len(made) == 1, f"expected one PDF, found {made}"
        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(made[0], output_pdf)
    size = output_pdf.stat().st_size
    print(f"{output_pdf.name}: {size // 1024} KB, {len(pages)} chapters")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
