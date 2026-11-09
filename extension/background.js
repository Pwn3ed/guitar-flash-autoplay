// Always start switched OFF when the browser opens ("closing stops it").
chrome.runtime.onStartup.addListener(() => { chrome.storage.local.set({ enabled: false, status: null }); flush(); });
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set({ enabled: false, status: null }));

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1f9d55' });
}
chrome.storage.onChanged.addListener((ch) => { if (ch.enabled) updateBadge(ch.enabled.newValue); });
chrome.storage.local.get('enabled', (v) => updateBadge(!!v.enabled));

// ---- anonymous statistics: each finished play goes to the GFB server ----
// bridge.js puts every play in the "outbox"; this sends them one by one and keeps whatever failed for the next try
// (a new play, a game page load or the browser starting). Sent: the play's result, a random install id and the
// extension version. Never sent: name, login, e-mail, browser settings. The server does not keep the IP.
// Chromium: on by default, switch in the popup ("shareStats"). Firefox: the optional "technicalAndInteraction" data
// permission is the switch (the user can also change it in the add-ons manager).
const API = 'https://gfb.pwn3ed.workers.dev/v1/plays';
const IS_FIREFOX = chrome.runtime.getURL('').startsWith('moz-extension:');

async function sharingOn() {
  if (IS_FIREFOX) {
    try { return await browser.permissions.contains({ data_collection: ['technicalAndInteraction'] }); } catch (e) { return false; }
  }
  const v = await chrome.storage.local.get('shareStats');
  return v.shareStats !== false;
}

async function installId() {
  const v = await chrome.storage.local.get('installId');
  if (v.installId) return v.installId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ installId: id });
  return id;
}

function payload(e, id, version) {
  return {
    installId: id, playId: String(e.id), version,
    title: e.title, artist: e.artist, difficulty: e.difficulty, mode: e.mode, duration: e.duration,
    startedAt: e.startedAt, endedAt: e.endedAt, completed: !!e.completed, reached: e.reached,
    score: e.score, maxCombo: e.maxCombo, percentage: e.percentage, notesHit: e.notesHit, overstrums: e.overstrums,
    notesMissed: e.notesMissed, special: e.special, presses: e.presses, pauses: e.pauses,
  };
}

let flushing = false, pending = false;
async function flush() {
  if (flushing) { pending = true; return; }
  flushing = true;
  try {
    do {
      pending = false;
      const { outbox } = await chrome.storage.local.get({ outbox: [] });
      if (!Array.isArray(outbox) || !outbox.length) return;
      if (!(await sharingOn())) { await chrome.storage.local.set({ outbox: [] }); return; }
      const id = await installId(), version = chrome.runtime.getManifest().version;
      const done = new Set();
      let failed = false;
      for (const e of outbox.slice(0, 50)) {
        let r = null;
        try {
          r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(e, id, version)) });
        } catch (err) { }
        // 2xx = stored (or already there); other 4xx = the server will never take it, so drop it; else try later
        if (r && (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429))) done.add(e.id);
        else { failed = true; break; }
      }
      if (done.size) {
        const cur = (await chrome.storage.local.get({ outbox: [] })).outbox;
        await chrome.storage.local.set({ outbox: (Array.isArray(cur) ? cur : []).filter((x) => !done.has(x.id)) });
      }
      if (!failed && outbox.length > 50) pending = true;
      if (failed) return;
    } while (pending);
  } finally { flushing = false; }
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  // only when a play was added: our own removals must not start a new round (no busy retry while offline)
  if (ch.outbox && (ch.outbox.newValue || []).length > (ch.outbox.oldValue || []).length) flush();
  if (ch.shareStats && ch.shareStats.newValue === false) chrome.storage.local.set({ outbox: [] });
});
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'flush') flush(); });
