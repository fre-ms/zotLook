#!/bin/sh
# Build the documentation: regenerate the language map from the two sidebars,
# render both language projects into ../site/{en,de}, apply the offline repairs
# so the result works from a plain file tree, and build one PDF per language.
# Verify with:  python3 docs/offline/smoketest.py site/en site/de
set -e
cd "$(dirname "$0")"

# Quarto is pinned; upgrades are deliberate (build with ALLOW_UNPINNED_QUARTO=1,
# run the smoketest, eyeball a page, move the pin). The pin is the one zotQDA,
# qdaR and qdaPy use, so all four ecosystem sites render on the same Quarto.
PINNED="1.10.18"
ACTUAL="$(quarto --version)"
if [ "$ACTUAL" != "$PINNED" ] && [ -z "$ALLOW_UNPINNED_QUARTO" ]; then
  echo "docs/build.sh: quarto is $ACTUAL, pinned is $PINNED" >&2
  exit 1
fi

# gen_langmap and make_pdf need PyYAML; any python3 that has it will do. The
# qdaPy docs venv has it and is the ecosystem's usual local answer; CI installs
# pyyaml into the runner's python instead.
GEN_PY="${GEN_PY:-$HOME/.venvs/qdapy-docs/bin/python}"
command -v "$GEN_PY" >/dev/null 2>&1 || GEN_PY=python3

# The vendored theme lives once, in _theme/; each language project gets a
# disposable copy before the render, because Quarto resolves extensions and
# resources only inside a project directory. The plugin's own images are
# mirrored in the same way, so a page can refer to asset/ in either language.
for lang in en de; do
  rsync -a --delete _theme/_extensions/ "$lang/_extensions/"
  rsync -a --delete _theme/fonts/ "$lang/fonts/"
  rsync -a --delete ../asset/ "$lang/asset/"
done

"$GEN_PY" gen_langmap.py en de
quarto render en
quarto render de
python3 offline/postprocess.py ../site/en ../site/de

# The same pages once more as one linked PDF per language (Typst, Noto Sans
# embedded), reachable from the navbar's PDF icon.
"$GEN_PY" print/make_pdf.py en ../site/en/zotlook-documentation.pdf "fre.ms"
"$GEN_PY" print/make_pdf.py de ../site/de/zotLook-Dokumentation.pdf "fre.ms"
echo "Done: open ../site/en/index.html"
