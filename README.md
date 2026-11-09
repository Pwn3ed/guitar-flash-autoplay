# Guitar Flash Bot

> Desenvolvido por **pwn3ed** · Licença [MIT](LICENSE)

Extensão de navegador que joga Guitar Flash (guitarflash.com) sozinha: acha as notas na tela, aperta as
teclas no momento certo (sincronizado com o relógio do vídeo do YouTube) e segura as notas longas.
Guarda um histórico de todas as músicas tocadas (acertos, erros, overstrums, combo, pontuação).
Funciona em Chrome, Edge, Brave, Opera e Firefox, em qualquer sistema (Windows, Linux, macOS).

## Como funciona
- **Leitura da cena:** o bot intercepta os dados que o jogo envia à placa de vídeo (WebGL `bufferSubData` /
  `drawElements`) e reconhece as notas pela região da textura (`notaN-v.png` no atlas do jogo). Nenhum pixel é lido,
  então chamas, clarões do Special e efeitos de acerto não escondem nada.
- **Tempo:** as notas ficam numa grade fixa, um passo por 1/24 s do relógio do jogo. Cada nota vira um horário exato
  de acerto, e a tecla é apertada quando o relógio chega nele; travadas e queda de FPS não atrasam os apertos.
- **Relógio do jogo:** o jogo tem relógio próprio, que fica alguns ms defasado do vídeo depois de travadas. O bot
  mede essa defasagem continuamente pelo movimento das notas na pista; enquanto o vídeo carrega (buffering), o
  relógio do jogo continua andando e o bot acompanha.
- **Notas longas:** o rastro da nota longa (triângulo de stencil + quad) dá o fim exato, inclusive em acordes de
  notas longas.
- **Identidade das notas:** cada nota é seguida de um quadro para o outro pela própria posição na pista (todas descem o
  mesmo número de passos), então um salto de relógio nunca transforma a mesma nota em duas.
- **Especial (espaço):** com o especial ativo o jogo desenha todas as notas com a mesma textura, por isso a corda de
  cada nota vem da posição dela na pista, não da cor.
- **Pausa (tecla P):** na volta da pausa o relógio do jogo pula ~60-70 ms. Para nenhuma nota ser perdida nesse salto,
  o bot segura a tecla P até uma brecha nas notas (normalmente uma fração de segundo, no máximo 5 s) e só então pausa
  o jogo. Em trechos muito rápidos, sem brecha, depois de 1 s ele aceita uma brecha menor e nunca pausa logo depois de
  apertar uma nota. Na volta ele reencontra as notas pelo deslocamento da pista e recalcula os horários com o relógio
  novo; uma nota apertada logo antes da pausa que ainda esteja no traste é apertada de novo.

## Limitações conhecidas
- **Black Widow Of La Porte (John 5), Expert, pausando muitas vezes:** com pausas a cada 5-9 s, o bot perdeu 4 notas
  (por volta de 3:54, 4:15, 4:18 e 4:57). A causa ainda não foi encontrada. Sem pausar, ou pausando de vez em quando,
  a música sai 100%.
- Pausas no meio de trechos muito rápidos são o único caso em que o bot ainda pode perder uma nota.

## Pastas

| Pasta / arquivo | O que é |
|---|---|
| `extension/` | **Código-fonte** da extensão (é aqui que se edita) |
| `build.ps1` / `build.sh` | Gera os pacotes das lojas em `dist/` e atualiza a pasta do instalador (Windows / Linux e macOS) |
| `dist/` | Pacotes para as lojas: `...-chromium-<versão>.zip` (Chrome, Edge, Opera) e `...-firefox-<versão>.zip` |
| `store/` | Material das lojas: textos (`LISTING.md`), privacidade (`PRIVACY.md`), guia de envio (`ENVIO.md`), imagens |
| `../guitar-flash-bot-INSTALADOR/` | **Instalador** pronto para Chrome/Edge/Brave, gerado pelo `build.ps1` (não editar) |

## Instalar (Chrome / Edge / Brave)
1. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolha a pasta `guitar-flash-bot-INSTALADOR`.

Sem build (ex. em outra máquina, só com `git clone`): dá para escolher direto a pasta `extension/` do repo;
o Chrome aceita o mesmo `manifest.json` sem avisos.

No Firefox: `about:debugging#/runtime/this-firefox` → **Carregar extensão temporária...** → escolha
`dist/guitar-flash-bot-firefox-<versão>.zip` (fica até fechar o Firefox; permanente só depois de assinada pela Mozilla).

## Usar
1. Clique no ícone → **START** (o ícone mostra "ON").
2. Abra uma música no guitarflash.com e aperte uma tecla (Enter) para começar. O bot segue quando você troca de música.
   Comece com o teclado, não com clique do mouse: o jogo pode contar o clique como um overstrum antes da primeira nota.
3. **STOP** para parar. Fechar o navegador também para, e ele sempre abre desligado.

4. **Histórico de músicas** (botão no popup): tabela com todas as partidas, busca, exportação CSV/JSON.

Observações: a aba do jogo e a **janela do navegador** precisam ficar visíveis. Com a janela minimizada ou
coberta por outra, o navegador reduz a página a ~2 quadros por segundo e o bot não consegue jogar.
Se você estiver logado no site, as pontuações vão para o ranking.

**Brave:** com a proteção contra fingerprinting dos Shields ligada (padrão do Brave), o guitarflash.com não consegue
carregar as notas e toda música termina na hora com 0 notas ("You Rock", Special 0/0), **mesmo sem a extensão**:
o jogo lê canvas/áudio antes de liberar as notas e o Brave altera essas leituras. Correção: no guitarflash.com, leão (Shields)
→ controles avançados → desativar o bloqueio de fingerprinting só para o site, e recarregar. O popup avisa quando detecta isso
(`fingerprintBlocked()` no `gfbot.js`).

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
