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
read -r VERSION ID MIN <<<"$(python3 -c '
import json
z = json.load(open("addon/manifest.json"))
a = z["applications"]["zotero"]
print(z["version"], a["id"], a["strict_min_version"])')"
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

for binary in qlpreview; do
  build_binary "$binary"
done

echo "Packaging ${XPI}…"
mkdir -p build
rm -f "$XPI"
( cd addon && zip -q -r "../${XPI}" . -x '*.DS_Store' )
rm -f addon/qlpreview

SHA=$(shasum -a 256 "$XPI" | cut -d' ' -f1)

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
