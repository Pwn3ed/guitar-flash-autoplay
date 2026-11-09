// Validação do que a extensão manda em POST /v1/plays. Campo desconhecido é ignorado; campo conhecido fora do
// formato recusa a partida inteira (a extensão só manda o que ela mesma montou, então isso é lixo ou ataque).

export interface Partida {
  install_id: string;
  play_id: string;
  version: string;
  started_at: number | null;
  ended_at: number | null;
  title: string | null;
  artist: string | null;
  difficulty: string | null;
  mode: string | null;
  duration: number | null;
  reached: number | null;
  completed: number;
  score: number | null;
  max_combo: number | null;
  percentage: number | null;
  notes_hit: number | null;
  overstrums: number | null;
  notes_missed: number | null;
  special: string | null;
  presses: number | null;
  pauses: number | null;
}

export const COLUNAS: (keyof Partida)[] = [
  'install_id', 'play_id', 'version', 'started_at', 'ended_at', 'title', 'artist', 'difficulty', 'mode', 'duration',
  'reached', 'completed', 'score', 'max_combo', 'percentage', 'notes_hit', 'overstrums', 'notes_missed', 'special',
  'presses', 'pauses',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAY_ID = /^[A-Za-z0-9-]{6,40}$/;
const VERSAO = /^\d{1,3}(\.\d{1,4}){1,3}$/;
const SPECIAL = /^\d{1,6}\/\d{1,6}$/;
const INICIO = Date.UTC(2025, 0, 1);

export class Invalida extends Error {}

function texto(v: unknown, campo: string): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new Invalida(campo);
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (s.length > 120) throw new Invalida(campo);
  return s || null;
}

function inteiro(v: unknown, campo: string, max: number): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw new Invalida(campo);
  return v;
}

function data(v: unknown, campo: string, agora: number): number | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 40) throw new Invalida(campo);
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < INICIO || t > agora + 86_400_000) throw new Invalida(campo);
  return t;
}

export function validar(corpo: unknown, agora = Date.now()): Partida {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Invalida('corpo');
  const c = corpo as Record<string, unknown>;
  if (typeof c.installId !== 'string' || !UUID.test(c.installId)) throw new Invalida('installId');
  if (typeof c.playId !== 'string' || !PLAY_ID.test(c.playId)) throw new Invalida('playId');
  if (typeof c.version !== 'string' || !VERSAO.test(c.version)) throw new Invalida('version');
  if (typeof c.completed !== 'boolean') throw new Invalida('completed');
  let pct: number | null = null;
  if (c.percentage != null) {
    if (typeof c.percentage !== 'number' || !Number.isFinite(c.percentage) || c.percentage < 0 || c.percentage > 100) throw new Invalida('percentage');
    pct = Math.round(c.percentage * 100) / 100;
  }
  let special: string | null = null;
  if (c.special != null && c.special !== '') {
    if (typeof c.special !== 'string' || !SPECIAL.test(c.special)) throw new Invalida('special');
    special = c.special;
  }
  return {
    install_id: c.installId.toLowerCase(),
    play_id: c.playId,
    version: c.version,
    started_at: data(c.startedAt, 'startedAt', agora),
    ended_at: data(c.endedAt, 'endedAt', agora),
    title: texto(c.title, 'title'),
    artist: texto(c.artist, 'artist'),
    difficulty: texto(c.difficulty, 'difficulty'),
    mode: texto(c.mode, 'mode'),
    duration: inteiro(c.duration, 'duration', 7200),
    reached: inteiro(c.reached, 'reached', 7200),
    completed: c.completed ? 1 : 0,
    score: inteiro(c.score, 'score', 1_000_000_000),
    max_combo: inteiro(c.maxCombo, 'maxCombo', 100_000),
    percentage: pct,
    notes_hit: inteiro(c.notesHit, 'notesHit', 100_000),
    overstrums: inteiro(c.overstrums, 'overstrums', 100_000),
    notes_missed: inteiro(c.notesMissed, 'notesMissed', 100_000),
    special,
    presses: inteiro(c.presses, 'presses', 200_000),
    pauses: inteiro(c.pauses, 'pauses', 10_000),
  };
}
