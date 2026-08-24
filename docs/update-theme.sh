#!/bin/sh
# Pull the current zotqda-quarto-theme into this repository. The theme is
# vendored — the single copy of _extensions/ and fonts/ lives in docs/_theme/,
# offline/ and print/ beside it — so the documentation builds without a sibling
# checkout, which is what CI has. build.sh mirrors _theme/ into the language
# projects. Run this after changing the theme, then rebuild and commit.
set -e
cd "$(dirname "$0")"
THEME="../../zotqda-quarto-theme"
test -d "$THEME/_extensions" || {
  echo "update-theme.sh: $THEME not found beside this checkout" >&2; exit 1; }

rm -rf _theme/_extensions _theme/fonts offline print
mkdir -p _theme
cp -R "$THEME/_extensions" _theme/_extensions
cp -R "$THEME/fonts" _theme/fonts
cp -R "$THEME/offline" offline
cp -R "$THEME/print" print
cp "$THEME/scripts/gen_langmap.py" gen_langmap.py
echo "theme, fonts, offline scripts and gen_langmap updated from $THEME"
