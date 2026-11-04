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
  assert.deepEqual(integration.disconnect(), { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: true });
  assert.equal(changes.at(-1)[0], 'unregister');
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
  assert.deepEqual(integration.disconnect(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, disconnected: false });
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
  const integration = createChromeDevTools(pi);
  await integration.connect('/tmp/pi-devloop-test');
  servers[0] = { ...servers[0], extensionPath: '/other/extension.ts' };
  assert.deepEqual(integration.status(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, browserUrl: null, mode: 'managed' });
  assert.deepEqual(integration.disconnect(), { registered: true, owned: false, serverName: MCP_SERVER_NAME, disconnected: false });
  assert.equal(changes.filter(([action]) => action === 'unregister').length, 0);
  assert.equal(servers.length, 1);
});

test('Chrome MCP endpoint must use http or https and contain no credentials', () => {
  assert.throws(() => createChromeDevToolsConfig('/work/app', 'javascript:alert(1)'), /http or https/);
  assert.throws(() => createChromeDevToolsConfig('/work/app', 'http://user:password@127.0.0.1:9222'), /credentials/);
});
