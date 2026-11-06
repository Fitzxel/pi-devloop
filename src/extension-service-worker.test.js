import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const serviceWorker = await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8');

test('Alt+Shift+E toggles the overlay only in the configured dev-server tab', async () => {
  const commandListeners = [];
  const messages = [];
  const tab = { id: 12, url: 'http://localhost:3000/page' };
  const chrome = {
    action: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener(listener) { commandListeners.push(listener); } } },
    runtime: { id: 'extension-id', onMessage: { addListener() {} } },
    tabs: {
      async query(query) { assert.equal(query.active, true); assert.equal(query.lastFocusedWindow, true); return [tab]; },
      async sendMessage(tabId, message) { messages.push([tabId, message]); },
    },
    scripting: { async executeScript() {} },
  };
  const context = {
    DEVLOOP_CONFIG: { endpoint: 'http://127.0.0.1:43200/selection', token: 'secret', targetOrigin: 'http://localhost:3000' },
    chrome,
    URL,
    fetch,
  };
  runInNewContext(serviceWorker, context);

  assert.equal(commandListeners.length, 1);
  await commandListeners[0]('toggle-overlay');
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 12);
  assert.equal(messages[0][1].type, 'devloop:toggle');

  messages.length = 0;
  tab.url = 'http://localhost:4000/page';
  await commandListeners[0]('toggle-overlay');
  assert.equal(messages.length, 0);
});
