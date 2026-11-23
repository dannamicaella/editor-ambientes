$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Join-Path $PSScriptRoot '../public/icons'
[void][IO.Directory]::CreateDirectory($root)
foreach ($side in @(192, 512)) {
  $bitmap = [Drawing.Bitmap]::new($side, $side)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(234, 242, 209), 4.5)
  try {
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::FromArgb(33, 75, 60))
    $graphics.ScaleTransform($side / 100.0, $side / 100.0)
    $pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPolygon($pen, [Drawing.Point[]]@(
      [Drawing.Point]::new(50, 28), [Drawing.Point]::new(72, 40),
      [Drawing.Point]::new(50, 52), [Drawing.Point]::new(28, 40)
    ))
    foreach ($y in @(51, 62)) {
      $graphics.DrawLines($pen, [Drawing.Point[]]@(
        [Drawing.Point]::new(28, $y), [Drawing.Point]::new(50, ($y + 12)), [Drawing.Point]::new(72, $y)
      ))
    }
    $bitmap.Save((Join-Path $root "icon-$side.png"), [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}
