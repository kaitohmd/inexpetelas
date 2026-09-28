Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(12,10,14))
$bounds = New-Object System.Drawing.Rectangle 0,0,256,256
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bounds,([System.Drawing.Color]::FromArgb(255,75,93)),([System.Drawing.Color]::FromArgb(140,16,43)),45
$graphics.FillEllipse($gradient,18,18,220,220)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),12
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawRectangle($pen,58,67,140,100)
$graphics.DrawLine($pen,128,167,128,190)
$graphics.DrawLine($pen,96,192,160,192)
$graphics.DrawLine($pen,107,117,122,132)
$graphics.DrawLine($pen,122,132,154,99)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
$output = Join-Path $PSScriptRoot '..\assets\app.ico'
$file = [System.IO.File]::Create($output)
$writer = New-Object System.IO.BinaryWriter $file
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22)
$writer.Write($png)
$writer.Dispose(); $file.Dispose(); $stream.Dispose(); $pen.Dispose(); $gradient.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
