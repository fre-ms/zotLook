#!/usr/bin/env python3
"""Make a rendered Quarto website work from a plain file tree.

    python3 postprocess.py SITE_DIR [SITE_DIR ...]

Quarto's output is built for http. Opened from a file tree — which is
how help bundled into a Zotero plugin ships — three things silently die:

* quarto.js is an ES module, and browsers refuse module imports over
  file:// (and chrome://). No TOC scroll tracking, no section collapse,
  no dark-mode toggle. Repair: inline its one import and load it as a
  classic deferred script.
* the search loads search.json with fetch(), which is equally blocked.
  Repair: write the index as search-index.js next to it and patch the
  loader to pull that in as a classic script whenever the protocol is
  not http(s).
* MathJax (plus an es6 polyfill no current browser needs) comes from a
  CDN — a third-party request on every formula page, and no formulas at
  all offline. Repair: serve the copy vendored in mathjax/ beside this
  script, drop the polyfill, and drop the jquery/require tags Jupyter
  pages carry without using them.

Each repair matches exact strings in Quarto's output. When a Quarto
update changes them the run FAILS with a message naming the spot,
instead of shipping a site that breaks only for offline readers — which
is why sites should pin their Quarto version and treat upgrades as
deliberate events. A final sweep fails the run if any page still
references a known CDN host.
"""

import json
import re
import shutil
import sys
from pathlib import Path

IMPORT_LINE = 'import * as tabsets from "./tabsets/tabsets.js";'
PATCHED_MARK = "const tabsets = (() => {"

SEARCH_GUARD = '''    if (window.location.protocol === "file:" && !shownWarning) {
      window.alert(
        "Search requires JavaScript features disabled when running in file://... URLs. In order to use search, please run this document in a web server."
      );
      shownWarning = true;
      return;
    }'''

SEARCH_LOCAL = '''    if (!/^https?:$/.test(window.location.protocol)) {
      await new Promise((resolve, reject) => {
        const script = window.document.createElement("script");
        script.src = offsetURL("search-index.js");
        script.onload = resolve;
        script.onerror = reject;
        window.document.head.appendChild(script);
      });
      const fuse = new window.Fuse([], kFuseIndexOptions);
      (window.__quartoSearchIndex || []).forEach((doc) => fuse.add(doc));
      fuseIndex = fuse;
      return fuseIndex;
    }'''

MATHJAX_CDN = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml-full.js"
CDN_HOSTS = ("cdn.jsdelivr.net", "cdnjs.cloudflare.com",
             "fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com")


def die(msg: str) -> None:
    raise SystemExit(f"postprocess: {msg} — Quarto's output changed; "
                     "update this script before shipping the site")


def demodularize(site: Path) -> None:
    quarto_js = site / "site_libs" / "quarto-html" / "quarto.js"
    tabsets_js = site / "site_libs" / "quarto-html" / "tabsets" / "tabsets.js"
    if not quarto_js.exists():
        die(f"{quarto_js} not found")

    src = quarto_js.read_text(encoding="utf-8")
    if IMPORT_LINE in src:
        tabsets = tabsets_js.read_text(encoding="utf-8").replace(
            "export function init", "function init", 1)
        inlined = (PATCHED_MARK + "\n" + tabsets + "\nreturn { init };\n})();")
        quarto_js.write_text(src.replace(IMPORT_LINE, inlined, 1),
                             encoding="utf-8")
    elif PATCHED_MARK not in src:
        die("neither the tabsets import nor the patched form found in "
            "quarto.js")

    for page in site.rglob("*.html"):
        html = page.read_text(encoding="utf-8")
        patched = re.sub(
            r'(<script src="[^"]*quarto-html/quarto\.js") type="module">',
            r"\1 defer>", html)
        patched = re.sub(
            r'<script src="[^"]*quarto-html/tabsets/tabsets\.js"'
            r' type="module"></script>', "", patched)
        if patched != html:
            page.write_text(patched, encoding="utf-8")


def localize_search(site: Path) -> None:
    search_js = site / "site_libs" / "quarto-search" / "quarto-search.js"
    search_json = site / "search.json"
    if not (search_js.exists() and search_json.exists()):
        return  # site built without search

    src = search_js.read_text(encoding="utf-8")
    if SEARCH_GUARD in src:
        search_js.write_text(src.replace(SEARCH_GUARD, SEARCH_LOCAL, 1),
                             encoding="utf-8")
    elif SEARCH_LOCAL not in src:
        die("the file:// guard in quarto-search.js not found")

    (site / "search-index.js").write_text(
        "window.__quartoSearchIndex = "
        + search_json.read_text(encoding="utf-8") + ";\n",
        encoding="utf-8")


def mathjax_dir() -> Path:
    # The vendored MathJax sits beside this script in the theme
    # repository (offline/mathjax/); a site that vendors the script
    # into code/ keeps the copy under asset/offline/mathjax instead.
    # Both layouts work unpatched.
    here = Path(__file__).resolve().parent
    for cand in (here / "mathjax",
                 here.parent / "asset" / "offline" / "mathjax"):
        if cand.is_dir():
            return cand
    die(f"vendored MathJax not found (looked beside {here} and under "
        "asset/offline/mathjax)")


def localize_math(site: Path) -> None:
    mj_src = mathjax_dir()
    mj_dst = site / "site_libs" / "mathjax"
    if mj_dst.exists():
        shutil.rmtree(mj_dst)
    shutil.copytree(mj_src, mj_dst)

    for page in site.rglob("*.html"):
        html = page.read_text(encoding="utf-8")
        prefix = "../" * (len(page.relative_to(site).parts) - 1)
        # Quarto's MathJax script moved from v3
        # (mathjax@3/es5/tex-chtml-full.js) to v4 (mathjax@4/tex-chtml.js)
        # between Quarto 1.9 and 1.10. Match BOTH, so the theme localises the
        # formulas whichever Quarto built the site; the vendored, self-contained
        # tex-chtml-full.js renders the raw LaTeX either way (the
        # window.MathJax.typeset API is unchanged across v3 and v4).
        patched = re.sub(
            r'src="https://cdn\.jsdelivr\.net/npm/mathjax@\d+/'
            r'(?:es5/)?tex-chtml(?:-full)?\.js"',
            f'src="{prefix}site_libs/mathjax/tex-chtml-full.js"',
            html)
        patched = re.sub(
            r'<script src="https://cdnjs\.cloudflare\.com/polyfill/[^"]*">'
            r'</script>\s*', "", patched)
        patched = re.sub(
            r'<script src="https://cdn\.jsdelivr\.net/npm/(?:jquery|requirejs)@'
            r'[^"]*"[^>]*></script>\s*', "", patched)
        if patched != html:
            page.write_text(patched, encoding="utf-8")


def assert_self_contained(site: Path) -> None:
    for page in site.rglob("*.html"):
        html = page.read_text(encoding="utf-8")
        for host in CDN_HOSTS:
            for m in re.finditer(
                    rf'<(?:script|link)[^>]*(?:src|href)="https?://{re.escape(host)}[^"]*"',
                    html):
                die(f"{page.relative_to(site)} still loads from {host}: "
                    f"{m.group(0)[:120]}")


def add_seo(site: Path) -> None:
    """Give every page a canonical URL and its translations as alternates.

    Quarto emits neither, and for a site published under a directory per
    release both are wanted. Every page then exists once per version plus
    once under ``latest`` — six copies of each page on a site with five
    releases — and a search engine reading them as separate documents picks
    one of them arbitrarily and splits the standing of the page across the
    rest. A canonical link says which one is the page.

    Nothing new has to be configured for it. Quarto has already written
    sitemap.xml from the project's ``site-url``, which for these sites points
    at the ``latest`` copy, so the answer is in the build already.

    The alternates come from the language map the theme inlines into every
    page for its switcher: it pairs each page with its translation, which is
    exactly what hreflang needs, and it is right there in the page being
    read. Sites whose translations have different filenames are covered too,
    because the map is derived from the sidebars rather than from paths.
    """
    sitemap = site / "sitemap.xml"
    if not sitemap.exists():
        return

    locs = re.findall(r"<loc>([^<]+)</loc>", sitemap.read_text("utf-8"))
    # Map each page (by its path relative to the site) to its sitemap URL. A
    # URL belongs to the page whose relative path is the LONGEST suffix of it:
    # a short name like "exchange.html" must not capture the URL of
    # ".../dev/exchange.html", or the two would share a single canonical.
    rels = [p.relative_to(site).as_posix() for p in site.rglob("*.html")]
    by_path = {}
    base = None
    for loc in locs:
        best = ""
        for rel in rels:
            if loc.endswith("/" + rel) and len(rel) > len(best):
                best = rel
        if best:
            by_path[best] = loc
            base = loc[: -len(best)]              # …/latest/en/

    if not by_path:
        return

    # …/latest/en/ -> …/latest/ , so a sibling language can be addressed
    root = base.rstrip("/").rsplit("/", 1)[0] + "/" if base else None

    for page in site.rglob("*.html"):
        rel = page.relative_to(site).as_posix()
        canonical = by_path.get(rel)
        if not canonical:
            continue
        html = page.read_text("utf-8")
        if 'rel="canonical"' in html:
            continue

        links = [f'<link rel="canonical" href="{canonical}">']

        if root:
            key = f"{site.name}/{rel}"
            match = re.search(r"var MAP = (\{.*?\});", html, re.S)
            if match:
                try:
                    mapping = json.loads(match.group(1))
                except ValueError:
                    mapping = {}
                for lang, target in sorted(mapping.get(key, {}).items()):
                    links.append(
                        f'<link rel="alternate" hreflang="{lang}" '
                        f'href="{root}{target}">')
                # Which one an unmatched language gets. The site's own
                # language is the honest default; there is no neutral copy.
                if mapping.get(key):
                    default = mapping[key].get("en") or mapping[key][
                        sorted(mapping[key])[0]]
                    links.append(
                        f'<link rel="alternate" hreflang="x-default" '
                        f'href="{root}{default}">')

        patched = html.replace("</head>", "\n".join(links) + "\n</head>", 1)
        if patched != html:
            page.write_text(patched, "utf-8")


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit(__doc__)
    for arg in argv:
        site = Path(arg).resolve()
        if not site.is_dir():
            raise SystemExit(f"postprocess: no such site directory: {site}")
        demodularize(site)
        localize_search(site)
        localize_math(site)
        add_seo(site)
        assert_self_contained(site)
        print(f"{site.name}: offline-ready (module, search, math, no CDN), canonical and alternates set")


if __name__ == "__main__":
    main(sys.argv[1:])
