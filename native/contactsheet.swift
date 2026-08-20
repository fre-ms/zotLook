#!/usr/bin/env swift

// Contact sheet generator for PDF files.
//
// Renders pages as JPEG thumbnails into a sibling directory and writes an HTML
// grid referencing them, which QuickLook can scroll.
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
// Usage: contactsheet <input.pdf> <output.html> [columns] [max_pages] [link_base]
//
// With link_base given, each thumbnail is wrapped in a link to
// <link_base>?page=N. QuickLook itself ignores such links — it renders
// previews with JavaScript disabled and does not hand clicks to the system —
// but it offers to open an HTML preview in the browser, and there they work,
// as they do in Zotero's own viewer window. They are styled to look like
// nothing, so they cost nothing where they are inert.

import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import Dispatch

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: contactsheet <input.pdf> <output.html> [columns] [max_pages] [link_base]\n", stderr)
    exit(1)
}

let inputPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let maxColumns = max(1, CommandLine.arguments.count > 3 ? Int(CommandLine.arguments[3]) ?? 5 : 5)
// 0 means no limit. A cap keeps a pathological document from filling the disk.
let maxPages = CommandLine.arguments.count > 4 ? Int(CommandLine.arguments[4]) ?? 0 : 0
// Empty means the thumbnails are not clickable
let linkBase = CommandLine.arguments.count > 5 ? CommandLine.arguments[5] : ""

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

// Adapt columns to page count so few-page PDFs fill the width
let columns = min(renderCount, maxColumns)
// Fewer columns means each thumbnail is displayed larger, so it needs more pixels
let renderWidth = 500 * maxColumns / columns

// Images live beside the HTML, in a directory named after it
let outputURL = URL(fileURLWithPath: outputPath)
let imageDirName = outputURL.deletingPathExtension().lastPathComponent + "_pages"
let imageDir = outputURL.deletingLastPathComponent().appendingPathComponent(imageDirName)

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

var html = """
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Contact Sheet</title>
<style>
body {
    background: #f0f0f0;
    margin: 0;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
.grid {
    display: grid;
    grid-template-columns: repeat(\(columns), 1fr);
    gap: 12px;
}
.page {
    background: white;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    text-align: center;
    overflow: hidden;
}
.page img {
    width: 100%;
    height: auto;
    display: block;
}
.page a {
    text-decoration: none;
    color: inherit;
    display: block;
}
.page .label {
    font-size: 11px;
    color: #666;
    padding: 4px 0;
}
.notice {
    font-size: 13px;
    color: #666;
    text-align: center;
    padding: 12px 0 0 0;
}
</style>
</head>
<body>
<div class="grid">

"""

for i in 1...renderCount {
    guard let height = heights[i] else { continue }
    // width/height reserve the box before the image arrives, so lazy loading
    // does not make the grid jump while scrolling
    let thumb = """
    <img src="\(imageDirName)/p\(i).jpg" loading="lazy" width="\(renderWidth)" height="\(height)">
    <div class="label">\(i)</div>
    """
    let body = linkBase.isEmpty
        ? thumb
        : "<a href=\"\(linkBase)?page=\(i)\">\(thumb)</a>"
    html += """
    <div class="page">
    \(body)
    </div>\n
    """
}

html += "</div>\n"

if renderCount < pageCount {
    html += """
    <p class="notice">Showing the first \(renderCount) of \(pageCount) pages.</p>\n
    """
}

html += """
</body>
</html>
"""

do {
    try html.write(toFile: outputPath, atomically: true, encoding: .utf8)
} catch {
    fputs("Error: Cannot write output: \(error)\n", stderr)
    exit(1)
}
