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
//   screencast-mouse key CODE [MODS]      press the key with the virtual
//                                         key code, holding MODS, a comma-
//                                         separated list out of cmd, ctrl,
//                                         alt, shift
//   screencast-mouse type TEXT            type the text, key by key
//
// The keys go in at the HID level as the mouse does — which is what lets
// a key-display tool see them: the same tools ignore what System Events
// sends, and a scripted keystroke would otherwise never show in the film.
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

// A click as a mouse makes it: the down and the up carry a click count of
// one, as a real button does. Without it a key-display tool took the
// events for the start of a drag and showed no key after them
func click(_ p: CGPoint, right: Bool) {
    usleep(150_000)
    for down in [true, false] {
        let type: CGEventType = right ? (down ? .rightMouseDown : .rightMouseUp) : (down ? .leftMouseDown : .leftMouseUp)
        let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: right ? .right : .left)
        e?.setIntegerValueField(.mouseEventClickState, value: 1)
        e?.setDoubleValueField(.mouseEventPressure, value: down ? 1 : 0)
        e?.post(tap: .cghidEventTap)
        if down { usleep(80_000) }
    }
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

func flags(_ spec: String) -> CGEventFlags {
    var f = CGEventFlags()
    for m in spec.split(separator: ",") {
        switch m {
        case "cmd": f.insert(.maskCommand)
        case "ctrl": f.insert(.maskControl)
        case "alt": f.insert(.maskAlternate)
        case "shift": f.insert(.maskShift)
        default: break
        }
    }
    return f
}

// The modifiers go down one by one before the key and come up after it,
// as fingers do, so that a tool watching the keys sees the chord build
let modifierCodes: [(CGEventFlags, CGKeyCode)] = [
    (.maskControl, 59), (.maskAlternate, 58), (.maskShift, 56), (.maskCommand, 55),
]

func key(_ code: CGKeyCode, _ f: CGEventFlags) {
    var held = CGEventFlags()
    for (flag, mcode) in modifierCodes where f.contains(flag) {
        held.insert(flag)
        let down = CGEvent(keyboardEventSource: nil, virtualKey: mcode, keyDown: true)
        down?.flags = held
        down?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    down?.flags = held
    down?.post(tap: .cghidEventTap)
    usleep(70_000)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    up?.flags = held
    up?.post(tap: .cghidEventTap)
    for (flag, mcode) in modifierCodes.reversed() where f.contains(flag) {
        usleep(40_000)
        held.remove(flag)
        let mup = CGEvent(keyboardEventSource: nil, virtualKey: mcode, keyDown: false)
        mup?.flags = held
        mup?.post(tap: .cghidEventTap)
    }
}

// The key a character sits on, in the US and the German layout alike for
// letters and digits; a capital takes Shift. Enough for a search word and
// a page number
let keyOf: [Character: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    " ": 49, "-": 27, "=": 24,
]

// A plus on the US layout is Shift and the equals key
func typeText(_ text: String) {
    // On a German keyboard y and z trade places, and the hyphen sits on
    // the key US calls slash; the layout is asked so that the character
    // typed is the character meant
    let german = (ProcessInfo.processInfo.environment["SCREENCAST_LAYOUT"] ?? "") == "de"
    for ch in text {
        let lower = Character(ch.lowercased())
        var code = keyOf[lower]
        if german {
            if lower == "y" { code = 6 } else if lower == "z" { code = 16 } else if lower == "-" { code = 44 } else if lower == "+" { code = 30 }
        }
        if !german && lower == "+" { code = 24 }
        guard let c = code else { continue }
        let shifted = ch.isUppercase || (!german && lower == "+")
        key(c, shifted ? .maskShift : CGEventFlags())
        usleep(90_000)
    }
}

let a = CommandLine.arguments
if a.count >= 3, a[1] == "key", let code = UInt16(a[2]) {
    key(CGKeyCode(code), a.count >= 4 ? flags(a[3]) : CGEventFlags())
    exit(0)
}
if a.count >= 3, a[1] == "type" {
    typeText(a[2])
    exit(0)
}
guard a.count >= 4, let x = Double(a[2]), let y = Double(a[3]) else {
    FileHandle.standardError.write("usage: screencast-mouse move|click|rclick|scroll X Y [ms|lines] | key CODE [MODS] | type TEXT\n".data(using: .utf8)!)
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
