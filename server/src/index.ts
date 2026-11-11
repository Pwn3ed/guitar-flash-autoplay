// Guitar Flash Bot (GFB): recebe o resultado das partidas tocadas pelo bot e mostra o painel.
//   POST /v1/plays      uma partida (JSON ≤ 4 KB), aberto a qualquer origem (CORS *): a extensão manda daqui
//   GET  /health        {"ok":true} se o banco responde
//   GET  /privacidade   política de privacidade (store/PRIVACY.md), URL das lojas
//   GET  /painel        painel com senha (Basic; qualquer usuário, senha = segredo PAINEL_SENHA)
//   GET  /painel/partidas.csv, POST /painel/exportar
// Privacidade: o IP só serve para o limite de requisições, na hora; nada de IP, user-agent ou idioma é gravado.
import type { Env } from './env';
import { COLUNAS, Invalida, validar } from './validar';
import { csvPartidas, dadosPainel, htmlPainel } from './painel';
import { exportar } from './exportar';
import { htmlPrivacidade } from './privacidade';

const MAX_CORPO = 4096;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const SEGURANCA = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...SEGURANCA, ...extra } });

async function limitar(env: Env, req: Request, prefixo: string): Promise<boolean> {
  if (!env.LIMITE) return true;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'sem-ip';
  const { success } = await env.LIMITE.limit({ key: prefixo + ip });
  return success;
}

async function receberPartida(req: Request, env: Env): Promise<Response> {
  if (!(await limitar(env, req, 'p:'))) return json({ erro: 'muitas requisições' }, 429, { ...CORS, 'Retry-After': '60' });
  const tam = Number(req.headers.get('Content-Length') ?? 0);
  if (tam > MAX_CORPO) return json({ erro: 'corpo grande demais' }, 413, CORS);
  const bruto = await req.text();
  if (bruto.length > MAX_CORPO) return json({ erro: 'corpo grande demais' }, 413, CORS);
  let partida;
  try {
    partida = validar(JSON.parse(bruto));
  } catch (e) {
    return json({ erro: e instanceof Invalida ? `campo inválido: ${e.message}` : 'JSON inválido' }, 400, CORS);
  }
  const cols = ['received_at', ...COLUNAS];
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO plays (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(Date.now(), ...COLUNAS.map((c) => partida[c])).run();
  const nova = (r.meta.changes ?? 0) > 0;
  return json({ ok: true, nova }, nova ? 201 : 200, CORS);
}

async function senhaOk(req: Request, env: Env): Promise<boolean> {
  const senha = env.PAINEL_SENHA;
  const h = req.headers.get('Authorization') ?? '';
  if (!senha || !h.startsWith('Basic ')) return false;
  let dada = '';
  try { dada = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), (c) => c.charCodeAt(0))); } catch { return false; }
  dada = dada.slice(dada.indexOf(':') + 1);
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(dada)), crypto.subtle.digest('SHA-256', enc.encode(senha))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function painel(req: Request, env: Env, url: URL): Promise<Response> {
  if (!(await limitar(env, req, 'a:'))) return new Response('Muitas tentativas, espere um minuto.', { status: 429, headers: { 'Retry-After': '60' } });
  if (!(await senhaOk(req, env))) {
    return new Response('Senha necessária.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="GFB painel", charset="UTF-8"', ...SEGURANCA } });
  }
  const html = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', ...SEGURANCA };
  if (url.pathname === '/painel/partidas.csv' && req.method === 'GET') {
    const dia = new Date().toISOString().slice(0, 10);
    return new Response(await csvPartidas(env), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gfb-partidas-${dia}.csv"`, 'Cache-Control': 'no-store', ...SEGURANCA } });
  }
  if (url.pathname === '/painel/exportar' && req.method === 'POST') {
    // o navegador manda a senha guardada até em formulário de outro site: só aceita POST vindo do próprio painel
    // (Origin não serve: com Referrer-Policy no-referrer o próprio formulário manda "Origin: null")
    const site = req.headers.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') return new Response('Origem não permitida', { status: 403, headers: SEGURANCA });
    const r = await exportar(env);
    return new Response(htmlPainel(await dadosPainel(env), `Cópia salva no R2: ${r.chave} (${r.partidas} partidas).`), { headers: html });
  }
  if ((url.pathname === '/painel' || url.pathname === '/painel/') && req.method === 'GET') {
    return new Response(htmlPainel(await dadosPainel(env)), { headers: html });
  }
  return new Response('Não encontrado', { status: 404 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/v1/plays') {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        if (req.method === 'POST') return await receberPartida(req, env);
        return json({ erro: 'método não permitido' }, 405, { ...CORS, Allow: 'POST, OPTIONS' });
      }
      if (url.pathname === '/health') {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true });
      }
      if (url.pathname === '/privacidade' || url.pathname === '/privacy') {
        return new Response(htmlPrivacidade(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...SEGURANCA } });
      }
      if (url.pathname === '/painel' || url.pathname.startsWith('/painel/')) return await painel(req, env, url);
      if (url.pathname === '/') return new Response('Guitar Flash Bot', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SEGURANCA } });
      return new Response('Não encontrado', { status: 404 });
    } catch (e) {
      console.error('erro', e instanceof Error ? e.message : e);
      return json({ erro: 'erro interno' }, 500, url.pathname === '/v1/plays' ? CORS : {});
    }
  },

  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(exportar(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
