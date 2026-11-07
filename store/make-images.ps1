# Builds the store images (1280x800 screenshots + 440x280 promo tile) from store\raw captures.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$raw = Join-Path $dir 'raw'
$out = Join-Path $dir 'images'
New-Item -ItemType Directory -Force $out | Out-Null

function C([int]$r, [int]$g, [int]$b, [int]$a = 255) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }
function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2*$r, 2*$r, 180, 90); $p.AddArc($x+$w-2*$r, $y, 2*$r, 2*$r, 270, 90)
  $p.AddArc($x+$w-2*$r, $y+$h-2*$r, 2*$r, 2*$r, 0, 90); $p.AddArc($x, $y+$h-2*$r, 2*$r, 2*$r, 90, 90); $p.CloseFigure(); $p
}
function DrawPopup($g, [float]$x, [float]$y, [string]$lang, [bool]$on) {
  $g.FillPath((New-Object System.Drawing.SolidBrush (C 22 22 26)), (RoundRect $x $y 330 250 16))
  $g.DrawPath((New-Object System.Drawing.Pen (C 70 70 80), 2), (RoundRect $x $y 330 250 16))
  $icon = [System.Drawing.Image]::FromFile((Join-Path (Split-Path $dir -Parent) 'extension\icons\icon48.png'))
  $g.DrawImage($icon, $x+20, $y+18, 36, 36); $icon.Dispose()
  $g.DrawString('Guitar Flash Autoplay', (New-Object System.Drawing.Font 'Segoe UI', 17, ([System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush (C 242 242 242)), $x+64, $y+22)
  $btnColor = if ($on) { C 192 57 43 } else { C 31 157 85 }
  $g.FillPath((New-Object System.Drawing.SolidBrush $btnColor), (RoundRect ($x+20) ($y+72) 290 58 12))
  $sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $label = if ($on) { 'STOP' } else { 'START' }
  $g.DrawString($label, (New-Object System.Drawing.Font 'Segoe UI', 22, ([System.Drawing.FontStyle]::Bold)), [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF ($x+20), ($y+72), 290, 58), $sf)
  $muted = New-Object System.Drawing.SolidBrush (C 160 160 170); $f = New-Object System.Drawing.Font 'Segoe UI', 13
  if ($lang -eq 'pt') { $l1 = 'Jogando: Through The Fire And Flames'; $l2 = 'Notas tocadas: 951' } else { $l1 = 'Playing: Through The Fire And Flames'; $l2 = 'Notes played: 951' }
  $g.DrawString($l1, $f, $muted, $x+20, $y+150); $g.DrawString($l2, $f, $muted, $x+20, $y+178)
}
function Shot([string]$rawName, [string]$outName, [string]$title, [string]$sub, [string]$lang, [int]$cropX = 215, [int]$cropW = 390) {
  $W = 1280; $H = 800
  $bmp = New-Object System.Drawing.Bitmap $W, $H; $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $W, $H), (C 24 22 34), (C 8 8 12)
  $g.FillRectangle($bg, 0, 0, $W, $H)
  # gameplay crop (note highway only, from the hit line up to below the video)
  $src = [System.Drawing.Image]::FromFile((Join-Path $raw $rawName))
  $cropY = 210; $cropH = $src.Height - $cropY
  $dh = 760; $dw = [int]($cropW * $dh / $cropH)
  $dst = New-Object System.Drawing.Rectangle 30, 20, $dw, $dh
  $g.SetClip((RoundRect 30 20 $dw $dh 18)); $g.DrawImage($src, $dst, (New-Object System.Drawing.Rectangle $cropX, $cropY, $cropW, $cropH), 'Pixel'); $g.ResetClip(); $src.Dispose()
  $g.DrawPath((New-Object System.Drawing.Pen (C 255 255 255 40), 2), (RoundRect 30 20 $dw $dh 18))
  # text + popup on the right
  $tx = 30 + $dw + 50; $tw = $W - $tx - 40
  $g.DrawString($title, (New-Object System.Drawing.Font 'Segoe UI', 28, ([System.Drawing.FontStyle]::Bold)), [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF $tx, 90, $tw, 200))
  $g.DrawString($sub, (New-Object System.Drawing.Font 'Segoe UI', 18), (New-Object System.Drawing.SolidBrush (C 190 190 200)), (New-Object System.Drawing.RectangleF $tx, 300, $tw, 140))
  DrawPopup $g $tx 470 $lang $true
  $bmp.Save((Join-Path $out $outName), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}

Shot 'ttfaf-streak.png' 'screenshot-1-pt.png' 'Acerta as notas por você' 'Acordes, notas longas e sequências rápidas, sem apertos errados.' 'pt'
Shot 'ttfaf-dense.png' 'screenshot-2-pt.png' 'Through the Fire and Flames no Expert' 'Liga com um clique e joga sozinho qualquer música do guitarflash.com.' 'pt'
Shot 'ttfaf-streak.png' 'screenshot-1-en.png' 'Hits the notes for you' 'Chords, sustains and fast runs, with no overstrums.' 'en'
Shot 'ttfaf-dense.png' 'screenshot-2-en.png' 'Through the Fire and Flames on Expert' 'One click to turn it on; it plays any song on guitarflash.com by itself.' 'en'

# small promo tile 440x280 (Chrome Web Store) / generic banner
$bmp = New-Object System.Drawing.Bitmap 440, 280; $g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.FillRectangle((New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 440, 280), (C 30 26 44), (C 8 8 12)), 0, 0, 440, 280)
$icon = [System.Drawing.Image]::FromFile((Join-Path $dir 'icon300.png')); $g.DrawImage($icon, 24, 60, 160, 160); $icon.Dispose()
$g.DrawString("Guitar Flash`nAutoplay", (New-Object System.Drawing.Font 'Segoe UI', 24, ([System.Drawing.FontStyle]::Bold)), [System.Drawing.Brushes]::White, 198, 62)
$g.DrawString("Joga sozinho por você", (New-Object System.Drawing.Font 'Segoe UI', 14), (New-Object System.Drawing.SolidBrush (C 200 200 210)), 202, 152)
$bmp.Save((Join-Path $out 'promo-440x280.png'), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()

Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
