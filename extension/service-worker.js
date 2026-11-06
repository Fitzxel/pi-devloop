// This file is replaced in the per-start extension copy with private configuration.
const CONFIG = globalThis.DEVLOOP_CONFIG ?? { endpoint: '', token: '' };

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !matchesTarget(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'devloop:toggle' });
  } catch {
    // A tab can navigate between the active-tab lookup and message delivery.
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'devloop:submit' || !sender.tab?.url || !matchesTarget(sender.tab.url)) return;
  fetch(CONFIG.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CONFIG.token}` },
    body: JSON.stringify(message.selection),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Feedback server returned ${response.status}`);
    respond({ ok: true });
  }).catch((error) => respond({ ok: false, error: error.message }));
  return true;
});

function matchesTarget(value) {
  const actual = new URL(value);
  const target = new URL(CONFIG.targetOrigin);
  return actual.origin === target.origin;
}
