const t = (k, subs) => chrome.i18n.getMessage(k, subs) || k;
const btn = document.getElementById('toggle');
const st = document.getElementById('status');
const warn = document.getElementById('warn');
document.getElementById('title').textContent = t('appName');
document.getElementById('hint').textContent = t('hint');
document.getElementById('rank').textContent = t('rankNote');
document.getElementById('history').textContent = t('historyButton');
const credit = document.getElementById('credit');
credit.textContent = t('developedBy') + ' ';
credit.appendChild(Object.assign(document.createElement('b'), { textContent: 'pwn3ed' }));
let enabled = false;

function line(label, value) { const d = document.createElement('div'); d.textContent = label + ': '; const b = document.createElement('b'); b.textContent = value; d.appendChild(b); return d; }

function render(status) {
  // Brave fingerprinting protection on: the game cannot load the notes (see gfbot.js fingerprintBlocked)
  warn.hidden = !(status && status.fpBlocked);
  if (!warn.hidden) warn.textContent = t('braveFpFix');
  btn.textContent = enabled ? t('stop') : t('start');
  btn.className = enabled ? 'stop' : 'start';
  st.replaceChildren();
  if (!enabled) { st.textContent = t('off'); return; }
  const fresh = status && Date.now() - status.at < 4000;
  if (!fresh) { st.textContent = t('onOpenSite'); return; }
  if (!status.attached) { st.textContent = t('onWaiting'); return; }
  st.appendChild(line(status.paused ? t('paused') : t('playing'), status.song || t('unknownSong')));
  if (status.difficulty) st.appendChild(line(t('difficulty'), status.difficulty));
  st.appendChild(line(t('notes'), String(status.presses)));
  if (status.songTime) st.appendChild(line(t('time'), status.songTime));
}

chrome.storage.local.get(['enabled', 'status'], (v) => { enabled = !!v.enabled; render(v.status); });
chrome.storage.onChanged.addListener((ch) => {
  if (ch.enabled) enabled = !!ch.enabled.newValue;
  if (ch.enabled || ch.status) chrome.storage.local.get('status', (v) => render(v.status));
});
// ---- anonymous statistics switch (see background.js). Explained once with "Got it", then behind the "?" ----
const IS_FIREFOX = chrome.runtime.getURL('').startsWith('moz-extension:');
const FF_DATA = { data_collection: ['technicalAndInteraction'] };
const share = document.getElementById('share'), note = document.getElementById('statsNote');
document.getElementById('shareLabel').textContent = t('statsToggle');
document.getElementById('statsTitle').textContent = t('statsToggle');
document.getElementById('statsText').textContent = t('statsText');
document.getElementById('statsOk').textContent = t('statsOk');
async function loadShare() {
  if (IS_FIREFOX) { try { share.checked = await browser.permissions.contains(FF_DATA); } catch (e) { share.checked = false; share.disabled = true; } }
  else share.checked = (await chrome.storage.local.get('shareStats')).shareStats !== false;
}
loadShare();
chrome.storage.local.get('statsNoticeSeen', (v) => { note.hidden = !!v.statsNoticeSeen; });
document.getElementById('statsOk').addEventListener('click', () => { note.hidden = true; chrome.storage.local.set({ statsNoticeSeen: true }); });
document.getElementById('statsInfo').addEventListener('click', (e) => { e.preventDefault(); note.hidden = !note.hidden; });
share.addEventListener('change', () => {
  if (!IS_FIREFOX) { chrome.storage.local.set({ shareStats: share.checked }); return; }
  // Firefox: the data permission itself is the switch (the request must come straight from the click)
  const p = share.checked ? browser.permissions.request(FF_DATA) : browser.permissions.remove(FF_DATA).then(() => false);
  p.then(loadShare, loadShare);
});
btn.addEventListener('click', () => chrome.storage.local.set({ enabled: !enabled }));
document.getElementById('history').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }));
