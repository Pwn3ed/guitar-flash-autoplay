# Draws the extension icon (original design: an electric guitar on a transparent background) at 512 px and exports all sizes.
#   extension/icons/icon16|32|48|128.png  and  store/icon300.png
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path $dir -Parent

function C([int]$r, [int]$g, [int]$b, [int]$a = 255) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }
function P([float]$x, [float]$y) { New-Object System.Drawing.PointF $x, $y }

$S = 512
$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.Clear([System.Drawing.Color]::Transparent)

# transparent background: only the guitar. It is drawn upright around (256,247), then rotated and scaled to fill
# the canvas. Light outlines keep it visible on both light and dark browser toolbars.
$state = $g.Save()
$g.TranslateTransform(256, 256); $g.RotateTransform(40); $g.ScaleTransform(0.95, 0.95); $g.TranslateTransform(-256, -247)

# neck + headstock
$edge = New-Object System.Drawing.Pen (C 255 255 255 210), 6
$g.DrawRectangle($edge, 238, 40, 36, 250)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (C 120 74 40)), 238, 40, 36, 250)
$fret = New-Object System.Drawing.Pen (C 230 220 205), 3
for ($y = 70; $y -le 270; $y += 26) { $g.DrawLine($fret, 238, $y, 274, $y) }
$head = New-Object System.Drawing.Drawing2D.GraphicsPath
$head.AddPolygon(@((P 230 50), (P 282 50), (P 292 -6), (P 222 -6)))
$g.DrawPath($edge, $head)
$g.FillPath((New-Object System.Drawing.SolidBrush (C 200 30 45)), $head)
$peg = New-Object System.Drawing.SolidBrush (C 220 220 228)
foreach ($py in 2, 20, 38) { $g.FillEllipse($peg, 208, $py, 14, 10); $g.FillEllipse($peg, 290, $py, 14, 10) }

# body: double-cut electric shape made of ellipses (red with orange gradient)
$body = New-Object System.Drawing.Drawing2D.GraphicsPath
$body.AddEllipse(150, 330, 212, 170)     # lower bout
$body.AddEllipse(170, 258, 172, 130)     # upper bout
$region = New-Object System.Drawing.Region $body
$bodyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (P 150 258), (P 362 500), (C 255 70 50), (C 200 20 40)
$g.FillRegion($bodyBrush, $region)
$outline = New-Object System.Drawing.Pen (C 255 255 255 200), 6
$g.DrawEllipse($outline, 150, 330, 212, 170); $g.DrawEllipse($outline, 170, 258, 172, 130)
$g.FillRegion($bodyBrush, (New-Object System.Drawing.Region (New-Object System.Drawing.RectangleF 176, 300, 160, 120)))
# pickguard, pickups, bridge
$g.FillEllipse((New-Object System.Drawing.SolidBrush (C 245 245 245 235)), 196, 360, 92, 100)
$pk = New-Object System.Drawing.SolidBrush (C 25 25 30)
$g.FillRectangle($pk, 226, 312, 60, 18); $g.FillRectangle($pk, 226, 360, 60, 18); $g.FillRectangle((New-Object System.Drawing.SolidBrush (C 190 190 200)), 222, 420, 68, 12)
# strings
$str = New-Object System.Drawing.Pen (C 235 235 240 220), 2
foreach ($x in 244, 252, 260, 268) { $g.DrawLine($str, $x, 0, $x, 426) }
$g.Restore($state)

$g.Dispose()
function Save([int]$size, [string]$path) {
  $o = New-Object System.Drawing.Bitmap $size, $size
  $gg = [System.Drawing.Graphics]::FromImage($o); $gg.InterpolationMode = 'HighQualityBicubic'; $gg.SmoothingMode = 'AntiAlias'; $gg.PixelOffsetMode = 'HighQuality'
  $gg.DrawImage($bmp, 0, 0, $size, $size); $gg.Dispose()
  $o.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $o.Dispose()
}
foreach ($s in 16, 32, 48, 128) { Save $s (Join-Path $root "extension\icons\icon$s.png") }
Save 300 (Join-Path $dir 'icon300.png')
$bmp.Save((Join-Path $dir 'icon512.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"icons written"
