#!/bin/sh
# Pull the current zotqda-quarto-theme into this repository. The theme is
# vendored — the single copy of _extensions/ and fonts/ lives in
# doc/_theme/, offline/ and print/ beside it, and gen_langmap.py in doc/ —
# so the documentation builds without a sibling checkout (CI). build.sh
# mirrors _theme/ into the language projects. Run this after changing the
# theme, then rebuild and commit.
#
# The theme source is, in order of preference:
#   1. $ZOTQDA_THEME, if set;
#   2. a sibling checkout ../../zotqda-quarto-theme (the dev layout);
#   3. otherwise it is cloned from GitHub into ../../zotqda-quarto-theme.
# When the source is a clean git checkout, it is fast-forwarded to the
# published tip first, so a re-run vendors the current release; a checkout
# with local changes is used as-is (uncommitted theme work is preserved).
set -e
cd "$(dirname "$0")"

REPO="https://github.com/fre-ms/zotqda-quarto-theme.git"
THEME="${ZOTQDA_THEME:-../../zotqda-quarto-theme}"

if [ ! -d "$THEME/_extensions" ]; then
  if [ -n "$ZOTQDA_THEME" ]; then
    echo "update-theme.sh: \$ZOTQDA_THEME=$ZOTQDA_THEME has no _extensions/" >&2
    exit 1
  fi
  echo "update-theme.sh: no theme beside this checkout — cloning $REPO"
  git clone --depth 1 "$REPO" "$THEME"
fi

# Fast-forward a clean checkout to the published tip so a re-run vendors
# the current release; leave a tree with local changes untouched.
if [ -d "$THEME/.git" ]; then
  if [ -z "$(git -C "$THEME" status --porcelain)" ]; then
    git -C "$THEME" fetch --quiet origin 2>/dev/null || true
    git -C "$THEME" merge --ff-only --quiet '@{u}' 2>/dev/null || true
  else
    echo "update-theme.sh: $THEME has local changes — vendoring as-is" >&2
  fi
fi

rm -rf _theme/_extensions _theme/fonts offline print
mkdir -p _theme
cp -R "$THEME/_extensions" _theme/_extensions
cp -R "$THEME/fonts" _theme/fonts
cp -R "$THEME/offline" offline
cp -R "$THEME/print" print
cp "$THEME/script/gen_langmap.py" gen_langmap.py

rev=$(git -C "$THEME" rev-parse --short HEAD 2>/dev/null || echo unknown)
echo "theme vendored from $THEME @ $rev" \
     "(extensions, fonts, offline, print, gen_langmap)"
