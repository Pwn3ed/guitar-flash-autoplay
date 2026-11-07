# Guitar Flash Autoplay

> Desenvolvido por **pwn3ed** · Licença [MIT](LICENSE)

Extensão de navegador que joga Guitar Flash (guitarflash.com) sozinha: acha as notas na tela, aperta as
teclas no momento certo (sincronizado com o relógio do vídeo do YouTube) e segura as notas longas.
Guarda um histórico de todas as músicas tocadas (acertos, erros, overstrums, combo, pontuação).
Funciona em Chrome, Edge, Brave, Opera e Firefox, em qualquer sistema (Windows, Linux, macOS).

## Como funciona
- **Visão:** depois de cada quadro desenhado, o bot lê só a faixa inferior do canvas WebGL do jogo, de forma
  assíncrona (pixel-pack buffer + fence), sem travar a placa de vídeo.
- **Tempo:** o jogo posiciona as notas pelo relógio do player do YouTube, em passos de 1/24 s (28 px por passo).
  Cada nota vista vira um horário exato de acerto, e a tecla é apertada quando o relógio do vídeo chega nele;
  por isso travadas e queda de FPS não atrasam os apertos.
- **Filtros:** notas novas precisam entrar pelo topo da pista (descarta ecos e brilhos dos acertos); o clarão branco
  do Special e as chamas dos acertos são reconhecidos para não esconder notas.
- **Pausa:** ao pausar, o bot solta as teclas e congela a agenda; ao voltar, reagenda as notas que ainda não passaram.

## Pastas

| Pasta / arquivo | O que é |
|---|---|
| `extension/` | **Código-fonte** da extensão (é aqui que se edita) |
| `build.ps1` / `build.sh` | Gera os pacotes das lojas em `dist/` e atualiza a pasta do instalador (Windows / Linux e macOS) |
| `dist/` | Pacotes para as lojas: `...-chromium-<versão>.zip` (Chrome, Edge, Opera) e `...-firefox-<versão>.zip` |
| `store/` | Material das lojas: textos (`LISTING.md`), privacidade (`PRIVACY.md`), guia de envio (`ENVIO.md`), imagens |
| `../guitar-flash-autoplay-INSTALADOR/` | **Instalador** pronto para Chrome/Edge/Brave, gerado pelo `build.ps1` (não editar) |

## Instalar (Chrome / Edge / Brave)
1. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolha a pasta `guitar-flash-autoplay-INSTALADOR`.

Sem build (ex. em outra máquina, só com `git clone`): dá para escolher direto a pasta `extension/` do repo;
o Chrome aceita o mesmo `manifest.json` sem avisos.

No Firefox: `about:debugging#/runtime/this-firefox` → **Carregar extensão temporária...** → escolha
`dist/guitar-flash-autoplay-firefox-<versão>.zip` (fica até fechar o Firefox; permanente só depois de assinada pela Mozilla).

## Usar
1. Clique no ícone → **START** (o ícone mostra "ON").
2. Abra uma música no guitarflash.com e aperte uma tecla para começar. O bot segue quando você troca de música.
3. **STOP** para parar. Fechar o navegador também para, e ele sempre abre desligado.

4. **Histórico de músicas** (botão no popup): tabela com todas as partidas, busca, exportação CSV/JSON.

Observações: a aba do jogo e a **janela do navegador** precisam ficar visíveis. Com a janela minimizada ou
coberta por outra, o navegador reduz a página a ~2 quadros por segundo e o bot não consegue jogar.
Se você estiver logado no site, as pontuações vão para o ranking.

## Depois de mudar o código
```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```
No Linux/macOS (precisa de `jq` e `zip`), o equivalente é:
```bash
./build.sh
```
Depois clique no botão de recarregar (↻) da extensão em `chrome://extensions`.
Para publicar uma atualização, aumente `version` em `extension/manifest.json` antes do build.

## Arquivos da extensão
- `manifest.json`: configuração (serve para Chrome e Firefox; o build ajusta cada um)
- `gfbot.js`: o bot (roda dentro da página do jogo)
- `bridge.js`: liga o botão START/STOP ao bot e grava o histórico
- `popup.html` / `popup.js`: a janelinha com o botão
- `history.html` / `history.js`: página do histórico de músicas
- `background.js`: deixa o bot desligado ao abrir o navegador e mostra "ON" no ícone
- `_locales/`: textos em português e inglês
- `icons/`: ícones
