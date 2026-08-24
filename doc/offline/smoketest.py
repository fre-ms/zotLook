#!/usr/bin/env python3
"""Prove a postprocessed site actually works from a plain file tree.

    python3 smoketest.py SITE_DIR [SITE_DIR ...]

Loads real pages in a headless Chromium-family browser over file:// and
checks the things postprocess.py exists for — the checks that caught
every regression while this pipeline was built:

* TOC scroll tracking: after scrolling into a page, the active class
  must move to the section under the viewport (dead when quarto.js
  fails to load as a module).
* Search: readSearchData() must return a Fuse index with documents
  (dead when the index cannot be fetched).
* Math: pages that reference the vendored MathJax must render at least
  one mjx-container.
* Fonts: when the site ships fonts/noto.css, "Noto Sans" must report
  loaded.
* No page may reference a known CDN host (also enforced by
  postprocess.py; re-checked here as a belt).

The browser comes from $QDA_SMOKE_BROWSER or a list of common
locations. Exit code is non-zero on the first failure, with the page
and check named.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CDN_HOSTS = ("cdn.jsdelivr.net", "cdnjs.cloudflare.com",
             "fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com")

BROWSERS = (
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
)


def find_browser() -> str:
    explicit = os.environ.get("QDA_SMOKE_BROWSER")
    candidates = [explicit] if explicit else list(BROWSERS)
    for c in candidates:
        if c and (Path(c).is_file() or shutil.which(c)):
            return c
    raise SystemExit("smoketest: no Chromium-family browser found; set "
                     "QDA_SMOKE_BROWSER")


def run_probe(browser: str, page: Path, script: str) -> dict:
    """Load a copy of the page with `script` appended, return its report.

    The script must eventually append <div id="zzsmoke">JSON</div> to
    the body.
    """
    html = page.read_text(encoding="utf-8")
    probe = html.replace("</body>", f"<script>{script}</script></body>", 1)
    with tempfile.NamedTemporaryFile("w", suffix=".html", dir=page.parent,
                                     prefix="_smoke_", delete=False,
                                     encoding="utf-8") as tmp:
        tmp.write(probe)
        tmp_path = Path(tmp.name)
    flags = [browser, "--headless", "--disable-gpu"]
    if sys.platform.startswith("linux"):
        flags.append("--no-sandbox")   # CI containers run as root
    flags += ["--dump-dom", "--virtual-time-budget=10000",
              f"file://{tmp_path}"]
    try:
        # headless browsers occasionally hang on startup; one clean
        # retry separates that from a page that genuinely never loads
        for attempt in (1, 2):
            try:
                out = subprocess.run(flags, capture_output=True, text=True,
                                     timeout=90).stdout
                break
            except subprocess.TimeoutExpired:
                if attempt == 2:
                    raise SystemExit(
                        f"smoketest: browser hung twice on {page}")
    finally:
        tmp_path.unlink(missing_ok=True)
    m = re.search(r'<div id="zzsmoke">([^<]*)</div>', out)
    if not m:
        raise SystemExit(f"smoketest: probe produced no report on {page}")
    return json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&"))


PROBE = """
window.addEventListener('load', function () {
  setTimeout(function () {
    window.scrollTo(0, 1200);
    /* headless virtual time delivers native scroll events unreliably;
       dispatching explicitly still exercises quarto.js's listener,
       which is what dies when the module fails to load */
    document.dispatchEvent(new Event('scroll'));
  }, 400);
  setTimeout(function () { document.dispatchEvent(new Event('scroll')); }, 1500);
  setTimeout(function () {
    var report = {};
    var links = document.querySelectorAll('.margin-sidebar a[data-scroll-target]');
    if (links.length > 1) {
      var active = -1;
      links.forEach(function (a, i) { if (a.classList.contains('active')) active = i; });
      report.tocLinks = links.length;
      report.tocActive = active;
      /* what quarto.js itself would pick for this scroll position */
      var expected = 0;
      if (window.innerHeight + window.pageYOffset >= document.body.offsetHeight) {
        expected = links.length - 1;
      } else {
        links.forEach(function (a, i) {
          var s = document.getElementById(a.getAttribute('data-scroll-target').slice(1));
          if (s && window.pageYOffset >= s.offsetTop - 200) expected = i;
        });
      }
      report.tocExpected = expected;
    }
    var mathRequested = !!document.querySelector('script[src*="mathjax"]');
    if (mathRequested) {
      report.mjx = document.querySelectorAll('mjx-container').length;
    }
    var notoRequested = !!document.querySelector('link[href*="noto.css"]');
    if (notoRequested) {
      report.noto = document.fonts.check('1em "Noto Sans"');
    }
    /* the magnifier is inserted by script — it is exactly what silently
       vanishes when a page script dies */
    var btn = document.querySelector('.aa-DetachedSearchButton');
    report.searchButton = !!(btn && btn.offsetWidth > 0);
    var finish = function () {
      var d = document.createElement('div');
      d.id = 'zzsmoke';
      d.textContent = JSON.stringify(report);
      document.body.appendChild(d);
    };
    if (typeof readSearchData === 'function') {
      Promise.resolve(readSearchData()).then(function (idx) {
        report.searchDocs = idx && idx._docs ? idx._docs.length : 0;
      }).catch(function (e) {
        report.searchError = String(e);
      }).then(finish);
    } else {
      report.searchMissing = true;
      finish();
    }
  }, 3000);
});
"""


def pick_pages(site: Path):
    """One page with a multi-entry TOC, plus one math page if any."""
    toc_page = math_page = None
    for page in sorted(site.rglob("*.html")):
        html = page.read_text(encoding="utf-8")
        if toc_page is None and html.count("data-scroll-target") > 2:
            toc_page = page
        if math_page is None and 'src="' in html and "mathjax" in html:
            math_page = page
        if toc_page is not None and math_page is not None:
            break
    return [p for p in dict.fromkeys([toc_page, math_page]) if p]


def check_site(browser: str, site: Path) -> None:
    for page in site.rglob("*.html"):
        html = page.read_text(encoding="utf-8")
        for host in CDN_HOSTS:
            if re.search(rf'(?:src|href)="https?://{re.escape(host)}', html):
                raise SystemExit(
                    f"smoketest: {page.relative_to(site)} references {host}")

    pages = pick_pages(site)
    if not pages:
        raise SystemExit(f"smoketest: no probe-worthy page found in {site}")
    for page in pages:
        rel = page.relative_to(site)
        r = run_probe(browser, page, PROBE)
        if "tocLinks" in r and r.get("tocActive") != r.get("tocExpected"):
            raise SystemExit(
                f"smoketest: {rel}: TOC active index {r.get('tocActive')} "
                f"but the scroll position demands {r.get('tocExpected')} "
                "— quarto.js dead?")
        if r.get("searchMissing"):
            raise SystemExit(f"smoketest: {rel}: quarto-search.js not loaded")
        if "searchError" in r:
            raise SystemExit(f"smoketest: {rel}: search failed: "
                             f"{r['searchError'][:120]}")
        if r.get("searchDocs", 1) == 0:
            raise SystemExit(f"smoketest: {rel}: search index is empty")
        if not r.get("searchButton"):
            raise SystemExit(f"smoketest: {rel}: the search button never "
                             "appeared in the navbar")
        if "mjx" in r and r["mjx"] == 0:
            raise SystemExit(f"smoketest: {rel}: MathJax rendered nothing")
        if "noto" in r and not r["noto"]:
            raise SystemExit(f"smoketest: {rel}: Noto Sans did not load")
        print(f"{site.name}/{rel}: {json.dumps(r)}")


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    browser = find_browser()
    for arg in argv:
        site = Path(arg).resolve()
        if not site.is_dir():
            raise SystemExit(f"smoketest: no such site directory: {site}")
        check_site(browser, site)
    print("smoketest: all green")


if __name__ == "__main__":
    main(sys.argv[1:])
