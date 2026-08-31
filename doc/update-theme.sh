#!/bin/sh
# Pull the current easyQDA-quarto-theme into this repository. The theme is
# vendored — the single copy of _extensions/ and font/ lives in
# doc/_theme/, offline/ and print/ beside it, and gen_langmap.py in doc/ —
# so the documentation builds without a sibling checkout (CI). build.sh
# mirrors _theme/ into the language projects. Run this after changing the
# theme, then rebuild and commit.
#
# The theme source is, in order of preference:
#   1. $EASYQDA_THEME, if set;
#   2. a sibling checkout ../../easyQDA-quarto-theme (the dev layout);
#   3. otherwise it is cloned from GitHub into ../../easyQDA-quarto-theme.
# The theme was renamed twice on its way here — the repository from
# zotqda-quarto-theme, the extension from zotqda-theme to easyqda-theme, and
# its font directory from fonts/ to font/ — so an old checkout beside this
# one will not do; the names below are the current ones. This repository
# follows the theme's names rather than translating them, so the copy is
# one-to-one and the next rename shows up here as a missing directory
# instead of quietly landing under the old name.
# When the source is a clean git checkout, it is fast-forwarded to the
# published tip first, so a re-run vendors the current release; a checkout
# with local changes is used as-is (uncommitted theme work is preserved).
set -e
cd "$(dirname "$0")"

REPO="https://github.com/easyqda/easyQDA-quarto-theme.git"
THEME="${EASYQDA_THEME:-../../easyQDA-quarto-theme}"

if [ ! -d "$THEME/_extensions" ]; then
  if [ -n "$EASYQDA_THEME" ]; then
    echo "update-theme.sh: \$EASYQDA_THEME=$EASYQDA_THEME has no _extensions/" >&2
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

# Mirrored rather than removed and re-copied, and for one macOS reason:
# deleting a tracked file through the Finder leaves a zero-byte tombstone
# named "<file> \016.gitFinderDeleted" that its own owner may not open or
# remove, and that is recreated as fast as it is moved aside. `rm -rf` then
# fails on the directory holding one and takes the whole vendoring down with
# it, and `cp -R` onto a directory that therefore still exists nests a copy
# inside it — which is how doc/offline/offline/ came about once.
#
# rsync has neither failure mode: the excluded tombstones are also protected
# from --delete, so what is left behind is exactly them, and they are
# harmless — build.sh excludes the same pattern when it mirrors the theme
# into the language projects, and .gitignore keeps them out of the
# repository.
mkdir -p _theme
for pair in "_extensions:_theme/_extensions" "font:_theme/font" \
            "offline:offline" "print:print"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  if [ ! -d "$THEME/$src" ]; then
    echo "update-theme.sh: $THEME has no $src/" >&2
    exit 1
  fi
  mkdir -p "$dst"
  rsync -a --delete --exclude '*.gitFinderDeleted' "$THEME/$src/" "$dst/"
done

cp "$THEME/script/gen_langmap.py" gen_langmap.py

rev=$(git -C "$THEME" rev-parse --short HEAD 2>/dev/null || echo unknown)
echo "theme vendored from $THEME @ $rev" \
     "(extensions, font, offline, print, gen_langmap)"
