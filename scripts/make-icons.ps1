# Regenerates public/icons/icon-<size>.png from assets/logo-source.png (Windows PowerShell or PowerShell 7 on Windows).
# The artwork is a rounded tile on a dark backdrop: the tile is cropped out and its corners made transparent.
param(
  [string]$Source = (Join-Path $PSScriptRoot '..\assets\logo-source.png'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\public\icons'),
  [int[]]$Sizes = @(16, 32, 48, 128)
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source).Path)
try {
  $backdrop = $src.GetPixel(3, 3)
  function Test-Tile([System.Drawing.Color]$c) {
    ([math]::Abs($c.R - $backdrop.R) + [math]::Abs($c.G - $backdrop.G) + [math]::Abs($c.B - $backdrop.B)) -gt 60
  }

  $mid = [int]($src.Width / 2)
  $left = 0;                 while (-not (Test-Tile $src.GetPixel($left, $mid)))  { $left++ }
  $right = $src.Width - 1;   while (-not (Test-Tile $src.GetPixel($right, $mid))) { $right-- }
  $top = 0;                  while (-not (Test-Tile $src.GetPixel($mid, $top)))   { $top++ }
  $bottom = $src.Height - 1; while (-not (Test-Tile $src.GetPixel($mid, $bottom))) { $bottom-- }
  $side = [math]::Min($right - $left + 1, $bottom - $top + 1)
  Write-Host "Tile found at x=$left..$right, y=$top..$bottom (side $side)"

  # One large master first, so the small sizes are reduced from a clean image instead of from 1254 px.
  $masterSize = 512
  $master = New-Object System.Drawing.Bitmap($masterSize, $masterSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($master)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $masterSize, $masterSize)), $left, $top, $side, $side, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()

  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  foreach ($size in $Sizes) {
    $scaled = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $sg = [System.Drawing.Graphics]::FromImage($scaled)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sg.DrawImage($master, 0, 0, $size, $size)
    $sg.Dispose()

    # Fill a rounded rectangle with the scaled image: unlike a clip, this antialiases the corner edge.
    $radius = $size * 0.24
    $d = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $og = [System.Drawing.Graphics]::FromImage($out)
    $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $og.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.TextureBrush($scaled)
    $og.FillPath($brush, $path)
    $og.Dispose(); $brush.Dispose(); $scaled.Dispose()

    $file = Join-Path $OutDir "icon-$size.png"
    $out.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    Write-Host ("Wrote {0} ({1} bytes)" -f $file, (Get-Item $file).Length)
  }
  $master.Dispose()
}
finally {
  $src.Dispose()
}
