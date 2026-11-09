// Cópia de todas as partidas para o R2: um arquivo NDJSON (uma partida por linha, colunas do banco) compactado em
// gzip. Roda toda segunda pelo cron e sob demanda pelo painel. Guarda as 12 cópias mais novas.
// Para restaurar: scripts/restaurar.mjs <arquivo.ndjson.gz> gera o SQL para `wrangler d1 execute`.
import type { Env } from './env';

const PREFIXO = 'exports/';
const MANTER = 12;
const LOTE = 5000;

export async function exportar(env: Env, agora = new Date()): Promise<{ chave: string; partidas: number }> {
  const cs = new CompressionStream('gzip');
  const escritor = cs.writable.getWriter();
  const saida = new Response(cs.readable).arrayBuffer();
  const enc = new TextEncoder();
  let ultimo = 0, total = 0;
  for (;;) {
    const { results } = await env.DB.prepare('SELECT rowid AS _r, * FROM plays WHERE rowid > ? ORDER BY rowid LIMIT ?')
      .bind(ultimo, LOTE).all<Record<string, unknown> & { _r: number }>();
    if (!results.length) break;
    let bloco = '';
    for (const { _r, ...linha } of results) { bloco += JSON.stringify(linha) + '\n'; ultimo = _r; }
    await escritor.write(enc.encode(bloco));
    total += results.length;
    if (results.length < LOTE) break;
  }
  await escritor.close();
  const chave = `${PREFIXO}plays-${agora.toISOString().slice(0, 19).replace(/:/g, '-')}Z.ndjson.gz`;
  await env.BACKUP.put(chave, await saida, {
    httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
    customMetadata: { partidas: String(total) },
  });

  const antigos: string[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.BACKUP.list({ prefix: PREFIXO, cursor });
    antigos.push(...l.objects.map((o) => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  antigos.sort();
  const apagar = antigos.slice(0, Math.max(0, antigos.length - MANTER));
  if (apagar.length) await env.BACKUP.delete(apagar);
  return { chave, partidas: total };
}
