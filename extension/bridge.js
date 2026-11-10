// Isolated-world bridge between the page (gfbot.js) and the extension:
//  - relays Start/Stop from the popup to the bot,
//  - relays the bot's status to the popup,
//  - stores every play in the history (chrome.storage.local "history", newest last),
//  - queues it in the "outbox" for the anonymous statistics (background.js sends it, or drops it if they are off).
(function () {
  const HISTORY_MAX = 2000, OUTBOX_MAX = 500;
  const send = (enabled) => window.postMessage({ source: 'gfbot-ext', cmd: enabled ? 'start' : 'stop' }, location.origin);

  chrome.storage.local.get('enabled', (v) => send(!!v.enabled));
  // a game page opened: good moment to retry plays that could not be sent before
  try { chrome.runtime.sendMessage({ type: 'flush' }).catch(() => { }); } catch (e) { }
  chrome.storage.onChanged.addListener((ch) => { if (ch.enabled) send(!!ch.enabled.newValue); });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'gfbot-page') return;
    const d = e.data;
    if (d.type === 'status') chrome.storage.local.set({ status: Object.assign({ at: Date.now() }, d.status) });
    else if (d.type === 'ready') chrome.storage.local.get('enabled', (v) => send(!!v.enabled));
    else if (d.type === 'history' && d.entry && typeof d.entry === 'object') {
      chrome.storage.local.get({ history: [], outbox: [] }, (v) => {
        const h = Array.isArray(v.history) ? v.history : [];
        if (h.some((x) => x.id === d.entry.id)) return;
        h.push(d.entry);
        if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
        const o = Array.isArray(v.outbox) ? v.outbox : [];
        o.push(d.entry);
        if (o.length > OUTBOX_MAX) o.splice(0, o.length - OUTBOX_MAX);
        chrome.storage.local.set({ history: h, outbox: o });
      });
    }
  });
})();
