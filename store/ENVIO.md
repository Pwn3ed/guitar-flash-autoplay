# Como publicar o Guitar Flash Bot

Pacotes (gerados por `build.ps1`, na pasta `dist`):
- `guitar-flash-bot-chromium-1.0.0.zip` -> Chrome Web Store, Edge Add-ons, Opera Add-ons
- `guitar-flash-bot-firefox-1.0.0.zip`  -> Firefox Add-ons (AMO)

Material para os formulários (pasta `store`):
- Textos (nome, resumo, descrição em PT e EN, justificativa de permissões): `LISTING.md`
- Política de privacidade: `PRIVACY.md`, publicada em **https://gfb.pwn3ed.workers.dev/privacidade** (é essa URL que vai no formulário; o servidor lê o próprio `PRIVACY.md` a cada deploy do `server/`)
- Imagens 1280x800: `images/screenshot-1-pt.png`, `images/screenshot-2-pt.png` (e as versões `-en`)
- Tile promocional 440x280: `images/promo-440x280.png`
- Ícone 128x128: `../extension/icons/icon128.png` (ícone 300x300 para o Opera/Edge: `icon300.png`)

## Firefox Add-ons (grátis)
1. Crie uma conta em https://addons.mozilla.org e entre em "Developer Hub".
2. "Submit a New Add-on" -> escolha "On this site" (pública) ou "On your own" (não listada, só assinada).
3. Envie `guitar-flash-bot-firefox-1.0.0.zip`.
4. Quando perguntar sobre código-fonte: o código não é minificado, responda que não usa ferramentas de build.
5. Preencha textos, categoria "Games & Entertainment", política de privacidade e imagens.

## Edge Add-ons (grátis)
1. Registre-se no programa Microsoft Edge no Partner Center (conta individual).
2. "Create new extension" -> envie `guitar-flash-bot-chromium-1.0.0.zip`.
3. Preencha disponibilidade, propriedades (categoria Entertainment), listagem (PT/EN) e notas para o revisor (estão em LISTING.md).

## Opera Add-ons (grátis)
1. Crie conta em https://addons.opera.com/developer/ e envie o mesmo zip do Chromium.
2. Preencha descrição, categoria e imagens.

## Chrome Web Store (taxa única de US$ 5) - não listada
1. Registre-se em https://chrome.google.com/webstore/devconsole e pague a taxa.
2. "New item" -> envie `guitar-flash-bot-chromium-1.0.0.zip`.
3. Em "Distribution", escolha **Unlisted** (só quem tiver o link instala).
4. Preencha "Privacy practices" (single purpose, justificativas, "não coleta dados") usando LISTING.md.
5. Brave, Vivaldi e outros baseados em Chromium instalam pelo link da Chrome Web Store.

## Distribuir sem loja (grátis, qualquer Chromium)
Envie o zip do Chromium; a pessoa descompacta e usa chrome://extensions -> Modo do desenvolvedor -> "Carregar sem compactação".

## Atualizar
Aumente "version" em `extension/manifest.json`, rode `build.ps1` e envie o zip novo em cada loja.
