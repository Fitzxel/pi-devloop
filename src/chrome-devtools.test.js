import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChromeDevTools, createChromeDevToolsConfig, MCP_SERVER_NAME } from './chrome-devtools.js';
import { setProjectConfig } from './project-config.js';

test('Chrome DevTools MCP config launches a managed profile unless an endpoint is configured', () => {
  assert.deepEqual(createChromeDevToolsConfig('/work/app'), {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--isolated'],
    cwd: '/work/app',
    exposure: 'direct',
    description: 'Inspect and control the project browser through Chrome DevTools MCP.',
  });
  assert.deepEqual(createChromeDevToolsConfig('/work/app', 'http://127.0.0.1:9333'), {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9333'],
    cwd: '/work/app',
    exposure: 'direct',
    description: 'Inspect and control the project browser through Chrome DevTools MCP.',
  });
  assert.equal(MCP_SERVER_NAME, 'pi-devloop-chrome');
});

test('Chrome MCP is registered only when connect is requested and can be disconnected', async () => {
  const changes = [];
  const servers = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { changes.push(['register', name, config]); servers.push({ name, config, extensionPath: '/project/src/index.ts' }); },
    unregisterMcpServer(name) { changes.push(['unregister', name]); servers.splice(0, servers.length, ...servers.filter((server) => server.name !== name)); },
  };
  const integration = createChromeDevTools(pi);
  assert.deepEqual(changes, [], 'constructing the extension integration must not start the MCP server');
  assert.deepEqual(integration.status(), { registered: false, owned: false, serverName: MCP_SERVER_NAME, browserUrl: null, mode: null });

  const [connected, concurrentConnect] = await Promise.all([
    integration.connect('/tmp/pi-devloop-test'),
    integration.connect('/tmp/pi-devloop-test'),
  ]);
  assert.equal(connected.registered, true);
  assert.equal(connected.owned, true);
  assert.equal(concurrentConnect.registered, true);
  assert.equal(connected.browserUrl, null);
  assert.equal(connected.mode, 'managed');
  assert.equal(changes[0][0], 'register');
  assert.deepEqual(changes[0][2].args, ['-y', 'chrome-devtools-mcp@latest', '--isolated']);
  const repeated = await integration.connect('/tmp/pi-devloop-test');
  assert.equal(repeated.alreadyRegistered, true);
  assert.equal(changes.filter(([action]) => action === 'register').length, 1, 'concurrent and repeated connect should be idempotent');

  assert.deepEqual(integration.status(), { registered: true, owned: true, serverName: MCP_SERVER_NAME, browserUrl: null, mode: 'managed' });
  assert.deepEqual(await integration.disconnect(), { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: true });
  assert.equal(changes.at(-1)[0], 'unregister');
});

test('browser_disconnect retries owned Chrome cleanup after MCP unregistration succeeded', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-browser-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const servers = [];
  const changes = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { servers.push({ name, config, extensionPath: '/project/src/index.ts' }); },
    unregisterMcpServer(name) { changes.push(['unregister', name]); servers.splice(0, servers.length, ...servers.filter((server) => server.name !== name)); },
  };
  let closeCalls = 0;
  const launcher = {
    owned: true,
    endpoint: 'http://127.0.0.1:43127',
    async open() { return { browserUrl: this.endpoint, owned: true }; },
    async close() {
      closeCalls++;
      if (closeCalls === 1) throw Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' });
      return true;
    },
  };
  const integration = createChromeDevTools(pi, launcher);
  await integration.openReady(cwd, 'http://localhost:3000');

  await assert.rejects(integration.disconnect(), /ENOTEMPTY/);
  assert.deepEqual(servers, [], 'the owned MCP registration is removed before launcher cleanup');
  const retry = await integration.disconnect();

  assert.deepEqual(retry, { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: false, browserClosed: true });
  assert.equal(closeCalls, 2, 'a retry should close only the still-owned Chrome launcher');
  assert.deepEqual(changes, [['unregister', MCP_SERVER_NAME]]);
});

test('Chrome MCP attaches to the configured existing browser endpoint', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-browser-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await setProjectConfig(cwd, 'browserUrl', 'http://127.0.0.1:9333');
  const servers = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { servers.push({ name, config, extensionPath: '/project/src/index.ts' }); },
    unregisterMcpServer(name) { servers.splice(0, servers.length, ...servers.filter((server) => server.name !== name)); },
  };
  const integration = createChromeDevTools(pi);
  const connected = await integration.connect(cwd);
  assert.equal(connected.mode, 'attach');
  assert.equal(connected.browserUrl, 'http://127.0.0.1:9333');
  assert.deepEqual(servers[0].config.args, ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9333']);
  assert.deepEqual(integration.status(), { registered: true, owned: true, serverName: MCP_SERVER_NAME, browserUrl: 'http://127.0.0.1:9333', mode: 'attach' });
});

test('Chrome MCP refuses another extension registration and never disconnects it', async () => {
  const servers = [{ name: MCP_SERVER_NAME, extensionPath: '/other/extension.ts', config: createChromeDevToolsConfig('/work/other') }];
  const changes = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { changes.push(['register', name, config]); },
    unregisterMcpServer(name) { changes.push(['unregister', name]); },
  };
  const integration = createChromeDevTools(pi);
  await assert.rejects(integration.connect('/tmp/pi-devloop-test'), /already registered by another extension/);
  assert.deepEqual(integration.status(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, browserUrl: null, mode: 'managed' });
  assert.deepEqual(await integration.disconnect(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, disconnected: false });
  assert.deepEqual(changes, []);
  assert.equal(servers.length, 1);
});

test('Chrome MCP status and disconnect reject a registration replaced by another extension', async () => {
  const servers = [];
  const changes = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { changes.push(['register', name, config]); servers.push({ name, config, extensionPath: '/project/src/index.ts' }); },
    unregisterMcpServer(name) { changes.push(['unregister', name]); servers.splice(0, servers.length, ...servers.filter((server) => server.name !== name)); },
  };
  let closeCalls = 0;
  const launcher = { owned: true, async close() { closeCalls++; return true; } };
  const integration = createChromeDevTools(pi, launcher);
  await integration.connect('/tmp/pi-devloop-test');
  servers[0] = { ...servers[0], extensionPath: '/other/extension.ts' };
  assert.deepEqual(integration.status(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, browserUrl: null, mode: 'managed' });
  assert.deepEqual(await integration.disconnect(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, disconnected: false });
  assert.equal(changes.filter(([action]) => action === 'unregister').length, 0);
  assert.equal(servers.length, 1);
  assert.equal(closeCalls, 0, 'foreign MCP ownership must prevent closing the browser');
});

test('Chrome MCP endpoint must use http or https and contain no credentials', () => {
  assert.throws(() => createChromeDevToolsConfig('/work/app', 'javascript:alert(1)'), /http or https/);
  assert.throws(() => createChromeDevToolsConfig('/work/app', 'http://user:password@127.0.0.1:9222'), /credentials/);
});

test('dev_start opens Chrome at the ready URL and attaches the native MCP to that owned browser', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-browser-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const servers = [];
  const changes = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { changes.push(['register', name, config]); servers.push({ name, config, extensionPath: '/project/src/index.ts' }); },
    unregisterMcpServer(name) { changes.push(['unregister', name]); servers.splice(0, servers.length, ...servers.filter((server) => server.name !== name)); },
  };
  const launcherCalls = [];
  const launcher = {
    owned: true,
    endpoint: 'http://127.0.0.1:43127',
    async open(url) { launcherCalls.push(['open', url]); return { browserUrl: this.endpoint, owned: true }; },
    async openConfigured() { throw new Error('configured browser must not be used'); },
    async close() { launcherCalls.push(['close']); return true; },
  };
  const integration = createChromeDevTools(pi, launcher);

  const opened = await integration.openReady(cwd, 'http://localhost:3000');
  assert.deepEqual(launcherCalls, [['open', 'http://localhost:3000']]);
  assert.equal(opened.mode, 'managed');
  assert.equal(opened.browserUrl, 'http://127.0.0.1:43127');
  assert.deepEqual(servers[0].config.args, ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:43127']);
  assert.deepEqual(integration.status(), { registered: true, owned: true, serverName: MCP_SERVER_NAME, browserUrl: 'http://127.0.0.1:43127', mode: 'managed' });

  const disconnected = await integration.disconnect();
  assert.deepEqual(disconnected, { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: true, browserClosed: true });
  assert.deepEqual(changes.map(([action]) => action), ['register', 'unregister']);
  assert.deepEqual(launcherCalls, [['open', 'http://localhost:3000'], ['close']]);
});

test('dev_start opens configured browser and never takes ownership of its process', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-browser-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await setProjectConfig(cwd, 'browserUrl', 'http://127.0.0.1:9333');
  const servers = [];
  const pi = {
    getMcpServers: () => [...servers],
    registerMcpServer(name, config) { servers.push({ name, config, extensionPath: '/project/src/index.ts' }); },
    unregisterMcpServer(name) { servers.splice(0, servers.length, ...servers.filter((server) => server.name !== name)); },
  };
  const calls = [];
  const launcher = {
    owned: false,
    endpoint: null,
    async open() { throw new Error('must not launch Chrome'); },
    async openConfigured(endpoint, url) { calls.push(['navigate', endpoint, url]); return { browserUrl: endpoint, owned: false }; },
    async close() { calls.push(['close']); return false; },
  };
  const integration = createChromeDevTools(pi, launcher);

  const opened = await integration.openReady(cwd, 'http://localhost:3000');
  assert.deepEqual(opened, { registered: true, owned: true, serverName: MCP_SERVER_NAME, browserUrl: 'http://127.0.0.1:9333', mode: 'attach', alreadyRegistered: false, browserOwned: false });
  assert.deepEqual(calls, [['navigate', 'http://127.0.0.1:9333', 'http://localhost:3000']]);
  assert.deepEqual(servers[0].config.args, ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9333']);
  assert.equal((await integration.disconnect()).browserClosed, undefined);
  assert.deepEqual(calls, [['navigate', 'http://127.0.0.1:9333', 'http://localhost:3000'], ['close']]);
});

test('dev_start refuses a foreign MCP registration before launching or navigating Chrome', async () => {
  const servers = [{ name: MCP_SERVER_NAME, extensionPath: '/other/extension.ts', config: createChromeDevToolsConfig('/work/other') }];
  const pi = { getMcpServers: () => [...servers], registerMcpServer() { throw new Error('must not register'); }, unregisterMcpServer() { throw new Error('must not unregister'); } };
  let opened = false;
  const launcher = { open: async () => { opened = true; }, openConfigured: async () => { opened = true; } };
  const integration = createChromeDevTools(pi, launcher);
  await assert.rejects(integration.openReady('/tmp/pi-devloop-test', 'http://localhost:3000'), /registered by another extension/);
  assert.equal(opened, false);
  assert.equal(servers.length, 1);
});
