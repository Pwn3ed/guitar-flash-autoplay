# Builds the store packages from .\extension into .\dist
#   guitar-flash-bot-chromium-<ver>.zip  -> Chrome Web Store, Edge Add-ons, Opera Add-ons (Brave uses the Chrome Web Store)
#   guitar-flash-bot-firefox-<ver>.zip   -> addons.mozilla.org
# Usage:  powershell -ExecutionPolicy Bypass -File .\build.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $root 'extension'
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

$manifest = Get-Content (Join-Path $src 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = $manifest.version
$files = Get-ChildItem $src -Recurse -File | Where-Object { $_.Name -notin @('manifest.json') }

function Write-Zip([string]$zipPath, [string]$manifestJson) {
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    $e = $zip.CreateEntry('manifest.json')
    $w = New-Object System.IO.StreamWriter($e.Open(), (New-Object System.Text.UTF8Encoding($false)))
    $w.Write($manifestJson); $w.Close()
    foreach ($f in $files) {
      $rel = $f.FullName.Substring($src.Length + 1).Replace('\', '/')   # stores require forward slashes
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel) | Out-Null
    }
  } finally { $zip.Dispose() }
}

# Chromium: service worker background, no Firefox-only keys
$m = Get-Content (Join-Path $src 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$m.background = [pscustomobject]@{ service_worker = 'background.js' }
$m.PSObject.Properties.Remove('browser_specific_settings')
Write-Zip (Join-Path $dist "guitar-flash-bot-chromium-$ver.zip") ($m | ConvertTo-Json -Depth 10)

# Firefox: event-page background (scripts), keep gecko settings
$m = Get-Content (Join-Path $src 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$m.background = [pscustomobject]@{ scripts = @('background.js') }
Write-Zip (Join-Path $dist "guitar-flash-bot-firefox-$ver.zip") ($m | ConvertTo-Json -Depth 10)

Get-ChildItem $dist | Select-Object Name, Length | Format-Table -AutoSize

# Installer folder for Chrome/Edge/Brave ("Carregar sem compactacao"), next to the project folder:
#   ..\guitar-flash-bot-INSTALADOR
# It is regenerated on every build; after building, click the reload button of the extension in chrome://extensions.
$inst = Join-Path (Split-Path $root -Parent) 'guitar-flash-bot-INSTALADOR'
if (Test-Path $inst) { Get-ChildItem $inst -Force | Remove-Item -Recurse -Force } else { New-Item -ItemType Directory $inst | Out-Null }
Expand-Archive (Join-Path $dist "guitar-flash-bot-chromium-$ver.zip") -DestinationPath $inst
$note = @"
GUITAR FLASH BOT - INSTALADOR (Chrome / Edge / Brave / Opera)
Versao $ver - gerado automaticamente pelo build.ps1 do projeto. Nao edite os arquivos daqui.

Instalar:
 1. Abra chrome://extensions (Edge: edge://extensions, Brave: brave://extensions)
 2. Ligue "Modo do desenvolvedor"
 3. "Carregar sem compactacao" -> escolha ESTA pasta

Atualizar depois de um novo build: clique no botao de recarregar da extensao em chrome://extensions.
Projeto (codigo-fonte): ..\guitar-flash-bot
"@
[System.IO.File]::WriteAllText((Join-Path $inst 'LEIA-ME - INSTALADOR.txt'), $note, (New-Object System.Text.UTF8Encoding($true)))
"Instalador atualizado: $inst"

