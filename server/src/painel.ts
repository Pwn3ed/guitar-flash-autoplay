// Painel do Diego (/painel, com senha): números gerais, ranking das músicas, dificuldades, versões, partidas por dia
// e últimas partidas. HTML gerado aqui mesmo, sem JS. Horários em Brasília (UTC-3, sem horário de verão).
import type { Env } from './env';

const BR = -3 * 3600_000;
const DIA = 86_400_000;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (v: unknown) => (v == null ? '-' : Number(v).toLocaleString('pt-BR'));
const pct = (v: unknown) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const quando = (ms: unknown) => (ms == null ? '-' : new Date(Number(ms)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }));
const tempo = (s: unknown) => (s == null ? '-' : `${Math.floor(Number(s) / 60)}:${String(Number(s) % 60).padStart(2, '0')}`);

type Linha = Record<string, any>;

export async function dadosPainel(env: Env, agora = Date.now()) {
  // início de hoje em Brasília, em epoch ms
  const hoje = Math.floor((agora + BR) / DIA) * DIA - BR;
  const q = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b);
  const [geral, musicas, dificuldades, versoes, dias, ultimas] = await env.DB.batch<Linha>([
    q(`SELECT
         COUNT(*) AS total,
         SUM(received_at >= ?1) AS hoje, SUM(received_at >= ?2) AS d7, SUM(received_at >= ?3) AS d30,
         COUNT(DISTINCT install_id) AS inst_total,
         COUNT(DISTINCT CASE WHEN received_at >= ?2 THEN install_id END) AS inst7,
         COUNT(DISTINCT CASE WHEN received_at >= ?3 THEN install_id END) AS inst30,
         COUNT(DISTINCT CASE WHEN received_at >= ?1 THEN install_id END) AS inst_hoje,
         SUM(completed) AS completas,
         AVG(CASE WHEN completed AND percentage IS NOT NULL THEN percentage END) AS media,
         SUM(completed AND percentage = 100 AND COALESCE(overstrums, 0) = 0 AND COALESCE(notes_missed, 0) = 0) AS perfeitas,
         SUM(COALESCE(notes_hit, 0)) AS notas,
         COUNT(DISTINCT title || '|' || COALESCE(artist, '')) AS musicas
       FROM plays`, hoje, agora - 7 * DIA, agora - 30 * DIA),
    q(`SELECT title, artist, COUNT(*) AS partidas, COUNT(DISTINCT install_id) AS pessoas, SUM(completed) AS completas,
         AVG(CASE WHEN completed THEN percentage END) AS media, MAX(CASE WHEN completed THEN percentage END) AS melhor,
         SUM(completed AND percentage = 100 AND COALESCE(overstrums, 0) = 0 AND COALESCE(notes_missed, 0) = 0) AS perfeitas,
         MAX(score) AS recorde, MAX(received_at) AS ultima
       FROM plays WHERE title IS NOT NULL GROUP BY title, artist ORDER BY partidas DESC, media DESC LIMIT 100`),
    q(`SELECT COALESCE(difficulty, '?') AS nome, COUNT(*) AS partidas, AVG(CASE WHEN completed THEN percentage END) AS media,
         SUM(completed) AS completas
       FROM plays GROUP BY nome ORDER BY partidas DESC`),
    q(`SELECT version AS nome, COUNT(*) AS partidas, COUNT(DISTINCT install_id) AS pessoas,
         AVG(CASE WHEN completed THEN percentage END) AS media, MAX(received_at) AS ultima
       FROM plays GROUP BY version ORDER BY ultima DESC LIMIT 20`),
    q(`SELECT date((received_at + ?1) / 1000, 'unixepoch') AS dia, COUNT(*) AS partidas, COUNT(DISTINCT install_id) AS pessoas
       FROM plays WHERE received_at >= ?2 GROUP BY dia ORDER BY dia`, BR, hoje - 29 * DIA),
    q(`SELECT received_at, title, artist, difficulty, completed, percentage, notes_hit, notes_missed, overstrums, score,
         reached, duration, version, substr(install_id, 1, 8) AS inst
       FROM plays ORDER BY received_at DESC LIMIT 50`),
  ]);
  return {
    geral: geral.results[0] ?? {}, musicas: musicas.results, dificuldades: dificuldades.results,
    versoes: versoes.results, dias: dias.results, ultimas: ultimas.results, hoje,
  };
}

function tabela(cab: [string, boolean?][], linhas: string[][], vazio = 'Nenhuma partida ainda.') {
  if (!linhas.length) return `<p class="vazio">${vazio}</p>`;
  const th = cab.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${t}</th>`).join('');
  const tr = linhas.map((l) => '<tr>' + l.map((c, i) => `<td${cab[i]?.[1] ? ' class="n"' : ''}>${c}</td>`).join('') + '</tr>').join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

export function htmlPainel(d: Awaited<ReturnType<typeof dadosPainel>>, aviso = '') {
  const g = d.geral;
  const card = (k: string, v: string, s = '') => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const musica = (l: Linha) => `<b>${esc(l.title)}</b><span>${esc(l.artist)}</span>`;

  // partidas por dia: últimos 30 dias, inclusive os sem partida
  const porDia = new Map(d.dias.map((l) => [l.dia, l]));
  const dias: { dia: string; partidas: number; pessoas: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const dia = new Date(d.hoje - i * DIA - BR).toISOString().slice(0, 10);
    const l = porDia.get(dia);
    dias.push({ dia, partidas: l?.partidas ?? 0, pessoas: l?.pessoas ?? 0 });
  }
  const maxDia = Math.max(1, ...dias.map((x) => x.partidas));
  const barras = dias.map((x) => `<div class="b" title="${x.dia.split('-').reverse().join('/')}: ${x.partidas} partidas, ${x.pessoas} pessoas"><i style="height:${Math.round((x.partidas / maxDia) * 100)}%"></i></div>`).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GFB · Painel</title><meta name="robots" content="noindex">
<style>
:root{--bg:#111115;--p:#1a1a20;--l:#2a2a33;--f:#ececf1;--m:#9a9aa8;--ok:#2fbf71;--a:#4c8dff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--f);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:16px;border-bottom:1px solid var(--l)}
h1{margin:0;font-size:19px}h1 span{color:var(--m);font-weight:400;font-size:13px;margin-left:6px}
h2{font-size:15px;margin:28px 0 10px}main{padding:16px;max-width:1300px;margin:0 auto}
.acoes{display:flex;gap:8px}.acoes a,.acoes button{padding:7px 12px;border-radius:8px;border:1px solid var(--l);background:var(--p);color:var(--f);font:inherit;font-size:13px;text-decoration:none;cursor:pointer}
.aviso{background:var(--p);border:1px solid var(--a);border-radius:10px;padding:10px 12px;margin-bottom:14px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px}
.card{background:var(--p);border:1px solid var(--l);border-radius:12px;padding:12px 14px}.k{color:var(--m);font-size:12px}
.v{font-size:22px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}.s{color:var(--m);font-size:12px}
.dias{display:flex;align-items:flex-end;gap:3px;height:110px;background:var(--p);border:1px solid var(--l);border-radius:12px;padding:10px}
.b{flex:1;height:100%;display:flex;align-items:flex-end}.b i{display:block;width:100%;min-height:2px;background:var(--a);border-radius:3px 3px 0 0}
.eixo{display:flex;justify-content:space-between;color:var(--m);font-size:11px;margin-top:4px}
.tw{overflow-x:auto;border:1px solid var(--l);border-radius:12px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--l);white-space:nowrap}th{background:var(--p);color:var(--m);font-size:12px;font-weight:600}
.n{text-align:right}tr:last-child td{border-bottom:0}td b{display:block}td span{color:var(--m);font-size:12px}
.pos{color:var(--m)}.top td:first-child{color:var(--ok);font-weight:700}.ok{color:var(--ok)}.bad{color:#e5534b}
.duas{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 16px}.vazio{color:var(--m)}
footer{text-align:center;color:var(--m);font-size:12px;padding:24px}
</style></head><body>
<header><h1>Guitar Flash Bot<span>painel</span></h1><div class="acoes"><a href="/painel/partidas.csv">CSV</a>
<form method="post" action="/painel/exportar"><button>Cópia no R2 agora</button></form></div></header>
<main>${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
<div class="cards">
${card('Partidas hoje', num(g.hoje), `${num(g.inst_hoje)} pessoas`)}
${card('Últimos 7 dias', num(g.d7), `${num(g.inst7)} pessoas`)}
${card('Últimos 30 dias', num(g.d30), `${num(g.inst30)} pessoas`)}
${card('Total de partidas', num(g.total), `${num(g.inst_total)} instalações`)}
${card('Acerto médio', pct(g.media), `${num(g.completas)} completas`)}
${card('Perfeitas', num(g.perfeitas), '100% sem erro')}
${card('Músicas diferentes', num(g.musicas))}
${card('Notas acertadas', num(g.notas))}
</div>
<h2>Partidas por dia (30 dias)</h2><div class="dias">${barras}</div>
<div class="eixo"><span>${dias[0].dia.split('-').reverse().slice(0, 2).join('/')}</span><span>hoje</span></div>
<h2>Ranking de músicas</h2>
${tabela([['#'], ['Música'], ['Partidas', true], ['Pessoas', true], ['Completas', true], ['Média', true], ['Melhor', true], ['Perfeitas', true], ['Recorde', true], ['Última']],
  d.musicas.map((l, i) => [String(i + 1), musica(l), num(l.partidas), num(l.pessoas), num(l.completas), pct(l.media), pct(l.melhor), num(l.perfeitas), num(l.recorde), quando(l.ultima)]))}
<div class="duas"><div><h2>Por dificuldade</h2>
${tabela([['Dificuldade'], ['Partidas', true], ['Completas', true], ['Média', true]], d.dificuldades.map((l) => [esc(l.nome), num(l.partidas), num(l.completas), pct(l.media)]))}
</div><div><h2>Por versão</h2>
${tabela([['Versão'], ['Partidas', true], ['Pessoas', true], ['Média', true], ['Última']], d.versoes.map((l) => [esc(l.nome), num(l.partidas), num(l.pessoas), pct(l.media), quando(l.ultima)]))}
</div></div>
<h2>Últimas partidas</h2>
${tabela([['Quando'], ['Música'], ['Dificuldade'], ['Resultado'], ['%', true], ['Acertos', true], ['Perdidas', true], ['Overstrums', true], ['Pontos', true], ['Tempo', true], ['Versão'], ['Instalação']],
  d.ultimas.map((l) => [quando(l.received_at), musica(l), esc(l.difficulty), l.completed ? '<span class="ok">Concluída</span>' : '<span class="bad">Interrompida</span>', pct(l.percentage), num(l.notes_hit), num(l.notes_missed), num(l.overstrums), num(l.score), `${tempo(l.reached)}${l.duration ? ' / ' + tempo(l.duration) : ''}`, esc(l.version), `<code>${esc(l.inst)}</code>`]))}
</main><footer>Dados anônimos: só o resultado de cada partida e um id aleatório por instalação.</footer></body></html>`;
}

const CSV_COLS = ['received_at', 'started_at', 'ended_at', 'install_id', 'play_id', 'version', 'title', 'artist', 'difficulty', 'mode',
  'completed', 'percentage', 'notes_hit', 'notes_missed', 'overstrums', 'max_combo', 'score', 'special', 'presses', 'reached', 'duration', 'pauses'];

export async function csvPartidas(env: Env): Promise<string> {
  const iso = (v: unknown) => (v == null ? '' : new Date(Number(v)).toISOString());
  // qualquer um pode mandar partida: texto começando com = + - @ viraria fórmula no Excel/LibreOffice, então leva um '
  const cel = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n;\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const linhas = [CSV_COLS.join(',')];
  let ultimo = 0;
  for (;;) {
    const { results } = await env.DB.prepare(`SELECT rowid AS _r, ${CSV_COLS.join(', ')} FROM plays WHERE rowid > ? ORDER BY rowid LIMIT 5000`).bind(ultimo).all<Linha>();
    for (const l of results) {
      ultimo = l._r;
      linhas.push(CSV_COLS.map((c) => cel(c.endsWith('_at') ? iso(l[c]) : l[c])).join(','));
    }
    if (results.length < 5000) break;
  }
  return '﻿' + linhas.join('\n') + '\n';
}
