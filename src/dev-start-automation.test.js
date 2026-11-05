import test from 'node:test';
import assert from 'node:assert/strict';
import { automateDevStart, createDevStartManager, registerDevStartCommand, runDevStart } from './dev-start-automation.js';

test('running start is idempotent and stopped start creates a fresh run and extension config', async () => {
  let starts = 0;
  let opens = 0;
  let alive = true;
  let paneClosures = 0;
  const manager = createDevStartManager({
    startServer: async () => ({ status: 'running', url: 'http://localhost:3000', pane_id: `p${++starts}` }),
    isAlive: async () => alive,
    stopServer: async () => { paneClosures++; },
    openBrowser: async (_cwd, _url, config) => { opens++; assert.equal(config.token, `token-${starts}`); return { mode: 'managed', browserUrl: 'http://127.0.0.1:43127' }; },
    createToken: () => `token-${starts + 1}`,
  });
  const first = await manager.start('/project');
  const repeated = await manager.start('/project');
  assert.equal(first.status, 'running');
  assert.equal(repeated.pane_id, first.pane_id);
  assert.equal(starts, 1);
  assert.equal(opens, 1);
  alive = false;
  const restarted = await manager.start('/project');
  assert.equal(restarted.pane_id, 'p2');
  assert.equal(starts, 2);
  assert.equal(opens, 2);
  assert.equal(paneClosures, 1);
});

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

test('registered /devloop:start opens Chrome after start and notifies the command result', async () => {
  const events = [];
  const notifications = [];
  const commands = [];
  const pi = { registerCommand: (name, command) => commands.push({ name, ...command }) };
  registerDevStartCommand(
    pi,
    async (cwd) => { events.push(['start', cwd]); return { status: 'running', pane_id: 'p1', url: 'http://127.0.0.1:4173' }; },
    async (cwd, url) => { events.push(['open', cwd, url]); return { mode: 'managed', browserUrl: 'http://127.0.0.1:43210', serverName: 'pi-devloop-chrome' }; },
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'devloop:start');
  assert.match(commands[0].description, /open the ready URL in Chrome/);

  const ctx = { cwd: '/project', ui: { notify: (message, type) => notifications.push({ message, type }) } };
  const result = await commands[0].handler('', ctx);

  assert.deepEqual(events, [
    ['start', '/project'],
    ['open', '/project', 'http://127.0.0.1:4173'],
  ]);
  assert.equal(result.browser, 'opened');
  assert.deepEqual(notifications, [{ message: JSON.stringify(result, null, 2), type: 'info' }]);
});
