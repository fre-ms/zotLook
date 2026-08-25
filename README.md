# zotLook

<img src="asset/zotlook-logo.svg" alt="" width="88" align="right">

[![CI](https://github.com/fre-ms/zotLook/actions/workflows/ci.yml/badge.svg)](https://github.com/fre-ms/zotLook/actions/workflows/ci.yml)
[![Zotero 7–10](https://img.shields.io/badge/Zotero-7%E2%80%9310-CC2936?logo=zotero&logoColor=white)](https://www.zotero.org)
![macOS | Linux | Windows](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)
[![Latest release](https://img.shields.io/github/v/release/fre-ms/zotLook)](https://github.com/fre-ms/zotLook/releases)
[![License](https://img.shields.io/github/license/fre-ms/zotLook)](LICENSE)

A plugin for Zotero 7 and later, in this form tested with Zotero 10, that previews
attachments when you press **Space**, the way a file manager does. It carries no
viewer of its own, but drives the preview panel the system already has:

- [**Quick Look**](https://en.wikipedia.org/wiki/Quick_Look) on **macOS**,
- [**GNOME Sushi**](https://gitlab.gnome.org/GNOME/sushi) on **Linux** and
- [**QuickLook**](https://github.com/QL-Win/QuickLook) on **Windows**.

📖 **[Documentation — zotlook.org](https://zotlook.org)** ·
[Deutsche Fassung](https://zotlook.org/latest/de/)

![zotLook screenshot](asset/screenshot.png)

## What it does

| Shortcut | |
|---|---|
| **Space** | Preview the selected item's attachment |
| **Shift+Space** | Preview its notes |
| **Ctrl+Shift+Space** | Contact sheet — every page of a PDF as a thumbnail |
| **Shift+Alt+Space** | The same sheet in a Zotero window |

- Anything the system's preview panel can show, plus **EPUB**, which zotLook
  renders itself because no system preview does.
- **Zotero's annotations are drawn in.** Zotero keeps them in its database
  rather than in the file, so a preview of the stored PDF would otherwise be
  unmarked.
- **Clicking a page of the contact sheet** opens it in Zotero's reader at that
  page.
- Synced files that are not downloaded locally are fetched first.
- Shortcuts, which attachment wins, the grid and the page limit are all
  configurable under **Settings → zotLook**. English and German.

## Requirements

- **Zotero 7** or later
- **macOS 12** or later — nothing else to install
- or **Linux** with GNOME Sushi (`apt install gnome-sushi`)
- or **Windows** with [QuickLook](https://github.com/QL-Win/QuickLook) running

## Install

Download the latest `.xpi` from
[Releases](https://github.com/fre-ms/zotLook/releases), then in Zotero:
**Tools → Add-ons →** gear icon **→ Install Add-on From File…**

Zotero checks this repository for new versions and updates the plugin itself
from then on.

## Build

```bash
./build.sh                  # a release build needs macOS with the Xcode CLT
npm install && npm test
```

The build script also runs on Linux, where there is no Swift toolchain for the
Quick Look helper; it then packages everything else and leaves `update.json`
alone.

How all of it works — driving each system's preview, the EPUB conversion, the
contact sheet renderer, the test suite and the release process — is in the
[developer guide](https://zotlook.org/latest/en/dev/architecture.html).

## Provenance

**zotLook is a fork of
[gchapron/Zotero7QuickLook](https://github.com/gchapron/Zotero7QuickLook) by
Guillaume Chapron**, from whom the code and the MIT licence come. Roughly half
of his JavaScript survives verbatim, and the architecture is his throughout.

Further back stands
[mronkko/ZoteroQuickLook](https://github.com/mronkko/ZoteroQuickLook) by Mikko
Rönkkö, which brought Quick Look to Zotero 4–6 and gave this line of plugins its
purpose and its name. **The debt to it is one of idea, not of code** — of 206
substantive lines in the original, exactly one also appears here, and it is a
Zotero API call any such plugin must write.

The full accounting, with the measurements behind those numbers, is under
[Origins](https://zotlook.org/latest/en/origins.html).

The plugin ID is `zotlook@fre.ms`, distinct from Chapron's, so the two install
side by side rather than over one another.

## Licence

MIT — see [LICENSE](LICENSE).
