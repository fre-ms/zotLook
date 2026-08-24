#!/usr/bin/env python3
"""COinS + Download-Buttons für die Literaturseite (theme feature).

Macht die Literaturliste **für Zotero lesbar** (COinS / Z39.88) und hängt an
jeden Eintrag Download-Buttons (BibTeX, RIS) — die beiden Funktionen aus
curriculum-mis-med, hier ins zotqda-quarto-theme zurückmigriert.

Anders als dort werden die kuratierten, **nach Fragestellung gruppierten**
Tabellen der zotQDA-Ökosystem-Seiten NICHT durch eine flache CSL-Liste
ersetzt (das bräuchte multibib und bräche zudem den Typst-PDF-Build, weil
pandoc Referenzen nicht auf mehrere `#refs`-Divs verteilt). Stattdessen bleibt
die gerenderte Seite, wie sie ist, und dieses Skript reichert sie an:

1. es parst die `references.bib` des Projekts,
2. schreibt pro Eintrag `<output>/refs/<citekey>.bib` und `.ris` sowie die
   Gesamtlisten `refs/references.bib` / `refs/references.ris`,
3. ordnet jeden Bib-Eintrag seiner Stelle auf der Seite zu — über die DOI
   (die in Tabellen und Bib steht) oder über einen ausdrücklichen
   `[…]{ref="citekey"}`-Marker für Einträge ohne DOI —, hängt dort einen
   unsichtbaren COinS-Span und eine Button-Zeile an,
4. setzt einen „Gesamtliste: BibTeX · RIS"-Balken unter die Einleitung.

Läuft als Quarto-`project.post-render` (registriert in `_quarto.yml`, cwd =
Projektordner, `QUARTO_PROJECT_OUTPUT_DIR` gesetzt) oder direkt aufrufbar.
Idempotent: eine bereits verarbeitete Seite (Marker `ref-actions`) wird nicht
erneut verändert; die `refs/`-Dateien werden immer frisch geschrieben.
Offline: alle erzeugten Links zeigen auf lokale `refs/`-Dateien.
"""

import html
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote, unquote

proj = Path.cwd()
outdir = os.environ.get("QUARTO_PROJECT_OUTPUT_DIR")
if not outdir:
    sys.exit(0)
outdir = (proj / outdir).resolve()

# The literature page may sit at the project root (literature.qmd) or in a
# subdirectory (e.g. dev/literature.qmd). Find it, note its language by name,
# and mirror its relative path into the rendered output tree.
qmd = None
for cand in sorted(list(proj.glob("**/literature.qmd"))
                   + list(proj.glob("**/literatur.qmd"))):
    if "_theme" in cand.parts or "_extensions" in cand.parts:
        continue
    qmd = cand
    break
if qmd is None:
    sys.exit(0)
lang = "de" if qmd.stem == "literatur" else "en"
rel = qmd.relative_to(proj).with_suffix(".html")
page = outdir / rel
if not page.exists():
    sys.exit(0)

# references.bib lives next to the page or at the project root.
bib_path = None
for cand in (qmd.parent / "references.bib", proj / "references.bib"):
    if cand.exists():
        bib_path = cand.resolve()
        break
if bib_path is None:
    sys.exit(0)

# refs/ downloads go next to the page so the relative hrefs resolve.
page_dir = page.parent


# --- BibTeX-Parser (ein Eintrag pro @-Block, geschweifte Klammern) ---------

def parse_bib(text):
    text = "\n".join(
        l for l in text.splitlines() if not l.lstrip().startswith("%")
    )
    entries, i = [], 0
    while True:
        at = text.find("@", i)
        if at < 0:
            break
        brace = text.find("{", at)
        if brace < 0:
            break
        typ = text[at + 1:brace].strip().lower()
        comma = text.find(",", brace)
        key = text[brace + 1:comma].strip()
        depth, j = 0, brace
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        raw = text[at:j + 1]
        fields = parse_fields(text[comma + 1:j])
        entries.append({"type": typ, "key": key, "raw": raw, **fields})
        i = j + 1
    return entries


def parse_fields(body):
    fields, i, n = {}, 0, len(body)
    while i < n:
        while i < n and body[i] in " \t\r\n,":
            i += 1
        eq = body.find("=", i)
        if eq < 0:
            break
        name = body[i:eq].strip().lower()
        i = eq + 1
        while i < n and body[i] in " \t\r\n":
            i += 1
        if i < n and body[i] in "{\"":
            close = "}" if body[i] == "{" else "\""
            if body[i] == "{":
                depth, j = 0, i
                while j < n:
                    if body[j] == "{":
                        depth += 1
                    elif body[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
            else:
                j = body.find(close, i + 1)
                j = n if j < 0 else j
            fields[name] = body[i + 1:j]
            i = j + 1
        else:
            j = body.find(",", i)
            j = n if j < 0 else j
            fields[name] = body[i:j].strip()
            i = j + 1
    return fields


LATEX = [
    ('{\\"a}', "ä"), ('{\\"o}', "ö"), ('{\\"u}', "ü"),
    ('{\\"A}', "Ä"), ('{\\"O}', "Ö"), ('{\\"U}', "Ü"),
    ('\\"a', "ä"), ('\\"o', "ö"), ('\\"u', "ü"), ("{\\ss}", "ß"),
    ("\\&", "&"), ("~", " "), (" -- ", " – "), ("--", "–"),
]


def clean(s):
    for a, b in LATEX:
        s = s.replace(a, b)
    return s.replace("{", "").replace("}", "").strip()


def authors(field):
    out = []
    for part in re.split(r"\s+and\s+", field or ""):
        part = part.strip()
        if not part or part == "others":
            continue
        corp = part.startswith("{") and part.endswith("}")
        out.append((clean(part), corp))
    return out


def pages_of(e):
    p = e.get("pages", "")
    if "--" in p:
        sp, ep = p.split("--", 1)
        return sp.strip(), ep.strip()
    if "-" in p and p.count("-") == 1:
        sp, ep = p.split("-", 1)
        return sp.strip(), ep.strip()
    return p.strip(), ""


def norm_doi(d):
    d = unquote((d or "").strip()).lower()
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d)
    return d


# --- RIS -------------------------------------------------------------------

RIS_TYPES = {
    "article": "JOUR", "book": "BOOK", "incollection": "CHAP",
    "inbook": "CHAP", "techreport": "RPRT", "inproceedings": "CPAPER",
    "manual": "GEN", "misc": "GEN", "online": "ELEC",
}


def to_ris(e):
    lines = [f"TY  - {RIS_TYPES.get(e['type'], 'GEN')}"]
    for name, _ in authors(e.get("author", "")):
        lines.append(f"AU  - {name}")
    for name, _ in authors(e.get("editor", "")):
        lines.append(f"A2  - {name}")
    lines.append(f"TI  - {clean(e.get('title', ''))}")
    t2 = e.get("journal") or e.get("booktitle") or ""
    if t2:
        lines.append(f"T2  - {clean(t2)}")
    if e.get("series"):
        lines.append(f"T3  - {clean(e['series'])}")
    if e.get("volume"):
        lines.append(f"VL  - {e['volume']}")
    if e.get("number"):
        lines.append(f"IS  - {clean(e['number'])}")
    sp, ep = pages_of(e)
    if sp:
        lines.append(f"SP  - {sp}")
    if ep:
        lines.append(f"EP  - {ep}")
    if e.get("year"):
        lines.append(f"PY  - {e['year']}")
    pub = e.get("publisher") or e.get("institution") or e.get("organization") or ""
    if pub:
        lines.append(f"PB  - {clean(pub)}")
    if e.get("address"):
        lines.append(f"CY  - {clean(e['address'])}")
    if e.get("isbn"):
        lines.append(f"SN  - {e['isbn']}")
    if e.get("doi"):
        lines.append(f"DO  - {norm_doi(e['doi'])}")
        lines.append(f"UR  - https://doi.org/{norm_doi(e['doi'])}")
    elif e.get("url"):
        lines.append(f"UR  - {e['url']}")
    note = e.get("note", "")
    if e.get("oclc"):
        note = (note + "; " if note else "") + "OCLC: " + e["oclc"]
    if note:
        lines.append(f"N1  - {clean(note)}")
    lines.append("ER  - ")
    return "\n".join(lines) + "\n"


# --- COinS (Z39.88 ContextObject in Span) ----------------------------------

def to_coins(e, sid):
    kev = [("ctx_ver", "Z39.88-2004"), ("rfr_id", f"info:sid/{sid}")]
    typ = e["type"]
    if typ == "article":
        kev += [("rft_val_fmt", "info:ofi/fmt:kev:mtx:journal"),
                ("rft.genre", "article"),
                ("rft.atitle", clean(e.get("title", "")))]
        if e.get("journal"):
            kev.append(("rft.jtitle", clean(e["journal"])))
        if e.get("volume"):
            kev.append(("rft.volume", e["volume"]))
        if e.get("number"):
            kev.append(("rft.issue", clean(e["number"])))
        sp, ep = pages_of(e)
        if sp:
            kev.append(("rft.spage", sp))
        if ep:
            kev.append(("rft.epage", ep))
    else:
        kev.append(("rft_val_fmt", "info:ofi/fmt:kev:mtx:book"))
        genre = {"book": "book", "incollection": "bookitem",
                 "inbook": "bookitem", "inproceedings": "proceeding",
                 "techreport": "report"}.get(typ, "document")
        kev.append(("rft.genre", genre))
        if typ in ("incollection", "inbook", "inproceedings"):
            kev.append(("rft.atitle", clean(e.get("title", ""))))
            if e.get("booktitle"):
                kev.append(("rft.btitle", clean(e["booktitle"])))
        else:
            kev.append(("rft.btitle", clean(e.get("title", ""))))
        pub = e.get("publisher") or e.get("institution") or e.get("organization") or ""
        if pub:
            kev.append(("rft.pub", clean(pub)))
        if e.get("address"):
            kev.append(("rft.place", clean(e["address"])))
        if e.get("isbn"):
            kev.append(("rft.isbn", e["isbn"].replace("-", "")))
    if e.get("year"):
        kev.append(("rft.date", e["year"]))
    for name, corp in authors(e.get("author", "")):
        kev.append(("rft.aucorp" if corp else "rft.au", name))
    if e.get("doi"):
        kev.append(("rft_id", f"info:doi/{norm_doi(e['doi'])}"))
    elif e.get("url"):
        kev.append(("rft_id", e["url"]))
    title = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in kev)
    return f'<span class="Z3988" title="{html.escape(title)}"></span>'


# --- Dateien schreiben (immer, idempotent) ---------------------------------

entries = parse_bib(bib_path.read_text(encoding="utf-8"))
by_key = {e["key"]: e for e in entries}
by_doi = {norm_doi(e["doi"]): e for e in entries if e.get("doi")}
sid = re.sub(r"[^a-z0-9.-]+", "-", (proj.parent.name or "zotqda").lower())

refs_dir = page_dir / "refs"
refs_dir.mkdir(parents=True, exist_ok=True)
for e in entries:
    (refs_dir / f"{e['key']}.bib").write_text(e["raw"] + "\n", encoding="utf-8")
    (refs_dir / f"{e['key']}.ris").write_text(to_ris(e), encoding="utf-8")
(refs_dir / "references.bib").write_text(
    "\n\n".join(e["raw"] for e in entries) + "\n", encoding="utf-8")
(refs_dir / "references.ris").write_text(
    "\n".join(to_ris(e) for e in entries), encoding="utf-8")

# --- HTML anreichern (nur wenn noch nicht geschehen) -----------------------

doc = page.read_text(encoding="utf-8")
if 'class="ref-actions"' in doc:
    sys.exit(0)

STYLE = (
    "<style>"
    ".ref-actions{display:flex;flex-wrap:wrap;gap:.4rem;margin:.3rem 0 .1rem;"
    "text-indent:0}"
    ".ref-btn{display:inline-block;font-size:.72em;line-height:1.5;"
    "padding:.02rem .5rem;border:1px solid rgba(128,128,128,.5);"
    "border-radius:.3rem;text-decoration:none;color:inherit;opacity:.85;"
    "white-space:nowrap}"
    ".ref-btn:hover{opacity:1;text-decoration:none}"
    ".refs-all{display:flex;flex-wrap:wrap;gap:.4rem;align-items:baseline;"
    "margin:.6rem 0 1.2rem;text-indent:0}"
    "</style>"
)
doc = doc.replace("</head>", STYLE + "</head>", 1)


def btn(href, text):
    return f'<a class="ref-btn" href="{href}" download>{text}</a>'


def actions(e):
    coins = to_coins(e, sid)
    bar = ('<span class="ref-actions">' + btn(f"refs/{e['key']}.bib", "BibTeX")
           + btn(f"refs/{e['key']}.ris", "RIS") + "</span>")
    return coins + bar


# 1) DOI-Einträge: den passenden Anker in einem doi.org-Link finden und die
#    Aktionszeile direkt dahinter setzen (in der Tabellen-„Work"-Zelle bzw.
#    im Listenpunkt). Der Link-Text bleibt unangetastet.
used = set()


def after_doi_link(match):
    href = match.group(1)
    d = norm_doi(href)
    e = by_doi.get(d)
    if not e or e["key"] in used:
        return match.group(0)
    used.add(e["key"])
    return match.group(0) + actions(e)


doc = re.sub(r'<a href="(https?://(?:dx\.)?doi\.org/[^"]+)"[^>]*>.*?</a>',
             after_doi_link, doc, flags=re.S)

# 2) Einträge ohne DOI: expliziter Marker [..]{#litref-key} -> die id bleibt
#    zuverlässig erhalten (freie Attribute verwirft der HTML-Writer teils).
#    Aktionen hinter das schließende </span> hängen.

def after_marker(match):
    key = match.group(1)
    e = by_key.get(key)
    if not e or e["key"] in used:
        return match.group(0)
    used.add(e["key"])
    return match.group(0) + actions(e)


doc = re.sub(r'<span id="litref-([^"]+)"[^>]*>.*?</span>', after_marker,
             doc, flags=re.S)

# 3) „Gesamtliste"-Balken unter die Einleitung (nach dem ersten </p> des
#    Artikelinhalts). Fällt auf „nach <h1>" zurück, wenn kein <p> gefunden.
label_all = "Alle Referenzen:" if lang == "de" else "All references:"
all_bar = (f'<p class="refs-all">{label_all} '
           + btn("refs/references.bib", "BibTeX")
           + btn("refs/references.ris", "RIS") + "</p>")
m = re.search(r"</h1>", doc)
if m:
    doc = doc[:m.end()] + all_bar + doc[m.end():]

page.write_text(doc, encoding="utf-8")
missing = [e["key"] for e in entries if e["key"] not in used]
if missing:
    sys.stderr.write("literature.py: no anchor for " + ", ".join(missing) + "\n")
