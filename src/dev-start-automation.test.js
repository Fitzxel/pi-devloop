import test from 'node:test';
import assert from 'node:assert/strict';
import { automateDevStart, runDevStart } from './dev-start-automation.js';

test('opens Chrome at a ready URL and returns browser mode and MCP endpoint with server state', async () => {
  let call;
  const result = await automateDevStart(
    { status: 'running', url: 'http://localhost:3000', pane_id: 'p1' },
    async (cwd, url) => { call = { cwd, url }; return { mode: 'managed', browserUrl: 'http://127.0.0.1:43127', serverName: 'pi-devloop-chrome' }; },
    '/project',
  );
  assert.deepEqual(call, { cwd: '/project', url: 'http://localhost:3000' });
  assert.deepEqual(result, {
    status: 'running', url: 'http://localhost:3000', pane_id: 'p1', browser: 'opened',
    browserMode: 'managed', browserUrl: 'http://127.0.0.1:43127', browserServerName: 'pi-devloop-chrome',
  });
});

test('skips browser launch and registration when ready URL is missing', async () => {
  let called = false;
  const result = await automateDevStart({ status: 'running' }, async () => { called = true; }, '/project');
  assert.equal(called, false);
  assert.deepEqual(result, { status: 'running', browser: 'skipped', browserReason: 'No ready URL was detected.' });
});

test('preserves successful server state when browser opening or MCP registration fails', async () => {
  const result = await automateDevStart(
    { status: 'running', url: 'http://localhost:3000', pane_id: 'p1' },
    async () => { throw new Error('registration failed'); },
    '/project',
  );
  assert.deepEqual(result, { status: 'running', url: 'http://localhost:3000', pane_id: 'p1', browser: 'error', browserError: 'registration failed' });
});

test('does not open a browser for a non-running server result', async () => {
  let called = false;
  const state = { status: 'stopped' };
  assert.equal(await automateDevStart(state, async () => { called = true; }, '/project'), state);
  assert.equal(called, false);
});

test('runDevStart starts the server then opens its ready URL through the shared tool flow', async () => {
  const events = [];
  const result = await runDevStart(
    async (cwd) => { events.push(['start', cwd]); return { status: 'running', pane_id: 'p1', url: 'http://127.0.0.1:4173' }; },
    async (cwd, url) => { events.push(['open', cwd, url]); return { mode: 'managed', browserUrl: 'http://127.0.0.1:43210', serverName: 'pi-devloop-chrome' }; },
    '/project',
  );
  assert.deepEqual(events, [
    ['start', '/project'],
    ['open', '/project', 'http://127.0.0.1:4173'],
  ]);
  assert.deepEqual(result, {
    status: 'running', pane_id: 'p1', url: 'http://127.0.0.1:4173', browser: 'opened',
    browserMode: 'managed', browserUrl: 'http://127.0.0.1:43210', browserServerName: 'pi-devloop-chrome',
  });
});
