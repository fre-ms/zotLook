# The screencast of the contact sheet, Windows take.
#
# The Windows counterpart of script/screencast-macos.applescript: it drives
# Zotero through the sequence the screenplay lays down — the same on every
# platform — and records it in two takes, one for the mouse and one for the
# keyboard, each as the whole Zotero window. The cut, the title cards and the
# key chips are made afterwards by script/screencast-post.py from the
# timeline this script writes beside each take.
#
# Where AppleScript has System Events, this has Win32 through .NET: windows
# are found with EnumWindows, placed with SetWindowPos, and the keyboard and
# the mouse are put in with SendInput — a glide of small eased steps to the
# target, then the click, so that the pointer is seen travelling. Recording is
# ffmpeg's gdigrab on the window's rectangle, with the pointer drawn in;
# it is stopped with a "q" on its stdin, which closes the file properly.
#
# Everything is measured in physical pixels: the script makes itself
# per-monitor-DPI-aware first, so that a 125 % display does not scale the
# rectangles it reads or the points it clicks, and gdigrab captures physical
# pixels anyway. Zotero itself runs at one CSS pixel per device pixel for
# the take (layout.css.devPixelsPerPx = "1.0" in prefs.js, entered while
# Zotero is closed): its viewer window will not go below 1000 × 700 CSS
# pixels, which at 125 % is more than the 1400 × 860 sheet window has room
# for — the corner buttons then sit below the visible edge — and at 100 %
# every size is the same as in the macOS take's points.
#
#   powershell -ExecutionPolicy Bypass -File script/screencast-windows.ps1 `
#       [-Out build\screencast] [-Lang de|en] [-Stage all|prepare|probe|mouse|keyboard|none]
#
# -Stage probe runs the warm-up only and leaves screenshots of the main
# window, the sheet window and each of its menus in -Out, with their
# rectangles, for measuring the offsets below on a new machine; -Stage none
# only defines the functions, for dot-sourcing the script and trying the
# steps one at a time.
#
# Wants: Zotero running in the language of the take, with zotLook from the
# tree or the freshly built XPI, the sheet window shortcut at Ctrl+Alt+Space,
# four columns; the collection "zotLook" holding "zotLook Dokumentation"
# with the German documentation PDF and its three annotations; ffmpeg with
# gdigrab and libx264. Keystro running: it sees the sent input and draws
# the keys into its bar at the bottom of the screen and a ring around the
# pointer at each click, so the cut runs with --no-chips. During the
# roughly four minutes the mouse and the keyboard are not yours.

param(
    [string]$Out = "",
    [ValidateSet("de", "en")][string]$Lang = "de",
    [ValidateSet("all", "prepare", "probe", "mouse", "keyboard", "none")][string]$Stage = "all",
    [string]$Ffmpeg = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Out) { $Out = Join-Path $repo "build\screencast" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
if (-not $Ffmpeg) {
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { $Ffmpeg = $cmd.Source }
    else {
        $Ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
            Where-Object FullName -match "Gyan" | Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $Ffmpeg -or -not (Test-Path $Ffmpeg)) { throw "ffmpeg not found; pass -Ffmpeg" }

# ── the plan, in numbers ─────────────────────────────────────────────────

$collectionKey = "QLDZQ9F5"
# The rows of the two documentation items in the collection, as an offset
# from the main window's client origin; "zotLook Dokumentation" first,
# "zotLook Documentation" second. Measured with -Stage probe
$docsRow = @{ de = @(600, 219); en = @(600, 191) }   # third and second row of the list
$searchWord = @{ de = "Tasten"; en = "keys" }
$readerClose = @(400, 55)          # the reader tab's close button, main window
$readerSidebarToggle = @(23, 93)   # the reader toolbar's sidebar button, main window

# The main window is 1512 × 949 like the macOS take's, so that the cut's
# crop applies unchanged; it stands 204 px in from the left of the 1920 px
# screen and 47 px down, so that Keystro's key bar — the bottom 76 px of
# the screen above the taskbar, its keys centred — lies along the bottom
# of the frame, centred
$mainOrigin = @(204, 47)
$mainSize = @(1512, 949)
# The sheet window: the viewer remembers the place, zotLook the size
$sheetOrigin = @(260, 125)     # 56 px in and 78 px down from the main window's corner
$sheetSize = @(1400, 860)

# Positions inside the sheet window, relative to its top left, measured on
# that window with four columns. Filled in from -Stage probe
$btnContents = @(1340, 819)
$btnAnnotations = @(96, 819)
$searchField = @(1264, 104)
$entryWasEsKann = @(1150, 543)
$entryBlueAnnotation = @{ de = @(219, 718); en = @(219, 707) }
$linkSeite6 = @{ de = @(79, 718); en = @(79, 717) }
$tileAfterContents = @(873, 467)
$tileAfterAnnotation = @(527, 467)
$tileAfterSearch = @(527, 480)
$scrollTo14 = -14              # wheel notches, about 104 px each; negative scrolls down
$sheetTitles = @("Kontaktbogen", "Contact Sheet")

# ── Win32 ────────────────────────────────────────────────────────────────

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SC {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint flags, UIntPtr extra);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }

  public static void MouseTo(int x, int y) {
    int w = GetSystemMetrics(78), h = GetSystemMetrics(79);   // virtual screen
    int ox = GetSystemMetrics(76), oy = GetSystemMetrics(77);
    INPUT[] a = new INPUT[1];
    a[0].type = 0;
    a[0].u.mi.dx = (int)(((x - ox) * 65535L) / (w - 1));
    a[0].u.mi.dy = (int)(((y - oy) * 65535L) / (h - 1));
    a[0].u.mi.dwFlags = 0x0001 | 0x8000 | 0x4000;  // MOVE | ABSOLUTE | VIRTUALDESK
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void MouseButton(uint flags) {
    INPUT[] a = new INPUT[1]; a[0].type = 0; a[0].u.mi.dwFlags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Wheel(int delta) {
    INPUT[] a = new INPUT[1]; a[0].type = 0; a[0].u.mi.dwFlags = 0x0800; a[0].u.mi.mouseData = (uint)delta;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Key(ushort vk, bool up) {
    INPUT[] a = new INPUT[1]; a[0].type = 1; a[0].u.ki.wVk = vk; a[0].u.ki.dwFlags = up ? 2u : 0u;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScanW(char c);
  // A character as the key that types it on the current layout, with Shift
  // where the layout wants it — a real key event, which the key-display
  // tools see; a Unicode packet (KEYEVENTF_UNICODE) types just as well but
  // passes them by unseen. Characters the layout has no key for still go
  // as a packet.
  public static void Char(char c) {
    short r = VkKeyScanW(c);
    if (r == -1) {
      INPUT[] a = new INPUT[2];
      a[0].type = 1; a[0].u.ki.wScan = c; a[0].u.ki.dwFlags = 0x0004;
      a[1].type = 1; a[1].u.ki.wScan = c; a[1].u.ki.dwFlags = 0x0004 | 0x0002;
      SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
      return;
    }
    ushort vk = (ushort)(r & 0xFF); bool shift = (r & 0x100) != 0;
    if (shift) Key(0x10, false);
    Key(vk, false); System.Threading.Thread.Sleep(30); Key(vk, true);
    if (shift) Key(0x10, true);
  }
}
"@
[void][SC]::SetProcessDpiAwarenessContext([IntPtr](-4))   # per-monitor v2: physical pixels throughout
Add-Type -AssemblyName System.Drawing

$VK = @{ Space = 0x20; Enter = 0x0D; Escape = 0x1B; Left = 0x25; Up = 0x26; Right = 0x27; Down = 0x28;
         PageUp = 0x21; PageDown = 0x22; Ctrl = 0x11; Alt = 0x12; Shift = 0x10;
         a = 0x41; c = 0x43; f = 0x46; o = 0x4F; w = 0x57 }

# ── windows ──────────────────────────────────────────────────────────────

function Find-Windows([string]$process) {
    $pids = @(Get-Process -Name $process -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    $found = New-Object System.Collections.ArrayList
    $cb = [SC+EnumWindowsProc]{
        param($h, $l)
        $p = 0; [void][SC]::GetWindowThreadProcessId($h, [ref]$p)
        if (($pids -contains $p) -and [SC]::IsWindowVisible($h)) {
            $t = New-Object System.Text.StringBuilder 512; [void][SC]::GetWindowTextW($h, $t, 512)
            if ($t.Length) { [void]$found.Add([PSCustomObject]@{ Handle = $h; Title = $t.ToString() }) }
        }
        return $true
    }
    [void][SC]::EnumWindows($cb, [IntPtr]::Zero)
    return $found
}
function Main-Window {
    for ($i = 0; $i -lt 6; $i++) {
        $all = @(Find-Windows zotero | Where-Object { $_.Title -match ' - Zotero$' })
        if ($all.Count) { return $all[0] }
        Start-Sleep -Milliseconds 250
    }
    return $null
}
function Sheet-Window([int]$tries = 1) {
    for ($i = 0; $i -lt $tries; $i++) {
        $all = @(Find-Windows zotero | Where-Object { $sheetTitles -contains $_.Title })
        if ($all.Count) { return $all[0] }
        if ($tries -gt 1) { Start-Sleep -Milliseconds 250 }
    }
    return $null
}
function Sheet-Handle {
    $w = Sheet-Window 8
    if (-not $w) { throw "the contact sheet window is gone" }
    return $w.Handle
}
# The visible frame, without the invisible resize border Windows adds
function Window-Rect($h) {
    $h = [IntPtr]$h
    $r = New-Object SC+RECT
    if ([SC]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { [void][SC]::GetWindowRect($h, [ref]$r) }
    $l = [int]$r.Left; $t = [int]$r.Top; $rt = [int]$r.Right; $b = [int]$r.Bottom
    return @($l, $t, ($rt - $l), ($b - $t))
}
function Place-Window($h, $origin, $size) {
    [void][SC]::ShowWindow($h, 9)                                      # SW_RESTORE
    # SetWindowPos takes the outer rectangle; the DWM frame is the visible
    # one, so the difference is put back in
    [void][SC]::SetWindowPos($h, [IntPtr]::Zero, $origin[0], $origin[1], $size[0], $size[1], 0x0004)
    Start-Sleep -Milliseconds 300
    $outer = New-Object SC+RECT; [void][SC]::GetWindowRect($h, [ref]$outer)
    $vis = Window-Rect $h
    $dx = $vis[0] - $outer.Left; $dy = $vis[1] - $outer.Top
    $dw = ($outer.Right - $outer.Left) - $vis[2]; $dh = ($outer.Bottom - $outer.Top) - $vis[3]
    [void][SC]::SetWindowPos($h, [IntPtr]::Zero, $origin[0] - $dx, $origin[1] - $dy, $size[0] + $dw, $size[1] + $dh, 0x0004)
    Start-Sleep -Milliseconds 300
}
function Activate($h) {
    # a tap of Alt grants this process the right to change the foreground
    [SC]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [SC]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][SC]::SetForegroundWindow($h); Start-Sleep -Milliseconds 400
}
# Reader tabs left over from before move the item list down by the height
# of the tab bar, which only shows while there are tabs — so they are closed
# first: whatever tab is not the library is closed, and the cycle through
# the tabs ends when there is nothing else to come to
function Close-Reader-Tabs {
    for ($i = 0; $i -lt 12; $i++) {
        $w = Main-Window; if (-not $w) { return }
        if ($w.Title -match '^zotLook - Zotero$') {
            Press "Ctrl+Tab" 0x09 @($VK.Ctrl); Start-Sleep -Milliseconds 700
            $w2 = Main-Window
            if (-not $w2 -or $w2.Title -eq $w.Title) { return }
        }
        Press "Ctrl+W" $VK.w @($VK.Ctrl); Start-Sleep -Milliseconds 900
    }
}
# The reader's sidebar is hidden for the takes, as it was on macOS. Zotero
# keeps its state in prefs.js, which Gecko writes out soon after a change;
# so the file says whether the toggle in the reader's toolbar needs a click
function Hide-Reader-Sidebar {
    $prefs = Get-ChildItem "$env:APPDATA\Zotero\Zotero\Profiles\*\prefs.js" | Select-Object -First 1
    if (-not $prefs) { return }
    $text = Get-Content $prefs.FullName -Raw
    if ($text -match 'extensions\.zotero\.sidebarState.*?\\"reader\\":\{[^}]*\\"open\\":true') {
        Click-Main $readerSidebarToggle 300; Start-Sleep -Milliseconds 800
    }
}
function Wait-Sheet([int]$halfSeconds) {
    for ($i = 0; $i -lt $halfSeconds; $i++) { if (Sheet-Window) { return $true }; Start-Sleep -Milliseconds 500 }
    return $false
}
function Need-Sheet { if (-not (Wait-Sheet 60)) { throw "the contact sheet did not open" } }
function Wait-NoSheet {
    for ($i = 0; $i -lt 40; $i++) { if (-not (Sheet-Window)) { return }; Start-Sleep -Milliseconds 500 }
    throw "the contact sheet did not close"
}
# The reader draws its page some seconds after the tab is there — four to
# seven on this machine, and not the same twice — while the frame shows a
# blank tab; and it may draw the first page before it moves to the one
# asked for. Closing on a fixed wait cut the page off, so the page area is
# watched instead: text is dark pixels, a blank page and the spinner are
# not, and the picture has to hold still for a moment besides
function Wait-ReaderPage {
    $m = Main-Window; if (-not $m) { return }
    $r = Window-Rect $m.Handle
    $x = $r[0] + 380; $y = $r[1] + 120; $w = 990; $h = 780
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $last = ""; $still = 0
    for ($i = 0; $i -lt 60; $i++) {
        $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
        $dark = 0; $sum = 0
        for ($py = 0; $py -lt $h; $py += 6) {
            for ($px = 0; $px -lt $w; $px += 6) {
                $c = $bmp.GetPixel($px, $py); $v = $c.R + $c.G + $c.B
                if ($v -lt 300) { $dark++ }
                $sum += $v
            }
        }
        $sig = "$dark/$sum"
        if ($sig -eq $last) { $still++ } else { $still = 0 }
        $last = $sig
        if ($dark -gt 60 -and $still -ge 2) { break }   # of some 21 000 samples, unchanged for a second
        Start-Sleep -Milliseconds 400
    }
    $g.Dispose(); $bmp.Dispose()
}
# Right after a start Zotero shows "Loading items…" for a while — the
# longer the library, and longer still after a change of language — and a
# click on the row then hits nothing. The band where the rows will be is
# watched for text before the row is clicked
function Wait-Items {
    $m = Main-Window; if (-not $m) { return }
    $r = Window-Rect $m.Handle
    $x = $r[0] + 340; $y = $r[1] + 150; $w = 800; $h = 90
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    for ($i = 0; $i -lt 120; $i++) {
        $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
        $dark = 0
        for ($py = 0; $py -lt $h; $py += 3) {
            for ($px = 0; $px -lt $w; $px += 3) {
                $c = $bmp.GetPixel($px, $py)
                if (($c.R + $c.G + $c.B) -lt 300) { $dark++ }
            }
        }
        if ($dark -gt 40) { break }
        Start-Sleep -Seconds 1
    }
    $g.Dispose(); $bmp.Dispose()
}
function Shot($h, [string]$name) {
    $r = Window-Rect $h
    $bmp = New-Object System.Drawing.Bitmap($r[2], $r[3])
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r[0], $r[1], 0, 0, (New-Object System.Drawing.Size($r[2], $r[3])))
    $p = Join-Path $Out $name; $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $line = "$name  rect=$($r -join ',')"; Write-Output $line
    Add-Content -Path (Join-Path $Out "probe.txt") -Value $line -Encoding UTF8
}

# ── recording and the timeline ───────────────────────────────────────────

$script:rec = $null; $script:t0 = $null; $script:timeline = ""
function Start-Recording([string]$file, [string]$tsv) {
    Remove-Item $file, $tsv -ErrorAction SilentlyContinue
    $r = Window-Rect (Main-Window).Handle
    $w = [math]::Floor($r[2] / 2) * 2; $h = [math]::Floor($r[3] / 2) * 2   # yuv420p wants even sizes
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Ffmpeg
    $psi.Arguments = "-hide_banner -loglevel error -y -f gdigrab -framerate 30 -draw_mouse 1 -show_region 0 " +
        "-offset_x $($r[0]) -offset_y $($r[1]) -video_size ${w}x${h} -i desktop " +
        "-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -f mov `"$file`""
    $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.CreateNoWindow = $true
    # its output is taken and dropped: left on the caller's handles, ffmpeg
    # would keep a pipe open after the script is gone
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $script:rec = [System.Diagnostics.Process]::Start($psi)
    $script:rec.BeginOutputReadLine(); $script:rec.BeginErrorReadLine()
    # gdigrab is capturing a little after the launch; the timeline counts
    # from then. Measured on this machine like the macOS take, with a pointer
    # sent into the frame at a known moment
    $script:t0 = [DateTime]::UtcNow.AddMilliseconds(300)
    $script:timeline = $tsv
    Start-Sleep -Seconds 2.5
}
function Stop-Recording {
    Start-Sleep -Seconds 1
    if ($script:rec) {
        $script:rec.StandardInput.Write("q"); $script:rec.StandardInput.Flush()
        if (-not $script:rec.WaitForExit(20000)) { $script:rec.Kill() }
        $script:rec = $null
    }
    $script:t0 = $null
}
function Mark([string]$kind, [string]$label) {
    if (-not $script:t0) { return }
    $t = ([DateTime]::UtcNow - $script:t0).TotalSeconds
    # a dot for the decimals whatever the locale, and no byte-order mark:
    # the cut reads the file with float() and a plain UTF-8
    $line = $t.ToString("F3", [Globalization.CultureInfo]::InvariantCulture) + "`t" + $kind + "`t" + $label + "`n"
    [IO.File]::AppendAllText($script:timeline, $line, (New-Object Text.UTF8Encoding($false)))
}

# ── keys, with their record ──────────────────────────────────────────────

function Press([string]$label, [int]$vk, [int[]]$mods = @()) {
    Mark "key" $label
    foreach ($m in $mods) { [SC]::Key($m, $false) }
    [SC]::Key($vk, $false); Start-Sleep -Milliseconds 40; [SC]::Key($vk, $true)
    [array]::Reverse($mods); foreach ($m in $mods) { [SC]::Key($m, $true) }
}
function Chord { Press "Ctrl+Alt+Space" $VK.Space @($VK.Ctrl, $VK.Alt) }
function Letter([string]$ch) { Mark "key" $ch; [SC]::Char([char]$ch) }
function Arrow([string]$dir) {
    # the glyphs as code points: Windows PowerShell 5.1 reads a file without
    # a byte-order mark in the system code page and mangles them otherwise
    $glyph = @{ Down = [string][char]0x2193; Up = [string][char]0x2191; Left = [string][char]0x2190; Right = [string][char]0x2192 }[$dir]
    Press $glyph $VK[$dir]
}
function Type-Text([string]$text) { Mark "type" $text; foreach ($c in $text.ToCharArray()) { [SC]::Char($c); Start-Sleep -Milliseconds 70 } }

# ── the mouse ────────────────────────────────────────────────────────────

# An eased glide of small steps, the way a hand moves; then a rest, long
# enough for the eye to arrive too; then the click
function Glide([int]$x, [int]$y, [int]$ms) {
    $p = New-Object SC+POINT; [void][SC]::GetCursorPos([ref]$p)
    $steps = [math]::Max(8, [int]($ms / 16))
    for ($i = 1; $i -le $steps; $i++) {
        $t = $i / $steps; $s = $t * $t * (3 - 2 * $t)
        [SC]::MouseTo([int]($p.X + ($x - $p.X) * $s), [int]($p.Y + ($y - $p.Y) * $s))
        Start-Sleep -Milliseconds ([int]($ms / $steps))
    }
    [SC]::MouseTo($x, $y)
}
function Click-At([int]$x, [int]$y, [int]$ms) {
    Glide $x $y $ms; Start-Sleep -Milliseconds 600
    Mark "click" ""
    [SC]::MouseButton(0x0002); Start-Sleep -Milliseconds 60; [SC]::MouseButton(0x0004)
}
function Click-Main($pt, [int]$ms) {
    $r = Window-Rect (Main-Window).Handle
    Click-At ($r[0] + $pt[0]) ($r[1] + $pt[1]) $ms
}
function Click-Sheet($pt, [int]$ms) {
    $r = Window-Rect (Sheet-Handle)
    Click-At ($r[0] + $pt[0]) ($r[1] + $pt[1]) $ms
}
function Scroll-Sheet([int]$notches) {
    $r = Window-Rect (Sheet-Handle)
    Glide ($r[0] + [int]($r[2] / 2)) ($r[1] + [int]($r[3] / 2)) 400
    Mark "scroll" "$notches"
    $sign = [math]::Sign($notches)
    for ($i = 0; $i -lt [math]::Abs($notches); $i++) { [SC]::Wheel(120 * $sign); Start-Sleep -Milliseconds 90 }
}

# ── before the takes ─────────────────────────────────────────────────────

function Prepare {
    Start-Process "zotero://select/library/collections/$collectionKey"
    Start-Sleep -Seconds 3
    $main = Main-Window
    if (-not $main) { throw "no Zotero main window" }
    Activate $main.Handle
    Place-Window $main.Handle $mainOrigin $mainSize
    Start-Sleep -Seconds 1
    Close-Reader-Tabs
    Wait-Items
    Start-Sleep -Seconds 1
    if ($Stage -eq "probe") { Shot $main.Handle "probe-main-$Lang.png" }
    # The first shortcut after a zotero://select has been seen to do
    # nothing; the row is clicked and the shortcut sent until the sheet is there
    for ($try = 0; $try -lt 4; $try++) {
        Click-Main $docsRow[$Lang] 300
        Start-Sleep -Milliseconds 800
        Press "Ctrl+Alt+Space" $VK.Space @($VK.Ctrl, $VK.Alt)
        if (Wait-Sheet 20) { break }
    }
    if (-not (Sheet-Window)) { throw "the contact sheet did not open" }
    Start-Sleep -Seconds 2
    Place-Window (Sheet-Handle) $sheetOrigin $sheetSize
    Start-Sleep -Seconds 1
    if ($Stage -eq "probe") {
        Shot (Sheet-Handle) "probe-sheet-$Lang.png"
        # the menus open, for measuring their entries
        Click-Sheet $btnContents 400; Start-Sleep -Seconds 1.2; Shot (Sheet-Handle) "probe-sheet-contents-$Lang.png"
        Click-Sheet $btnContents 300; Start-Sleep -Milliseconds 800
        Click-Sheet $btnAnnotations 400; Start-Sleep -Seconds 1.2; Shot (Sheet-Handle) "probe-sheet-annotations-$Lang.png"
        Click-Sheet $entryBlueAnnotation[$Lang] 400; Start-Sleep -Seconds 1; Shot (Sheet-Handle) "probe-sheet-annotation-open-$Lang.png"
        Click-Sheet $btnAnnotations 300; Start-Sleep -Milliseconds 800
        # the search and the scroll to the page with the most hits
        Click-Sheet $searchField 400; Type-Text $searchWord[$Lang]; Start-Sleep -Seconds 1.5
        Shot (Sheet-Handle) "probe-sheet-search-$Lang.png"
        Scroll-Sheet $scrollTo14; Start-Sleep -Seconds 1
        Shot (Sheet-Handle) "probe-sheet-scrolled-$Lang.png"
    }
    # The warm-up ends the way the takes do: a page into the reader, whose
    # tab is then closed
    Press "Enter" $VK.Enter; Start-Sleep -Milliseconds 800
    Letter "o"; Wait-NoSheet; Start-Sleep -Seconds 2
    Hide-Reader-Sidebar
    if ($Stage -eq "probe") { Shot (Main-Window).Handle "probe-reader-$Lang.png" }
    Press "Ctrl+W" $VK.w @($VK.Ctrl); Start-Sleep -Seconds 1
    Activate (Main-Window).Handle
    # Closing the tab leaves the keyboard nowhere in particular; the take
    # that begins with the shortcut needs it in the item list, so the row is
    # clicked once more, before the recording
    Click-Main $docsRow[$Lang] 300; Start-Sleep -Milliseconds 800
}

# ── the two takes ────────────────────────────────────────────────────────

function Mouse-Part {
    Click-Main $docsRow[$Lang] 500; Start-Sleep -Seconds 1
    Chord; Need-Sheet; Start-Sleep -Seconds 1.5

    Click-Sheet $btnContents 700; Start-Sleep -Seconds 1.4
    Click-Sheet $entryWasEsKann 700; Start-Sleep -Seconds 2.4
    Click-Sheet $btnContents 600; Start-Sleep -Seconds 1.2
    Click-Sheet $tileAfterContents 800; Wait-NoSheet; Wait-ReaderPage; Start-Sleep -Seconds 2.5
    Click-Main $readerClose 800; Start-Sleep -Seconds 1.5

    Chord; Need-Sheet; Start-Sleep -Seconds 1.5
    Click-Sheet $btnAnnotations 700; Start-Sleep -Seconds 1.4
    Click-Sheet $entryBlueAnnotation[$Lang] 700; Start-Sleep -Seconds 1.2
    Click-Sheet $linkSeite6[$Lang] 500; Start-Sleep -Seconds 2.4
    Click-Sheet $btnAnnotations 600; Start-Sleep -Seconds 1.2
    Click-Sheet $tileAfterAnnotation 800; Wait-NoSheet; Wait-ReaderPage; Start-Sleep -Seconds 2.5
    Click-Main $readerClose 800; Start-Sleep -Seconds 1.5

    Chord; Need-Sheet; Start-Sleep -Seconds 1.5
    Click-Sheet $searchField 700; Start-Sleep -Milliseconds 600
    Type-Text $searchWord[$Lang]; Start-Sleep -Seconds 2
    Scroll-Sheet $scrollTo14; Start-Sleep -Seconds 2.2
    Click-Sheet $tileAfterSearch 800; Wait-NoSheet; Wait-ReaderPage; Start-Sleep -Seconds 2.5
    Click-Main $readerClose 800; Start-Sleep -Seconds 1.5
}

function Keyboard-Part {
    Chord; Need-Sheet; Start-Sleep -Seconds 2
    Letter "c"; Start-Sleep -Seconds 1
    for ($i = 0; $i -lt 8; $i++) { Arrow Down; Start-Sleep -Milliseconds 350 }
    Start-Sleep -Milliseconds 600
    Press "Enter" $VK.Enter; Start-Sleep -Seconds 2.2
    Letter "o"; Wait-NoSheet; Wait-ReaderPage; Start-Sleep -Seconds 2.5
    Press "Ctrl+W" $VK.w @($VK.Ctrl); Start-Sleep -Seconds 1.5

    Chord; Need-Sheet; Start-Sleep -Seconds 1.5
    Letter "a"; Start-Sleep -Seconds 1
    Arrow Down; Start-Sleep -Milliseconds 800
    Press "Enter" $VK.Enter; Start-Sleep -Seconds 2.2
    Letter "o"; Wait-NoSheet; Wait-ReaderPage; Start-Sleep -Seconds 2.5
    Press "Ctrl+W" $VK.w @($VK.Ctrl); Start-Sleep -Seconds 1.5

    Chord; Need-Sheet; Start-Sleep -Seconds 1.5
    Press "Ctrl+F" $VK.f @($VK.Ctrl); Start-Sleep -Milliseconds 600
    Type-Text $searchWord[$Lang]; Start-Sleep -Seconds 1.4
    for ($i = 0; $i -lt 3; $i++) { Press "Enter" $VK.Enter; Start-Sleep -Seconds 1 }
    Start-Sleep -Milliseconds 600
    Arrow Down; Start-Sleep -Seconds 1
    Arrow Up; Start-Sleep -Seconds 1
    Arrow Right; Start-Sleep -Seconds 1
    Arrow Left; Start-Sleep -Seconds 1
    Press "Page Down" $VK.PageDown; Start-Sleep -Seconds 2.2
    Press "Page Up" $VK.PageUp; Start-Sleep -Seconds 2
    Letter "o"; Wait-NoSheet; Wait-ReaderPage; Start-Sleep -Seconds 2.5
    Press "Ctrl+W" $VK.w @($VK.Ctrl); Start-Sleep -Seconds 1.5
}

# ── run ──────────────────────────────────────────────────────────────────

# -Stage none defines the functions and stops: dot-source the script so,
# and the steps can be tried one at a time
if ($Stage -eq "none") { return }
Prepare
if ($Stage -in @("prepare", "probe")) { Write-Output "prepared; probes in $Out"; exit 0 }
if ($Stage -in @("all", "mouse")) {
    Start-Recording (Join-Path $Out "windows-$Lang-mouse.mov") (Join-Path $Out "windows-$Lang-mouse.tsv")
    try { Mouse-Part } finally { Stop-Recording }
}
if ($Stage -in @("all", "keyboard")) {
    Start-Recording (Join-Path $Out "windows-$Lang-keyboard.mov") (Join-Path $Out "windows-$Lang-keyboard.tsv")
    try { Keyboard-Part } finally { Stop-Recording }
}
Write-Output "recorded into $Out"
