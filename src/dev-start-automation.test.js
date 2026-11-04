import test from 'node:test';
import assert from 'node:assert/strict';
import { automateDevStart } from './dev-start-automation.js';

test('registers browser for a ready URL and preserves state with navigation guidance', async () => {
  let cwdSeen;
  const result = await automateDevStart({ status: 'running', url: 'http://localhost:3000', pane_id: 'p1' }, async (cwd) => { cwdSeen = cwd; return {}; }, '/project');
  assert.equal(cwdSeen, '/project');
  assert.deepEqual(result, { status: 'running', url: 'http://localhost:3000', pane_id: 'p1', browser: 'registered', guidance: 'Use the pi-devloop-chrome browser tools to navigate to http://localhost:3000.' });
});

test('skips registration when ready URL is missing', async () => {
  let called = false;
  const result = await automateDevStart({ status: 'running' }, async () => { called = true; }, '/project');
  assert.equal(called, false);
  assert.deepEqual(result, { status: 'running', browser: 'skipped', guidance: 'Browser opening skipped because the dev server has no ready URL.' });
});

test('preserves successful server state when browser registration fails', async () => {
  const result = await automateDevStart({ status: 'running', url: 'http://localhost:3000' }, async () => { throw new Error('registration failed'); }, '/project');
  assert.deepEqual(result, { status: 'running', url: 'http://localhost:3000', browser: 'error', browserError: 'registration failed', guidance: 'Retry browser registration with browser_connect, then navigate to http://localhost:3000.' });
});
