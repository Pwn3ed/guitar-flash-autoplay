// Isolated-world bridge between the page (gfbot.js) and the extension:
//  - relays Start/Stop from the popup to the bot,
//  - relays the bot's status to the popup,
//  - stores every play in the history (chrome.storage.local "history", newest last),
//  - queues it in the "outbox" for the anonymous statistics (background.js sends it, or drops it if they are off).
(function () {
  const HISTORY_MAX = 2000, OUTBOX_MAX = 500;
  // Anything on the game page can post these messages, so keep only the known fields, with their types and a size cap
  // (no junk filling the extension storage or going to the statistics).
  const STR = { id: 40, startedAt: 30, endedAt: 30, title: 120, artist: 120, difficulty: 40, mode: 40, special: 20 };
  const NUM = ['duration', 'reached', 'score', 'maxCombo', 'percentage', 'notesHit', 'overstrums', 'notesMissed', 'presses', 'pauses'];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  function cleanEntry(x) {
    const e = {};
    for (const k in STR) if (typeof x[k] === 'string') e[k] = x[k].slice(0, STR[k]);
    for (const k of NUM) if (num(x[k])) e[k] = x[k];
    e.completed = x.completed === true;
    return e.id && e.startedAt ? e : null;
  }
  function cleanStatus(x) {
    const s = { at: Date.now() };
    for (const k of ['running', 'attached', 'fpBlocked', 'paused']) s[k] = x[k] === true;
    s.presses = num(x.presses) ? x.presses : 0;
    for (const k of ['song', 'difficulty', 'songTime']) s[k] = typeof x[k] === 'string' ? x[k].slice(0, 250) : '';
    return s;
  }
  const send = (enabled) => window.postMessage({ source: 'gfbot-ext', cmd: enabled ? 'start' : 'stop' }, location.origin);

  chrome.storage.local.get('enabled', (v) => send(!!v.enabled));
  // a game page opened: good moment to retry plays that could not be sent before
  try { chrome.runtime.sendMessage({ type: 'flush' }).catch(() => { }); } catch (e) { }
  chrome.storage.onChanged.addListener((ch) => { if (ch.enabled) send(!!ch.enabled.newValue); });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'gfbot-page') return;
    const d = e.data;
    if (d.type === 'status' && d.status && typeof d.status === 'object') chrome.storage.local.set({ status: cleanStatus(d.status) });
    else if (d.type === 'ready') chrome.storage.local.get('enabled', (v) => send(!!v.enabled));
    else if (d.type === 'history' && d.entry && typeof d.entry === 'object') {
      const entry = cleanEntry(d.entry);
      if (!entry) return;
      chrome.storage.local.get({ history: [], outbox: [] }, (v) => {
        const h = Array.isArray(v.history) ? v.history : [];
        if (h.some((x) => x.id === entry.id)) return;
        h.push(entry);
        if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
        const o = Array.isArray(v.outbox) ? v.outbox : [];
        o.push(entry);
        if (o.length > OUTBOX_MAX) o.splice(0, o.length - OUTBOX_MAX);
        chrome.storage.local.set({ history: h, outbox: o });
      });
    }
  });
})();
