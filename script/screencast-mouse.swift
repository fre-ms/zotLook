// The hand on the mouse for script/screencast-macos.applescript.
//
// AppleScript can press keys through System Events but cannot move the
// pointer, and a demo wants the pointer seen travelling, not jumping. So
// this posts the movement itself: an eased glide of small steps to the
// target, then, on request, a click, a right click, or a scroll of the
// wheel. Everything goes in at the HID level, so the overlay tools that
// draw the pointer and the clicks see it as they would see a hand.
//
//   screencast-mouse move X Y [ms]        glide to X Y in ms (default 400)
//   screencast-mouse click X Y [ms]       glide, then click
//   screencast-mouse rclick X Y [ms]      glide, then right click
//   screencast-mouse scroll X Y POINTS    glide, then turn the wheel by
//                                         POINTS; negative scrolls up
//
// Coordinates are in points, origin top left of the main display.
// Build: swiftc -O screencast-mouse.swift -o screencast-mouse

import Foundation
import CoreGraphics

func now() -> CGPoint { return CGEvent(source: nil)?.location ?? .zero }

func post(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton = .left) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p,
            mouseButton: button)?.post(tap: .cghidEventTap)
}

func glide(to target: CGPoint, ms: Int) {
    let start = now()
    let steps = max(8, ms / 16)
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let s = t * t * (3 - 2 * t)                       // ease in and out
        post(.mouseMoved, CGPoint(x: start.x + (target.x - start.x) * s,
                                  y: start.y + (target.y - start.y) * s))
        usleep(useconds_t(ms * 1000 / steps))
    }
    post(.mouseMoved, target)
}

func click(_ p: CGPoint, right: Bool) {
    usleep(150_000)
    post(right ? .rightMouseDown : .leftMouseDown, p, right ? .right : .left)
    usleep(80_000)
    post(right ? .rightMouseUp : .leftMouseUp, p, right ? .right : .left)
}

func scroll(points: Int) {
    // In small pixel steps, spaced so that the view is seen to travel
    // rather than to jump
    let step = 20
    var left = abs(points)
    guard left > 0 else { return }
    while left > 0 {
        let now = min(step, left)
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                wheel1: Int32(points > 0 ? -now : now), wheel2: 0, wheel3: 0)?
            .post(tap: .cghidEventTap)
        left -= now
        usleep(16_000)
    }
}

let a = CommandLine.arguments
guard a.count >= 4, let x = Double(a[2]), let y = Double(a[3]) else {
    FileHandle.standardError.write("usage: screencast-mouse move|click|rclick|scroll X Y [ms|lines]\n".data(using: .utf8)!)
    exit(2)
}
let p = CGPoint(x: x, y: y)
switch a[1] {
case "move":
    glide(to: p, ms: a.count >= 5 ? Int(a[4]) ?? 400 : 400)
case "click":
    glide(to: p, ms: a.count >= 5 ? Int(a[4]) ?? 400 : 400)
    click(p, right: false)
case "rclick":
    glide(to: p, ms: a.count >= 5 ? Int(a[4]) ?? 400 : 400)
    click(p, right: true)
case "scroll":
    glide(to: p, ms: 300)
    usleep(100_000)
    scroll(points: a.count >= 5 ? Int(a[4]) ?? 300 : 300)
default:
    FileHandle.standardError.write("unknown verb \(a[1])\n".data(using: .utf8)!)
    exit(2)
}
