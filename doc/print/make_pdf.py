#!/usr/bin/env python3
"""Render a documentation language project as one PDF.

    python3 make_pdf.py LANG_DIR OUTPUT_PDF [AUTHOR] [--version V] [--date D]

Assembles a temporary Quarto *book* from the pages of the website
project in LANG_DIR — the chapter order is the sidebar order, read from
the project's _quarto.yml, so the PDF cannot fall behind a page that was
added; top-level sidebar sections become book parts carrying the
section's title. Renders with Typst: no TeX toolchain, Noto Sans
embedded from the font/ directory beside this script, a linked table
of contents, and citations linked to one bibliography at the end (the
pages' own ``::: {#refs}`` placements are stripped — in a single volume
the literature belongs in one place).

The cover takes its title from website.title and its subtitle from the
front matter of the language's index.qmd (falling back to
"Documentation"/"Dokumentation"), so cover and website cannot drift
apart. The author — mandatory, the orange-book cover Quarto uses for
Typst books fails without one — is resolved centrally: the AUTHOR
argument wins, then the same front matter's ``author:``, then the theme
extension's ``author:`` (``_extensions/easyqda-theme/_extension.yml``,
mirrored into every language project), so a site needs no per-page
author to build.

If the project keeps page graphics in an asset/ or figures/ directory
(the layout the build scripts mirror into each language project), it is
copied into the book so no image breaks. Executable pages run exactly
as they do for the site; set QUARTO_PYTHON before calling, as the site
build already does. Needs PyYAML.

Every page but the cover carries a footer, set like the running header
and ruled off the same way: the version on the left, the date on the
right, so a printed or saved copy says which state of the documentation
it is. The page number stays in the header. The version comes from
--version (or DOC_VERSION), the date from --date (or DOC_DATE, else today
in UTC); with no version the left side names only the site.

Two things about the book format are put right on the way. Its part page
laid the part's contents over the part's title — orange-book sets both
with place() and the outline, two levels deep, grew up into the heading —
so the outline is cut to chapters. And the format never closes a part:
top-level chapters after it were counted as its members, in the part's
own outline and in the running header, so the part state is reset at the
end of each part.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

def fonts_dir():
    # The Noto Sans TTFs sit beside this script in the theme repository
    # (print/font/); a site that vendors the script into code/ keeps
    # them under asset/font/ttf instead (excluded from publishing —
    # the woff2 subsets serve the website). Both layouts work
    # unpatched, and both under their pre-rename plural names too, so
    # a checkout or a vendoring site from before the rename keeps
    # building.
    here = Path(__file__).resolve().parent
    for cand in (here / "font", here / "fonts",
                 here.parent / "asset" / "font" / "ttf",
                 here.parent / "asset" / "fonts" / "ttf"):
        if cand.is_dir():
            return cand
    raise SystemExit(f"make_pdf: no font directory (looked for font/ and "
                     f"fonts/ beside {here} and under asset/font/ttf and "
                     "asset/fonts/ttf)")

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
    ext = lang_dir / "_extensions" / "easyqda-theme" / "_extension.yml"
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


# Quarto's Typst book format is the orange-book extension, applied through
# two template partials, page.typ and typst-show.typ. A book may ship its own
# copies of those under the same names, which is how the footer and the
# shallower part outline get in without touching the extension: the text
# below is Quarto 1.10's own with those two changes, and nothing else.
PAGE_TYP = """#import "@preview/orange-book:0.7.1": title5
#set page(
  paper: $if(papersize)$"$papersize$"$else$"us-letter"$endif$,
$if(margin-geometry)$
  // Margins handled by marginalia.setup in typst-show.typ AFTER book.with()
$elseif(margin)$
  margin: ($for(margin/pairs)$$margin.key$: $margin.value$,$endfor$),
$else$
  margin: (x: 1.25in, y: 1.25in),
$endif$
  numbering: none,
  // The state of the documentation, on every page but the cover: what a
  // printed or saved copy has to say for itself. Set like orange-book's
  // running header — its size, its rule, its distance from the rule —
  // mirrored: the header rules below its text, the footer above. The
  // page number stays with the header. The cover is page 1 and
  // orange-book draws it with margin 0, so a footer there would sit on
  // the paper's edge.
  footer: context if counter(page).get().first() > 1 {
    set text(size: title5)
    box(width: 100%, inset: (top: 5pt), stroke: (top: 0.5pt))[
      $doc-footer-left$
      #h(1fr)
      $doc-footer-right$
    ]
  },
)
// Logo is handled by orange-book's cover page, not as a page background
// NOTE: marginalia.setup is called in typst-show.typ AFTER book.with()
// to ensure marginalia's margins override the book format's default margins
"""

TYPST_SHOW_TYP = """#import "@preview/orange-book:0.7.1": book, part, chapter, appendices

#show: book.with(
$if(title)$
  title: [$title$],
$endif$
$if(subtitle)$
  subtitle: [$subtitle$],
$endif$
$if(by-author)$
  author: "$for(by-author)$$it.name.literal$$sep$, $endfor$",
$endif$
$if(date)$
  date: "$date$",
$endif$
$if(lang)$
  lang: "$lang$",
$endif$
  main-color: brand-color.at("primary", default: blue),
  logo: {
    let logo-info = brand-logo.at("medium", default: none)
    if logo-info != none { image(logo-info.path, alt: logo-info.at("alt", default: none)) }
  },
$if(toc-depth)$
  outline-depth: $toc-depth$,
$endif$
  // Chapters only on the part page. Two levels deep, the outline of a part
  // with a handful of chapters ran to forty rows and, placed from the
  // bottom, grew up into the part's title placed from the top.
  outline-small-depth: 1,
$if(lof)$
$if(crossref.lof-title)$
  list-of-figure-title: "$crossref.lof-title$",
$else$
$if(quarto.language.crossref-lof-title)$
  list-of-figure-title: "$quarto.language.crossref-lof-title$",
$endif$
$endif$
$endif$
$if(lot)$
$if(crossref.lot-title)$
  list-of-table-title: "$crossref.lot-title$",
$else$
$if(quarto.language.crossref-lot-title)$
  list-of-table-title: "$quarto.language.crossref-lot-title$",
$endif$
$endif$
$endif$
$if(quarto.language.crossref-ch-prefix)$
  supplement-chapter: "$quarto.language.crossref-ch-prefix$",
$endif$
$if(margin-geometry)$
  padded-heading-number: false,
$endif$
)

$if(margin-geometry)$
#import "@preview/marginalia:0.3.1" as marginalia

#show: marginalia.setup.with(
  inner: (
    far: $margin-geometry.inner.far$,
    width: $margin-geometry.inner.width$,
    sep: $margin-geometry.inner.separation$,
  ),
  outer: (
    far: $margin-geometry.outer.far$,
    width: $margin-geometry.outer.width$,
    sep: $margin-geometry.outer.separation$,
  ),
  top: $if(margin.top)$$margin.top$$else$1.25in$endif$,
  bottom: $if(margin.bottom)$$margin.bottom$$else$1.25in$endif$,
  book: true,
  clearance: $margin-geometry.clearance$,
)
$endif$
"""

# orange-book never closes a part: every top-level chapter after one is
# counted as its member, in the part's own outline and in the running
# header. Appended to the last chapter of a part, so that it runs before
# the next chapter's heading — Quarto sets that heading from the chapter's
# front matter, ahead of anything the chapter's body could say.
CLOSE_PART = (
    "```{=typst}\n"
    "#import \"@preview/orange-book:0.7.1\": part-state\n"
    "#part-state.update(none)\n"
    "```\n\n"
)


def last_pages_of_parts(book_chapters):
    """The page that closes each part."""
    return [item["chapters"][-1] for item in book_chapters
            if isinstance(item, dict) and "part" in item and item["chapters"]]


def main(lang_dir, output_pdf, author=None, version=None, date=None):
    lang_dir = Path(lang_dir).resolve()
    output_pdf = Path(output_pdf).resolve()
    cfg = yaml.safe_load((lang_dir / "_quarto.yml").read_text("utf-8"))
    book_chapters, pages = book_structure(cfg)
    lang = cfg.get("lang", "en")
    # A regional tag such as en-GB reaches Typst as a bare "en": Quarto's
    # Typst book template takes a language and no region, so its call site
    # carries `lang:` alone — visible in the generated index.typ — and both
    # the hyphenation and the PDF's /Lang fall back to the generic. Setting
    # the region again after the template has run is what gets it through;
    # measured against /Lang in the finished PDF, which reads en-GB with the
    # header and plain en without it.
    base, _, region = lang.partition("-")
    title = cfg["website"]["title"]
    meta = index_front_matter(lang_dir)
    # the cover prints plain text; strip markdown emphasis markers
    subtitle = re.sub(r"\*+", "", meta.get("subtitle", "")) or (
        "Dokumentation" if base == "de" else "Documentation")
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
        closers = set(last_pages_of_parts(book_chapters))
        for page in pages:
            src = lang_dir / page
            dst = tmp / page
            dst.parent.mkdir(parents=True, exist_ok=True)
            text = REFS_BLOCK.sub("\n", src.read_text("utf-8"))
            if page in closers:
                text = text.rstrip("\n") + "\n\n" + CLOSE_PART
            dst.write_text(text, encoding="utf-8")

        # Pages may reference graphics under asset/ or figures/ (mirrored
        # into the language project by the site build); without the copy
        # every image would break the book render.
        for graphics in ("asset", "figures"):
            src = lang_dir / graphics
            if src.exists():
                shutil.copytree(src, tmp / graphics)

        import datetime
        version = version or os.environ.get("DOC_VERSION") or ""
        date = date or os.environ.get("DOC_DATE") or \
            datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        footer_left = f"{title} {version}" if version else title
        (tmp / "page.typ").write_text(PAGE_TYP, encoding="utf-8")
        (tmp / "typst-show.typ").write_text(TYPST_SHOW_TYP, encoding="utf-8")

        book = {
            "project": {"type": "book"},
            "lang": lang,
            "book": {"title": title, "subtitle": subtitle,
                     "author": author, "chapters": book_chapters},
            # read by page.typ; Typst markup, so keep them plain text
            "doc-footer-left": footer_left,
            "doc-footer-right": date,
            "format": {"typst": {
                "toc": True,
                "toc-depth": 2,
                "papersize": "a4",
                "mainfont": "Noto Sans",
                "font-paths": [str(fonts_dir())],
                "link-citations": True,
                "keep-typ": False,
                "template-partials": ["page.typ", "typst-show.typ"],
            }},
        }
        if region:
            (tmp / "region.typ").write_text(
                f'#set text(region: "{region}")\n', encoding="utf-8")
            book["format"]["typst"]["include-in-header"] = "region.typ"
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
    args = sys.argv[1:]
    opts = {}
    for flag in ("--version", "--date"):
        if flag in args:
            at = args.index(flag)
            opts[flag[2:]] = args[at + 1]
            del args[at:at + 2]
    if len(args) not in (2, 3):
        raise SystemExit(__doc__)
    main(*args, **opts)
