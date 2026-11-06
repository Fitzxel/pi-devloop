import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const popupScript = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');

function loadPopup({ tabs, messageResponses = [], messageError } = {}) {
  const elements = new Map();
  for (const selector of ['#toggle', '#status', '#status-dot', '#activation-title']) {
    elements.set(selector, {
      textContent: '', disabled: false, className: '',
      classList: { toggle() {}, remove() {} },
      addEventListener(_type, listener) { this.click = listener; },
    });
  }
  const messages = [];
  const chrome = {
    runtime: { lastError: null },
    tabs: {
      query(_query, callback) { callback(tabs ?? [{ id: 7 }]); },
      sendMessage(tabId, message, callback) {
        messages.push({ tabId, message });
        if (messageError) chrome.runtime.lastError = { message: messageError };
        callback(messageResponses.shift() ?? { active: true });
        chrome.runtime.lastError = null;
      },
    },
  };
  runInNewContext(popupScript, { document: { querySelector: (selector) => elements.get(selector) }, chrome });
  return { button: elements.get('#toggle'), status: elements.get('#status'), title: elements.get('#activation-title'), messages };
}

test('popup sends a toggle message to the active tab and reflects the returned state', () => {
  const popup = loadPopup({ messageResponses: [{ active: true }, { active: false }] });
  popup.button.click();
  assert.deepEqual(JSON.parse(JSON.stringify(popup.messages)), [{ tabId: 7, message: { type: 'devloop:toggle' } }]);
  assert.equal(popup.title.textContent, 'Selection activated');
  assert.equal(popup.status.textContent, 'Choose an element on the page to continue.');
  assert.equal(popup.button.textContent, 'Deactivate selection');
  assert.equal(popup.button.disabled, false);

  popup.button.click();
  assert.equal(popup.title.textContent, 'Selection paused');
  assert.equal(popup.button.textContent, 'Activate selection');
});

test('popup explains when the active page cannot receive activation', () => {
  const popup = loadPopup({ messageError: 'Could not establish connection.' });
  popup.button.click();
  assert.equal(popup.title.textContent, 'Page unavailable');
  assert.match(popup.status.textContent, /cannot receive the activation message/);
  assert.equal(popup.button.disabled, false);
});
