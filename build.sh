#!/usr/bin/env bash
# Linux/macOS equivalent of build.ps1. Builds the store packages from ./extension into ./dist
#   guitar-flash-bot-chromium-<ver>.zip  -> Chrome Web Store, Edge Add-ons, Opera Add-ons (Brave uses the Chrome Web Store)
#   guitar-flash-bot-firefox-<ver>.zip   -> addons.mozilla.org
# and refreshes the installer folder ../guitar-flash-bot-INSTALADOR (Chrome/Edge/Brave "Load unpacked").
# Requires: jq, zip.   Usage:  ./build.sh
set -euo pipefail
for c in jq zip; do command -v "$c" >/dev/null || { echo "faltando: $c" >&2; exit 1; }; done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$root/extension"
dist="$root/dist"
mkdir -p "$dist"
ver="$(jq -r .version "$src/manifest.json")"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# pack <name> <jq filter applied to manifest.json>
pack() {
  local name="$1" filter="$2" stage="$tmp/$1"
  mkdir -p "$stage"
  (cd "$src" && find . -type f ! -name manifest.json -print0 | xargs -0 cp --parents -t "$stage")
  jq "$filter" "$src/manifest.json" > "$stage/manifest.json"
  rm -f "$dist/guitar-flash-bot-$name-$ver.zip"
  (cd "$stage" && zip -qrX "$dist/guitar-flash-bot-$name-$ver.zip" .)
}

# Chromium: service worker background, no Firefox-only keys
pack chromium '.background = {service_worker: "background.js"} | del(.browser_specific_settings)'
# Firefox: event-page background (scripts), keep gecko settings
pack firefox '.background = {scripts: ["background.js"]}'
ls -l "$dist"

# Installer folder for Chrome/Edge/Brave, next to the project folder (regenerated on every build; do not edit it)
inst="$(dirname "$root")/guitar-flash-bot-INSTALADOR"
rm -rf "$inst"; mkdir -p "$inst"
cp -r "$tmp/chromium/." "$inst/"
cat > "$inst/LEIA-ME - INSTALADOR.txt" <<EOF
GUITAR FLASH BOT - INSTALADOR (Chrome / Edge / Brave / Opera)
Versao $ver - gerado automaticamente pelo build.sh do projeto. Nao edite os arquivos daqui.

Instalar:
 1. Abra chrome://extensions (Edge: edge://extensions, Brave: brave://extensions)
 2. Ligue "Modo do desenvolvedor"
 3. "Carregar sem compactacao" -> escolha ESTA pasta

Atualizar depois de um novo build: clique no botao de recarregar da extensao em chrome://extensions.
Projeto (codigo-fonte): ../guitar-flash-bot
EOF
echo "Instalador atualizado: $inst"
