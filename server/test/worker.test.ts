import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { validar } from '../src/validar';
import type { Env } from '../src/env';

const E = env as unknown as Env;
const SELF = (exports as any).default as Fetcher;

const INST = '3f2b8c1e-9d4a-4e6b-8a1f-2c3d4e5f6a7b';
const partida = (extra: Record<string, unknown> = {}) => ({
  installId: INST, playId: '1762700000000-ab12c', version: '1.3.0',
  title: 'Through The Fire And Flames', artist: 'DragonForce', difficulty: 'Expert', mode: 'Solo',
  duration: 441, startedAt: '2026-11-09T12:00:00.000Z', endedAt: '2026-11-09T12:07:21.000Z', completed: true, reached: 441,
  score: 812345, maxCombo: 1500, percentage: 99, notesHit: 3600, overstrums: 0, notesMissed: 22, special: '30/31', presses: 3650, pauses: 1,
  ...extra,
});
const post = (corpo: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch('https://gfb.test/v1/plays', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
const auth = (s: string) => ({ Authorization: 'Basic ' + btoa('diego:' + s) });

beforeEach(async () => { await E.DB.exec('DELETE FROM plays'); });

describe('POST /v1/plays', () => {
  it('grava a partida e responde CORS', async () => {
    const r = await post(partida());
    expect(r.status).toBe(201);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const l = await E.DB.prepare('SELECT * FROM plays').first<any>();
    expect(l).toMatchObject({ install_id: INST, title: 'Through The Fire And Flames', completed: 1, percentage: 99, special: '30/31', notes_missed: 22 });
    expect(l.started_at).toBe(Date.parse('2026-11-09T12:00:00.000Z'));
    expect(Math.abs(l.received_at - Date.now())).toBeLessThan(10_000);
  });

  it('reenvio da mesma partida não duplica', async () => {
    expect((await post(partida())).status).toBe(201);
    const r = await post(partida());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, nova: false });
    expect(await E.DB.prepare('SELECT COUNT(*) AS n FROM plays').first('n')).toBe(1);
  });

  it('mesmo playId de outra instalação é outra partida', async () => {
    await post(partida());
    expect((await post(partida({ installId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }))).status).toBe(201);
  });

  it('não grava nada além dos campos conhecidos', async () => {
    await post(partida({ email: 'x@y.z', nome: 'Fulano', userAgent: 'Mozilla' }), { 'CF-Connecting-IP': '203.0.113.9' });
    const l = await E.DB.prepare('SELECT * FROM plays').first<any>();
    expect(JSON.stringify(l)).not.toMatch(/x@y\.z|Fulano|Mozilla|203\.0\.113/);
  });

  it('partida interrompida sem resultado', async () => {
    const r = await post({ installId: INST, playId: 'abc123', version: '1.3.0', completed: false, reached: 30, presses: 80 });
    expect(r.status).toBe(201);
  });

  it('OPTIONS (preflight)', async () => {
    const r = await SELF.fetch('https://gfb.test/v1/plays', { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });

  it('recusa lixo', async () => {
    expect((await post('não é json')).status).toBe(400);
    expect((await post(partida({ installId: 'abc' }))).status).toBe(400);
    expect((await post(partida({ percentage: 150 }))).status).toBe(400);
    expect((await post(partida({ score: -1 }))).status).toBe(400);
    expect((await post(partida({ title: 'x'.repeat(200) }))).status).toBe(400);
    expect((await post(partida({ completed: 'sim' }))).status).toBe(400);
    expect((await post(partida({ startedAt: '2099-01-01T00:00:00Z' }))).status).toBe(400);
    expect((await post([partida()])).status).toBe(400);
    expect((await post(partida({ lixo: 'x'.repeat(5000) }))).status).toBe(413);
    expect((await SELF.fetch('https://gfb.test/v1/plays')).status).toBe(405);
    expect(await E.DB.prepare('SELECT COUNT(*) AS n FROM plays').first('n')).toBe(0);
  });
});

describe('validar', () => {
  it('limpa caracteres de controle e arredonda %', () => {
    const p = validar(partida({ title: ' A\nB\u0000 ', percentage: 98.765 }));
    expect(p.title).toBe('A B');
    expect(p.percentage).toBe(98.77);
  });
});

describe('/health e /', () => {
  it('responde', async () => {
    expect(await (await SELF.fetch('https://gfb.test/health')).json()).toEqual({ ok: true });
    expect((await SELF.fetch('https://gfb.test/')).status).toBe(200);
    expect((await SELF.fetch('https://gfb.test/outra')).status).toBe(404);
  });
});

describe('/privacidade', () => {
  it('serve a política das lojas', async () => {
    const r = await SELF.fetch('https://gfb.test/privacidade');
    expect(r.status).toBe(200);
    const h = await r.text();
    expect(h).toContain('<h1>Política de privacidade — Guitar Flash Bot</h1>');
    expect(h).toContain('<h1>Privacy policy — Guitar Flash Bot</h1>');
    expect(h).toContain('<strong>Não é enviado:</strong>');
    expect(h).toMatch(/<ul>\n<li>/);
    expect(h).not.toMatch(/guitarflash\.com/i);
  });
});

describe('/painel', () => {
  it('pede senha', async () => {
    const r = await SELF.fetch('https://gfb.test/painel');
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toContain('Basic');
    expect((await SELF.fetch('https://gfb.test/painel', { headers: auth('errada') })).status).toBe(401);
    expect((await SELF.fetch('https://gfb.test/painel/partidas.csv')).status).toBe(401);
    expect((await SELF.fetch('https://gfb.test/painel/exportar', { method: 'POST' })).status).toBe(401);
  });

  it('mostra o ranking e escapa HTML', async () => {
    await post(partida());
    await post(partida({ playId: 'segunda-1', percentage: 100, notesMissed: 0 }));
    await post(partida({ playId: 'terceira', installId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: '<script>alert(1)</script>', difficulty: 'Fácil', completed: false, percentage: null }));
    const r = await SELF.fetch('https://gfb.test/painel', { headers: auth('senha-de-teste') });
    expect(r.status).toBe(200);
    const h = await r.text();
    expect(h).toContain('Ranking de músicas');
    expect(h).toContain('Through The Fire And Flames');
    expect(h).not.toContain('<script>alert(1)');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toMatch(/Total de partidas<\/div><div class="v">3</);
    expect(h).toMatch(/Perfeitas<\/div><div class="v">1</);
  });

  it('painel vazio funciona', async () => {
    const r = await SELF.fetch('https://gfb.test/painel', { headers: auth('senha-de-teste') });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Nenhuma partida ainda');
  });

  it('CSV com todas as partidas', async () => {
    await post(partida());
    await post(partida({ playId: 'outra-1', title: 'Música, com "vírgula"' }));
    const r = await SELF.fetch('https://gfb.test/painel/partidas.csv', { headers: auth('senha-de-teste') });
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM para o Excel abrir acentos
    const t = new TextDecoder().decode(bytes);
    const linhas = t.trim().split('\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toMatch(/^received_at,/);
    expect(t).toContain('"Música, com ""vírgula"""');
    expect(t).toContain('2026-11-09T12:00:00.000Z');
  });
});

describe('cópia para o R2', () => {
  it('cron exporta tudo em NDJSON gzip e guarda só as 12 mais novas', async () => {
    for (let i = 0; i < 14; i++) await E.BACKUP.put(`exports/plays-2026-01-${String(i + 1).padStart(2, '0')}T00-00-00Z.ndjson.gz`, 'x');
    await post(partida());
    await post(partida({ playId: 'outra-1' }));
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 6 * * 1' }), E, ctx);
    await waitOnExecutionContext(ctx);
    const l = await E.BACKUP.list({ prefix: 'exports/' });
    expect(l.objects).toHaveLength(12);
    const nova = l.objects.map((o: R2Object) => o.key).sort().at(-1)!;
    expect(nova).toMatch(/^exports\/plays-20\d\d-/);
    const obj = await E.BACKUP.get(nova);
    const texto = await new Response(obj!.body.pipeThrough(new DecompressionStream('gzip'))).text();
    const linhas = texto.trim().split('\n').map((x: string) => JSON.parse(x));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ install_id: INST, title: 'Through The Fire And Flames' });
    expect(linhas[0]._r).toBeUndefined();
  });

  it('pelo painel', async () => {
    await post(partida());
    const r = await SELF.fetch('https://gfb.test/painel/exportar', { method: 'POST', headers: auth('senha-de-teste') });
    expect(await r.text()).toContain('Cópia salva no R2');
  });
});
