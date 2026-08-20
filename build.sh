#!/bin/bash
# Builds the XPI and regenerates update.json to match it.
#
# Run this for every release, then commit update.json and attach the XPI to a
# GitHub release tagged v<version>. Deriving the version, the download URL and
# the checksum from the manifest and the built file keeps update.json from
# drifting out of sync with what is actually published.
#
# Layout: addon/ is copied verbatim and becomes the root of the XPI, which is
# where Zotero expects manifest.json, bootstrap.js and locale/. native/ holds
# source that is compiled rather than shipped. The XPI lands in build/, which
# is ignored by git; update.json stays at the repository root because that is
# the URL installed copies poll.
set -euo pipefail
cd "$(dirname "$0")"

REPO="fre-ms/zotLook"
# One line on purpose: pyenv-win's shims relay arguments through cmd batch
# files, which cannot carry embedded newlines — a multi-line -c program comes
# out empty there, and an empty version would name the package zotlook-.xpi.
read -r VERSION ID MIN <<<"$(python3 -c 'import json; z = json.load(open("addon/manifest.json")); a = z["applications"]["zotero"]; print(z["version"], a["id"], a["strict_min_version"])')"
if [ -z "${VERSION}" ] || [ -z "${ID}" ] || [ -z "${MIN}" ]; then
  echo "Could not read version, id and strict_min_version from addon/manifest.json" >&2
  exit 1
fi
# The bare filename is the release asset name and goes into update.json;
# XPI is where it is written locally.
XPI_NAME="zotlook-${VERSION}.xpi"
XPI="build/${XPI_NAME}"

build_binary() {
  local name="$1"
  echo "Building ${name} (universal)…"
  swiftc -O -target arm64-apple-macosx12.0 -o "addon/${name}-arm64" "native/${name}.swift"
  swiftc -O -target x86_64-apple-macosx12.0 -o "addon/${name}-x86_64" "native/${name}.swift"
  lipo -create "addon/${name}-arm64" "addon/${name}-x86_64" -output "addon/${name}"
  rm -f "addon/${name}-arm64" "addon/${name}-x86_64"
  # swiftc ad-hoc signs the arm64 slice but not the x86_64 one, and lipo does
  # not sign the container, so without this the result reports as unsigned.
  codesign -s - -f "addon/${name}"
}

# The Quick Look helper is macOS-only, and so is the toolchain that produces
# it. Everywhere else the XPI is still worth building — the plugin runs on
# Linux through Sushi, and its code is what a Linux user needs to test — but
# it comes out without that helper, so it is not a package to release.
RELEASABLE=1
if [ "$(uname -s)" = "Darwin" ] && command -v swiftc >/dev/null; then
  for binary in qlpreview; do
    build_binary "$binary"
  done
else
  RELEASABLE=0
  echo "No Swift toolchain on $(uname -s): building without the qlpreview helper."
  echo "The result runs on Linux; on macOS it falls back to qlmanage."
  rm -f addon/qlpreview
fi

# Fedora and Debian ship shasum with perl, but it is not everywhere; coreutils
# is.
sha256() {
  if command -v shasum >/dev/null; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

echo "Packaging ${XPI}…"
mkdir -p build
rm -f "$XPI"
( cd addon && zip -q -r "../${XPI}" . -x '*.DS_Store' )
rm -f addon/qlpreview

SHA=$(sha256 "$XPI")

if [ "$RELEASABLE" = 0 ]; then
  echo
  echo "Built  ${XPI}  (sha256:${SHA})"
  echo "Install it with Zotero's Add-ons → Install Add-on From File."
  echo "update.json is left alone: it must describe a package built on macOS,"
  echo "or installed copies would auto-update to one without Quick Look."
  exit 0
fi

echo "Writing update.json…"
# strict_max_version is deliberately omitted: Zotero then treats the update as
# compatible with any version, and can lift the ceiling of an already-installed
# copy. The installed manifest still gates which Zotero will run the plugin.
cat > update.json <<JSON
{
  "addons": {
    "${ID}": {
      "updates": [
        {
          "version": "${VERSION}",
          "update_link": "https://github.com/${REPO}/releases/download/v${VERSION}/${XPI_NAME}",
          "update_hash": "sha256:${SHA}",
          "applications": {
            "zotero": {
              "strict_min_version": "${MIN}"
            }
          }
        }
      ]
    }
  }
}
JSON

echo
echo "Built  ${XPI}  (sha256:${SHA})"
echo "Next:  git add update.json && git commit"
echo "       gh release create v${VERSION} ${XPI}"
