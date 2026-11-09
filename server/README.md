# Servidor do Guitar Flash Bot (GFB)

Cloudflare Worker + banco D1 que recebe o resultado das partidas tocadas pelo bot (de todas as instalações) e mostra
o painel. Não depende de VPS. No plano grátis da Cloudflare cabe com muita folga: 100 mil requisições/dia e 5 GB de banco.

- **Endereço:** https://gfb.pwn3ed.workers.dev. Fica na conta Cloudflare do token `~/.config/rondalarme/cloudflare.env`; o subdomínio da conta é `pwn3ed`.
- **Banco:** D1 `gfb` (id no `wrangler.jsonc`, região enam). Tabela única `plays`, ver `migrations/`.
- **Cópia:** toda segunda às 06:00 UTC o Worker grava todas as partidas em `gfb-backup/exports/plays-<data>.ndjson.gz`
  (R2) e guarda as 12 mais novas. Também dá para fazer na hora pelo botão do painel. O D1 ainda guarda 7 dias de
  Time Travel no plano grátis (`wrangler d1 time-travel`).
- **Senha do painel:** é o segredo `PAINEL_SENHA` do Worker. A cópia fica em `~/.config/pessoal/gfb.env`
  (`GFB_PAINEL_SENHA`). O navegador pede usuário e senha; qualquer usuário serve.

## Rotas

| Rota | O que faz |
|---|---|
| `POST /v1/plays` | Uma partida em JSON (≤ 4 KB), CORS `*`. 201 = gravou, 200 = já existia (reenvio), 400/413 = recusada, 429 = limite |
| `GET /health` | `{"ok":true}` se o banco responde |
| `GET /privacidade` | Política de privacidade (o próprio `../store/PRIVACY.md`). É a URL que vai nas lojas |
| `GET /painel` | Painel com números gerais, ranking de músicas, dificuldades, versões, partidas por dia e últimas partidas |
| `GET /painel/partidas.csv` | Todas as partidas em CSV |
| `POST /painel/exportar` | Faz a cópia no R2 agora |

Proteção contra lixo:
- valida tipo e tamanho de cada campo; campo desconhecido é ignorado;
- a chave é instalação + id da partida, então o reenvio não duplica;
- limite de 60 requisições por minuto por IP. O IP é usado só na hora e nunca é gravado.

Os logs do Worker estão desligados. Como a extensão é pública, alguém pode mandar dado falso: trate os números como
estatística, não como prova.

## Comandos

Os comandos abaixo rodam dentro de `server/`. O wrangler usa as variáveis do token:
`. ~/.config/rondalarme/cloudflare.env && export CLOUDFLARE_API_TOKEN=$CF_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$CF_ACCOUNT_ID`.

```bash
npm ci
teste npx vitest run --maxWorkers=2     # testes (rodam no workerd local, com D1/R2 de mentira)
teste npx tsc --noEmit
npx wrangler deploy                      # publica
npx wrangler d1 migrations apply gfb --remote   # migração nova em migrations/
npx wrangler dev --port 8799             # servidor local (antes: npx wrangler d1 migrations apply gfb --local)
```

### Restaurar de uma cópia

```bash
npx wrangler r2 object get gfb-backup/exports/plays-<data>.ndjson.gz --remote --file copia.ndjson.gz
node scripts/restaurar.mjs copia.ndjson.gz > restaurar.sql
npx wrangler d1 execute gfb --remote --file restaurar.sql   # INSERT OR IGNORE: pode rodar por cima
```

### Trocar a senha do painel

Gere uma senha nova e atualize `GFB_PAINEL_SENHA` em `~/.config/pessoal/gfb.env`. Depois rode:

```bash
grep '^GFB_PAINEL_SENHA=' ~/.config/pessoal/gfb.env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put PAINEL_SENHA
```
