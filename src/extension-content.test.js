import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const contentScript = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

function loadContentScript(storage) {
  const nodes = [];
  const listeners = [];
  const document = {
    documentElement: { append(node) { nodes.push(node); } },
    addEventListener() {},
    createElement(tagName) { return { tagName, style: {}, dataset: {}, remove() {}, addEventListener() {}, setAttribute() {} }; },
  };
  const context = {
    window: {},
    document,
    sessionStorage: storage,
    chrome: { runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } } },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  runInNewContext(contentScript, context);
  return { nodes, listeners };
}

test('automatically shows the Alt+Shift+E toast only once per tab session', () => {
  const values = new Map();
  const storage = { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };

  const firstLoad = loadContentScript(storage);
  const toast = firstLoad.nodes.find((node) => node.dataset?.piDevloopToast === 'true');
  assert.ok(toast, 'the initial page load should show a shortcut toast');
  assert.match(toast.textContent, /Alt\+Shift\+E/);

  const secondLoad = loadContentScript(storage);
  assert.equal(secondLoad.nodes.filter((node) => node.dataset?.piDevloopToast === 'true').length, 0);
});
