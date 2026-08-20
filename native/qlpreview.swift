#!/usr/bin/env swift

// Opens macOS' real Quick Look panel for one or more files.
//
// This exists because `qlmanage -p`, the command-line tool, is a debugging aid
// rather than the preview the Finder shows, and it cannot display every type.
// On a video it dies outright:
//
//     NSInternalInconsistencyException
//     'Setting highlightedTimeRanges is not supported in your app.'
//     AVKitCore -[AVPlayerItem setHighlightedTimeRanges:]
//     Movie     (/System/Library/QuickLook/Movie.qlgenerator)
//
// Apple's own movie generator calls an AVKit method that AVKit refuses inside
// qlmanage. QLPreviewPanel is what the Finder itself drives, so it renders the
// same things the Finder renders, including third-party Quick Look extensions.
//
// The panel closes on Space or Escape, at which point this process exits, and
// it exits on SIGTERM so the plugin can dismiss the preview from Zotero.
//
// Usage: qlpreview <file> [file…]

import Cocoa
import QuickLookUI

final class PreviewSource: NSObject, QLPreviewPanelDataSource {
    private let urls: [URL]

    init(urls: [URL]) {
        self.urls = urls
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        urls.count
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        urls[index] as NSURL
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let source: PreviewSource

    init(source: PreviewSource) {
        self.source = source
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let panel = QLPreviewPanel.shared() else {
            fputs("Error: Quick Look panel unavailable\n", stderr)
            exit(1)
        }
        panel.dataSource = source
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Closing the panel is the user dismissing the preview
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: panel,
            queue: .main
        ) { _ in NSApp.terminate(nil) }
    }
}

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
    fputs("Usage: qlpreview <file> [file…]\n", stderr)
    exit(1)
}

let urls = paths.map { URL(fileURLWithPath: $0) }
for url in urls where !FileManager.default.fileExists(atPath: url.path) {
    fputs("Error: no such file: \(url.path)\n", stderr)
    exit(1)
}

let app = NSApplication.shared
// No Dock icon: this is a preview, not an application the user switches to
app.setActivationPolicy(.accessory)
let delegate = AppDelegate(source: PreviewSource(urls: urls))
app.delegate = delegate
app.run()
