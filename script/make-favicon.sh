#!/bin/sh
# Rebuild doc-root/favicon.ico from the plugin's own icons.
#
# Every page of the site declares an SVG icon, which is what a current
# browser uses. The .ico exists for everything that does not ask: feed
# readers, link-preview services and older browsers request /favicon.ico
# from the site root and take nothing else.
#
# The sizes are not scaled from one drawing. The plugin ships icons drawn
# separately at 24, 32, 48 and 96 because the detail that works at one size
# turns to grey at another, so 32 and 48 are rendered from their own file.
# Only 16 has no drawing of its own; it comes from the 32 px one, which
# halves cleanly — every tile of the 4x4 grid lands on whole pixels.
#
# Needs librsvg and ImageMagick, which CI does not have; hence the result is
# committed and this script is how it is reproduced.
#   brew install librsvg imagemagick
set -e
cd "$(dirname "$0")/.."
command -v rsvg-convert >/dev/null || { echo "rsvg-convert missing" >&2; exit 1; }
command -v magick       >/dev/null || { echo "magick missing" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rsvg-convert -w 16 -h 16 addon/icon/zotlook-32.svg -o "$TMP/16.png"
rsvg-convert -w 32 -h 32 addon/icon/zotlook-32.svg -o "$TMP/32.png"
rsvg-convert -w 48 -h 48 addon/icon/zotlook-48.svg -o "$TMP/48.png"
magick "$TMP/16.png" "$TMP/32.png" "$TMP/48.png" doc-root/favicon.ico
echo "doc-root/favicon.ico: $(magick identify doc-root/favicon.ico | wc -l | tr -d ' ') sizes"
