# Generates the PNG icons and the promo banner from the brand motif
# (same artwork as icons/favicon.svg). Windows only: uses System.Drawing.
# Run: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root "icons"
$assets = Join-Path $root "assets"
New-Item -ItemType Directory -Force $icons | Out-Null
New-Item -ItemType Directory -Force $assets | Out-Null

$brown = [System.Drawing.Color]::FromArgb(255, 122, 46, 18)   # #7a2e12
$red = [System.Drawing.Color]::FromArgb(255, 198, 40, 40)     # #c62828
$gold = [System.Drawing.Color]::FromArgb(255, 245, 197, 24)   # #f5c518
$teal = [System.Drawing.Color]::FromArgb(255, 11, 127, 138)   # #0b7f8a
$cream = [System.Drawing.Color]::FromArgb(255, 253, 241, 221) # #fdf1dd
$white = [System.Drawing.Color]::White

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Draws the 48x48 motif (prize wheel with pointer) scaled by $k, offset by $ox/$oy.
function Draw-Motif($g, [float]$k, [float]$ox, [float]$oy, [bool]$withBackground) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    if ($withBackground) {
        $bgPath = New-RoundedRectPath ($ox + 2 * $k) ($oy + 2 * $k) (44 * $k) (44 * $k) (11 * $k)
        $bgBrush = New-Object System.Drawing.SolidBrush($brown)
        $g.FillPath($bgBrush, $bgPath)
        $bgBrush.Dispose(); $bgPath.Dispose()
    }

    # rim
    $rimBrush = New-Object System.Drawing.SolidBrush($red)
    $g.FillEllipse($rimBrush, ($ox + (24 - 16.5) * $k), ($oy + (27 - 16.5) * $k), (33 * $k), (33 * $k))
    $rimBrush.Dispose()

    # six wedges, gold alternating with teal / cream / teal
    $bx = $ox + (24 - 15) * $k
    $by = $oy + (27 - 15) * $k
    $bw = 30 * $k
    $wedges = @(
        @(-90, $gold), @(-30, $teal), @(30, $gold),
        @(90, $cream), @(150, $gold), @(210, $teal)
    )
    foreach ($wedge in $wedges) {
        $brush = New-Object System.Drawing.SolidBrush($wedge[1])
        $g.FillPie($brush, $bx, $by, $bw, $bw, [float]$wedge[0], 60.0)
        $brush.Dispose()
    }

    # hub
    $hubBrush = New-Object System.Drawing.SolidBrush($cream)
    $g.FillEllipse($hubBrush, ($ox + (24 - 3.6) * $k), ($oy + (27 - 3.6) * $k), (7.2 * $k), (7.2 * $k))

    # pointer, biting into the wheel from above
    $pointer = @(
        (New-Object System.Drawing.PointF(($ox + 24 * $k), ($oy + 15.5 * $k))),
        (New-Object System.Drawing.PointF(($ox + 19.6 * $k), ($oy + 5.5 * $k))),
        (New-Object System.Drawing.PointF(($ox + 28.4 * $k), ($oy + 5.5 * $k)))
    )
    $g.FillPolygon($hubBrush, $pointer)
    $hubBrush.Dispose()
}

function Save-Icon([int]$size, [string]$name, [string]$mode) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)

    if ($mode -eq "rounded") {
        # transparent corners, rounded background (regular icons)
        Draw-Motif $g ($size / 48.0) 0 0 $true
    }
    else {
        # full-bleed background (maskable / apple-touch), motif in the safe area
        $bgBrush = New-Object System.Drawing.SolidBrush($brown)
        $g.FillRectangle($bgBrush, 0, 0, $size, $size)
        $bgBrush.Dispose()
        $k = $size / 48.0 * 0.8
        $off = ($size - 48 * $k) / 2
        Draw-Motif $g $k $off $off $false
    }

    $g.Dispose()
    $bmp.Save((Join-Path $icons $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "icons/$name"
}

Save-Icon 512 "icon-512.png" "rounded"
Save-Icon 192 "icon-192.png" "rounded"
Save-Icon 32  "favicon-32.png" "rounded"
Save-Icon 512 "maskable-512.png" "fullbleed"
Save-Icon 180 "apple-touch-icon.png" "fullbleed"

# ---- promo banner (1200x630, used for og:image and the README) ----

$w = 1200; $h = 630
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($w, $h)),
    $brown, $red)
$g.FillRectangle($grad, 0, 0, $w, $h)
$grad.Dispose()

Draw-Motif $g 6.2 12 152 $false

$titleFont = New-Object System.Drawing.Font("Segoe UI", 68, [System.Drawing.FontStyle]::Bold)
$subFont = New-Object System.Drawing.Font("Segoe UI", 28)
$smallFont = New-Object System.Drawing.Font("Segoe UI", 20)
$whiteBrush = New-Object System.Drawing.SolidBrush($white)
$creamBrush = New-Object System.Drawing.SolidBrush($cream)
$softBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 253, 241, 221))

# middle dot via char code so the script is encoding-proof
$dot = [string][char]0x00B7
$g.DrawString("Dreh das Rad", $titleFont, $whiteBrush, 340, 190)
$g.DrawString("Options in, wheel spins, fate decides.", $subFont, $creamBrush, 348, 320)
$g.DrawString("shareable link $dot 4 colour worlds $dot 12 languages $dot open source", $smallFont, $softBrush, 350, 382)

$titleFont.Dispose(); $subFont.Dispose(); $smallFont.Dispose()
$whiteBrush.Dispose(); $creamBrush.Dispose(); $softBrush.Dispose()
$g.Dispose()
$bmp.Save((Join-Path $assets "promo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "assets/promo.png"
