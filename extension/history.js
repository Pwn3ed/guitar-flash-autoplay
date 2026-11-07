const t = (k, subs) => chrome.i18n.getMessage(k, subs) || k;
const lang = chrome.i18n.getUILanguage();
const $ = (id) => document.getElementById(id);

document.title = t('historyTitle') + ' - ' + t('appName');
$('h-title').textContent = t('historyTitle');
$('h-sub').textContent = t('appName');
$('filter').placeholder = t('historySearch');
$('clear').textContent = t('historyClear');
$('credit').textContent = t('developedBy') + ' ';
$('credit').appendChild(Object.assign(document.createElement('b'), { textContent: 'pwn3ed' }));

// columns: key, label message, numeric?, cell renderer
const COLS = [
  ['startedAt', 'colDate', false, (e) => new Date(e.startedAt).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })],
  ['title', 'colSong', false, (e) => { const d = document.createElement('div'); d.className = 'song'; d.append(Object.assign(document.createElement('b'), { textContent: e.title || t('unknownSong') }), Object.assign(document.createElement('span'), { textContent: e.artist || '' })); return d; }],
  ['difficulty', 'colDifficulty', false, (e) => e.difficulty || ''],
  ['completed', 'colResult', false, (e) => Object.assign(document.createElement('span'), { className: 'pill ' + (e.completed ? 'ok' : 'bad'), textContent: e.completed ? t('resultCompleted') : t('resultIncomplete') })],
  ['percentage', 'colPercentage', true, (e) => { if (e.percentage == null) return '-'; const s = document.createElement('span'); s.textContent = e.percentage + '%'; if (e.percentage === 100 && !e.overstrums) s.className = 'pct100'; return s; }],
  ['notesHit', 'colHit', true, (e) => e.notesHit ?? '-'],
  ['notesMissed', 'colMissed', true, (e) => e.notesMissed ?? '-'],
  ['overstrums', 'colOverstrums', true, (e) => e.overstrums ?? '-'],
  ['maxCombo', 'colMaxCombo', true, (e) => e.maxCombo ?? '-'],
  ['score', 'colScore', true, (e) => e.score != null ? e.score.toLocaleString(lang) : '-'],
  ['special', 'colSpecial', true, (e) => e.special || '-'],
  ['presses', 'colPresses', true, (e) => e.presses ?? '-'],
  ['reached', 'colTime', true, (e) => fmt(e.reached) + (e.duration ? ' / ' + fmt(e.duration) : '')],
  ['pauses', 'colPauses', true, (e) => e.pauses ?? 0],
];
const fmt = (s) => s == null ? '-' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

let all = [], sortKey = 'startedAt', sortDir = -1;

function header() {
  const tr = document.createElement('tr');
  for (const [key, label, num] of COLS) {
    const th = document.createElement('th');
    th.textContent = t(label) + (sortKey === key ? (sortDir < 0 ? ' ▾' : ' ▴') : '');
    if (num) th.className = 'num';
    th.addEventListener('click', () => { if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = num ? -1 : 1; } render(); });
    tr.appendChild(th);
  }
  $('thead').replaceChildren(tr);
}

function card(k, v) { const d = document.createElement('div'); d.className = 'card'; d.append(Object.assign(document.createElement('div'), { className: 'k', textContent: k }), Object.assign(document.createElement('div'), { className: 'v', textContent: v })); return d; }

function render() {
  header();
  const q = $('filter').value.trim().toLowerCase();
  const rows = all.filter((e) => !q || ((e.title || '') + ' ' + (e.artist || '') + ' ' + (e.difficulty || '')).toLowerCase().includes(q));
  rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });

  const done = all.filter((e) => e.completed && e.percentage != null);
  const avg = done.length ? Math.round(done.reduce((s, e) => s + e.percentage, 0) / done.length * 10) / 10 : null;
  const perfect = done.filter((e) => e.percentage === 100 && !e.notesMissed && !e.overstrums).length;
  const notes = all.reduce((s, e) => s + (e.notesHit ?? e.presses ?? 0), 0);
  $('cards').replaceChildren(
    card(t('statPlays'), all.length.toLocaleString(lang)),
    card(t('statCompleted'), done.length.toLocaleString(lang)),
    card(t('statPerfect'), perfect.toLocaleString(lang)),
    card(t('statAverage'), avg == null ? '-' : avg + '%'),
    card(t('statNotes'), notes.toLocaleString(lang)),
  );

  const tb = $('tbody');
  if (!rows.length) {
    const td = Object.assign(document.createElement('td'), { colSpan: COLS.length, className: 'empty', textContent: all.length ? t('historyNoMatch') : t('historyEmpty') });
    const tr = document.createElement('tr'); tr.appendChild(td); tb.replaceChildren(tr); return;
  }
  tb.replaceChildren(...rows.map((e) => {
    const tr = document.createElement('tr');
    for (const [, , num, cell] of COLS) {
      const td = document.createElement('td'); if (num) td.className = 'num';
      const v = cell(e); if (v instanceof Node) td.appendChild(v); else td.textContent = String(v);
      tr.appendChild(td);
    }
    return tr;
  }));
}

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const FIELDS = ['startedAt', 'endedAt', 'title', 'artist', 'difficulty', 'mode', 'completed', 'percentage', 'notesHit', 'notesMissed', 'overstrums', 'maxCombo', 'score', 'special', 'presses', 'reached', 'duration', 'pauses'];
$('csv').addEventListener('click', () => {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [FIELDS.join(','), ...all.map((e) => FIELDS.map((f) => esc(e[f])).join(','))].join('\n');
  download('guitar-flash-bot-history.csv', 'text/csv', '﻿' + csv);
});
$('json').addEventListener('click', () => download('guitar-flash-bot-history.json', 'application/json', JSON.stringify(all, null, 2)));
$('clear').addEventListener('click', () => { if (all.length && confirm(t('historyClearConfirm'))) chrome.storage.local.set({ history: [] }); });
$('filter').addEventListener('input', render);

function load() { chrome.storage.local.get({ history: [] }, (v) => { all = Array.isArray(v.history) ? v.history : []; render(); }); }
chrome.storage.onChanged.addListener((ch) => { if (ch.history) load(); });
load();
