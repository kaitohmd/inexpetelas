$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$outputDirectory = Join-Path $projectRoot 'installer\dist'
$outputFile = Join-Path $outputDirectory 'INEXPETELAS.exe'
$iconFile = Join-Path $projectRoot 'assets\app.ico'

if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'O compilador do Windows/.NET Framework não foi encontrado.'
}
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /out:$outputFile `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll `
    /resource:$iconFile,App.ico (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o launcher (código $LASTEXITCODE)." }
Write-Output "Launcher pronto: $outputFile"
