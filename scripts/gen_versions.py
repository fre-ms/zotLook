#!/usr/bin/env python3
"""Keep versions.json in step with the version the package actually reports.

Published documentation lives under a directory per release, and versions.json
is the list a reader's version switcher works from.  Maintaining it by hand is
the kind of thing that silently falls behind, so this reads the one place the
version already lives and refuses to guess at anything else.

Adding a version is a change to a committed file, which is deliberate: a
release that quietly appeared in the switcher and nowhere else would be hard
to account for later.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

HERE = pathlib.Path.cwd()
FILE = HERE / "versions.json"


def current_version() -> str:
    """The version this repository reports, from wherever it keeps it."""
    manifest = HERE / "manifest.json"
    if manifest.exists():                                    # zotQDA
        return str(json.loads(manifest.read_text())["version"])

    addon = HERE / "addon" / "manifest.json"
    if addon.exists():                                       # zotLook
        return str(json.loads(addon.read_text())["version"])

    py = HERE / "src" / "qdapy" / "_version.py"
    if py.exists():                                          # qdaPy
        m = re.search(r'__version__\s*=\s*"([^"]+)"', py.read_text())
        if m:
            return m.group(1)

    desc = HERE / "DESCRIPTION"
    if desc.exists():                                        # qdaR
        m = re.search(r"^Version:\s*(\S+)", desc.read_text(), re.M)
        if m:
            return m.group(1)

    sys.exit("no version found: expected manifest.json, src/qdapy/_version.py "
             "or DESCRIPTION in the working directory")


def sort_key(version: str) -> tuple:
    """Newest first, numerically - so 0.10.0 sorts above 0.9.0."""
    return tuple(int(p) if p.isdigit() else -1
                 for p in re.split(r"[.\-+]", version))


def main() -> int:
    version = current_version()
    if "--current" in sys.argv:
        # The deploy asks here rather than reading versions.json, so that
        # rebuilding an older release's documentation puts it in that
        # release's directory instead of the newest one.
        print(version)
        return 0
    data = json.loads(FILE.read_text()) if FILE.exists() else {"versions": []}
    versions = set(data.get("versions", []))

    added = version not in versions
    versions.add(version)
    ordered = sorted(versions, key=sort_key, reverse=True)

    out = {"latest": ordered[0], "versions": ordered}
    FILE.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")

    if out["latest"] != version:
        print(f"warning: {version} is not the newest in versions.json "
              f"(that is {out['latest']}); deploying it will not move 'latest'",
              file=sys.stderr)
    print(f"versions.json: {len(ordered)} versions, latest {out['latest']}"
          + (f", added {version}" if added else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
