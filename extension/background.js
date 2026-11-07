// Always start switched OFF when the browser opens ("closing stops it").
chrome.runtime.onStartup.addListener(() => chrome.storage.local.set({ enabled: false, status: null }));
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set({ enabled: false, status: null }));

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1f9d55' });
}
chrome.storage.onChanged.addListener((ch) => { if (ch.enabled) updateBadge(ch.enabled.newValue); });
chrome.storage.local.get('enabled', (v) => updateBadge(!!v.enabled));
