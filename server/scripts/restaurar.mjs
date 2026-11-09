#!/usr/bin/env node
// Transforma uma cópia do R2 (exports/plays-*.ndjson.gz) em SQL para voltar ao D1.
//   node scripts/restaurar.mjs plays-....ndjson.gz > restaurar.sql
//   npx wrangler d1 execute gfb --remote --file restaurar.sql
// Usa INSERT OR IGNORE: partida que já está no banco fica como está, então dá para rodar por cima de um banco com dados.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const arquivo = process.argv[2];
if (!arquivo) { console.error('uso: node scripts/restaurar.mjs <arquivo.ndjson.gz>'); process.exit(1); }
const bruto = readFileSync(arquivo);
const texto = (bruto[0] === 0x1f && bruto[1] === 0x8b ? gunzipSync(bruto) : bruto).toString('utf8');

const COLS = ['install_id', 'play_id', 'version', 'received_at', 'started_at', 'ended_at', 'title', 'artist', 'difficulty', 'mode',
  'duration', 'reached', 'completed', 'score', 'max_combo', 'percentage', 'notes_hit', 'overstrums', 'notes_missed', 'special',
  'presses', 'pauses'];
const sql = (v) => {
  if (v == null) return 'NULL';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('número inválido'); return String(v); }
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const linhas = texto.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const out = [];
for (let i = 0; i < linhas.length; i += 100) {
  const valores = linhas.slice(i, i + 100).map((l) => '(' + COLS.map((c) => sql(l[c])).join(', ') + ')');
  out.push(`INSERT OR IGNORE INTO plays (${COLS.join(', ')}) VALUES\n${valores.join(',\n')};`);
}
process.stdout.write(out.join('\n') + '\n');
console.error(`${linhas.length} partidas`);
