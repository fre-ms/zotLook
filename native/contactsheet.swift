#!/usr/bin/env swift

// Page renderer for contact sheets.
//
// Renders pages as JPEG thumbnails into a directory and reports what it drew
// as JSON on stdout. The plugin assembles the HTML around it, in sheet.js,
// because a second renderer — pdf.js, for the platforms this binary cannot be
// built for — has to produce the very same sheet.
//
// Thumbnails are written as files rather than inlined as base64: a 300-page
// book inlined came to a 111 MB document, which QuickLook cannot display,
// whereas the same book here yields roughly 20 KB of HTML next to its images,
// and the images are decoded only as they scroll into view.
//
// Pages are drawn through PDFKit rather than CGContext.drawPDFPage, which
// renders only a page's content stream and silently omits its annotations —
// so a sheet of a PDF exported with Zotero's highlights showed none of them.
//
// Pages render concurrently. A PDF document handle is not thread-safe, so each
// worker opens its own on the same file; that took the 300-page book from 44 s
// to about 7 s on ten cores.
//
// Usage: contactsheet <input.pdf> <image_dir> <max_columns> [max_pages]
//
// Prints {"pageCount":N,"columns":N,"width":N,"pages":[{"page":N,"height":N}]}.
// The sizing rule is repeated in sheet.js, where the other renderer needs it;
// a test on macOS runs this binary and checks the two still agree.

import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import Dispatch

guard CommandLine.arguments.count >= 4 else {
    fputs("Usage: contactsheet <input.pdf> <image_dir> <max_columns> [max_pages]\n", stderr)
    exit(1)
}

let inputPath = CommandLine.arguments[1]
let imageDirPath = CommandLine.arguments[2]
let maxColumns = max(1, Int(CommandLine.arguments[3]) ?? 5)
// 0 means no limit. A cap keeps a pathological document from filling the disk.
let maxPages = CommandLine.arguments.count > 4 ? Int(CommandLine.arguments[4]) ?? 0 : 0

func openDocument() -> PDFDocument? {
    PDFDocument(url: URL(fileURLWithPath: inputPath))
}

guard let probe = openDocument() else {
    fputs("Error: Cannot open PDF: \(inputPath)\n", stderr)
    exit(1)
}

let pageCount = probe.pageCount
guard pageCount > 0 else {
    fputs("Error: PDF has no pages\n", stderr)
    exit(1)
}

let renderCount = maxPages > 0 ? min(pageCount, maxPages) : pageCount

// Adapt columns to page count so few-page PDFs fill the width, and give each
// thumbnail more pixels when fewer columns make it display larger
let columns = max(1, min(renderCount, maxColumns))
let renderWidth = Int((Double(500 * maxColumns) / Double(columns)).rounded())

let imageDir = URL(fileURLWithPath: imageDirPath)

let fm = FileManager.default
// Clear first: a previous run with a higher page cap would otherwise leave
// thumbnails behind that this sheet does not reference
try? fm.removeItem(at: imageDir)
do {
    try fm.createDirectory(at: imageDir, withIntermediateDirectories: true)
} catch {
    fputs("Error: Cannot create \(imageDir.path): \(error)\n", stderr)
    exit(1)
}

/// Rendered size of a page, honouring its crop box and /Rotate entry.
/// PDFKit applies the rotation when drawing, so only the extent has to be
/// swapped for a page turned a quarter round.
func displaySize(_ page: PDFPage, width: Int) -> (visible: CGSize, height: Int)? {
    let box = page.bounds(for: .cropBox)
    guard box.width > 0, box.height > 0 else { return nil }
    let quarterTurned = (abs(page.rotation) % 180) == 90
    let visible = CGSize(width: quarterTurned ? box.height : box.width,
                         height: quarterTurned ? box.width : box.height)
    let scale = CGFloat(width) / visible.width
    return (visible, max(1, Int((visible.height * scale).rounded())))
}

let workers = min(ProcessInfo.processInfo.activeProcessorCount, renderCount)
var documents: [PDFDocument] = []
for _ in 0..<workers {
    guard let doc = openDocument() else {
        fputs("Error: Cannot reopen PDF for concurrent rendering\n", stderr)
        exit(1)
    }
    documents.append(doc)
}

// Page number -> rendered pixel height, so the HTML can reserve the right box
// before the image loads
var heights = [Int: Int]()
let lock = NSLock()

DispatchQueue.concurrentPerform(iterations: workers) { worker in
    let document = documents[worker]
    var pageNum = worker + 1
    while pageNum <= renderCount {
        defer { pageNum += workers }

        guard let page = document.page(at: pageNum - 1),
              let (visible, height) = displaySize(page, width: renderWidth) else { continue }

        guard let ctx = CGContext(
            data: nil,
            width: renderWidth,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { continue }

        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: renderWidth, height: height))

        // PDFPage.draw renders the page together with its annotations and
        // applies the page rotation, so only the scale has to be set up here.
        ctx.scaleBy(x: CGFloat(renderWidth) / visible.width,
                    y: CGFloat(height) / visible.height)
        page.draw(with: .cropBox, to: ctx)

        guard let image = ctx.makeImage() else { continue }

        let url = imageDir.appendingPathComponent("p\(pageNum).jpg") as CFURL
        guard let dest = CGImageDestinationCreateWithURL(
            url, "public.jpeg" as CFString, 1, nil) else { continue }
        CGImageDestinationAddImage(
            dest, image,
            [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { continue }

        lock.lock()
        heights[pageNum] = height
        lock.unlock()
    }
}

guard !heights.isEmpty else {
    fputs("Error: No pages could be rendered\n", stderr)
    exit(1)
}

// The plugin builds the sheet around these; see sheet.js
var entries: [String] = []
for i in 1...renderCount {
    guard let height = heights[i] else { continue }
    entries.append("{\"page\":\(i),\"height\":\(height)}")
}
print("{\"pageCount\":\(pageCount),\"columns\":\(columns)," +
      "\"width\":\(renderWidth),\"pages\":[\(entries.joined(separator: ","))]}")
