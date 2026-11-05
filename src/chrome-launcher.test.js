import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createChromeLauncher } from './chrome-launcher.js';

function makeChild(onKill) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    onKill?.(signal);
    child.signalCode = signal;
    child.emit('exit', null, signal);
    return true;
  };
  queueMicrotask(() => child.emit('spawn'));
  return child;
}

test('launches an isolated Chrome at the ready URL and closes only its owned child/profile', async () => {
  const calls = [];
  const chrome = createChromeLauncher({
    env: { CHROME_PATH: '/opt/mock/chrome' },
    mkdtemp: async (prefix) => { calls.push(['mkdtemp', prefix]); return '/tmp/pi-devloop-owned'; },
    readFile: async (file) => { assert.equal(file, '/tmp/pi-devloop-owned/DevToolsActivePort'); return '43127\n/devtools/browser/test'; },
    writeFile: async (file, content) => calls.push(['writeFile', file, content]),
    rm: async (...args) => calls.push(['rm', ...args]),
    spawn: (command, args, options) => { calls.push(['spawn', command, args, options]); return makeChild((signal) => calls.push(['kill', signal])); },
    fetch: async (url) => { calls.push(['fetch', String(url)]); return { ok: true }; },
    sleep: async () => {},
  });

  const result = await chrome.open('http://localhost:3000', { endpoint: 'http://127.0.0.1:43200/selection', token: 'fresh-secret', targetOrigin: 'http://localhost:3000' });
  assert.deepEqual(result, { browserUrl: 'http://127.0.0.1:43127', owned: true });
  const spawnCall = calls.find(([kind]) => kind === 'spawn');
  assert.equal(spawnCall[1], '/opt/mock/chrome');
  assert(spawnCall[2].includes('--enable-automation'));
  assert(spawnCall[2].includes('--remote-debugging-port=0'));
  assert(spawnCall[2].some((arg) => arg.startsWith('--load-extension=')));
  const workerConfig = calls.find(([kind, file]) => kind === 'writeFile' && file.endsWith('service-worker.js'));
  const manifestConfig = calls.find(([kind, file]) => kind === 'writeFile' && file.endsWith('manifest.json'));
  const manifest = JSON.parse(manifestConfig[2]);
  assert.deepEqual(manifest.host_permissions, ['http://localhost:3000/*', 'http://127.0.0.1:43200/*']);
  assert.equal(manifest.content_scripts, undefined, 'selection remains explicitly activated from the toolbar');
  assert.match(workerConfig[2], /fresh-secret/);
  assert(workerConfig[2].includes('http://localhost:3000'));
  assert(!workerConfig[2].includes('window.__PI_DEVLOOP__'));
  assert(spawnCall[2].includes('--user-data-dir=/tmp/pi-devloop-owned'));
  assert.equal(spawnCall[2].at(-1), 'http://localhost:3000');
  assert(calls.some(([kind, url]) => kind === 'fetch' && url === 'http://127.0.0.1:43127/json/version'));

  assert.equal(await chrome.close(), true);
  assert(calls.some(([kind, signal]) => kind === 'kill' && signal === 'SIGTERM'));
  assert(calls.some(([kind, directory, options]) => kind === 'rm' && directory === '/tmp/pi-devloop-owned' && options.recursive && options.force));
  assert.equal(await chrome.close(), false);
});

test('does not install an extension into a configured external browser', async () => {
  const calls = [];
  const chrome = createChromeLauncher({
    spawn: () => { calls.push(['spawn']); throw new Error('must not launch'); },
    fetch: async () => ({ ok: true }),
  });
  await chrome.openConfigured('http://127.0.0.1:9222', 'http://localhost:3000');
  assert.deepEqual(calls, []);
});

test('opens a new tab in configured Chrome without launching or closing it', async () => {
  const calls = [];
  const chrome = createChromeLauncher({
    spawn: () => { calls.push(['spawn']); throw new Error('must not launch'); },
    fetch: async (url, options) => { calls.push(['fetch', String(url), options]); return { ok: true }; },
  });

  const result = await chrome.openConfigured('http://127.0.0.1:9222', 'http://localhost:3000');
  assert.deepEqual(result, { browserUrl: 'http://127.0.0.1:9222', owned: false });
  assert.deepEqual(calls, [['fetch', 'http://127.0.0.1:9222/json/new?http%3A%2F%2Flocalhost%3A3000', { method: 'PUT', redirect: 'error' }]]);
  assert.equal(await chrome.close(), false);
  assert.equal(calls.length, 1);
});

test('concurrent opens launch one owned Chrome and open subsequent URLs in a new tab', async () => {
  const calls = [];
  const chrome = createChromeLauncher({
    env: { CHROME_PATH: '/opt/mock/chrome' },
    mkdtemp: async () => '/tmp/pi-devloop-concurrent',
    readFile: async () => '43128\n',
    rm: async () => {},
    spawn: (_command, args) => { calls.push(['spawn', args]); return makeChild(); },
    fetch: async (url, options) => { calls.push(['fetch', String(url), options]); return { ok: true }; },
    sleep: async () => {},
  });

  const [first, second] = await Promise.all([
    chrome.open('http://localhost:3000'),
    chrome.open('http://localhost:4000'),
  ]);
  assert.equal(calls.filter(([kind]) => kind === 'spawn').length, 1);
  assert.deepEqual(first, { browserUrl: 'http://127.0.0.1:43128', owned: true });
  assert.deepEqual(second, { browserUrl: 'http://127.0.0.1:43128', owned: true });
  assert(calls.some(([kind, url]) => kind === 'fetch' && url === 'http://127.0.0.1:43128/json/new?http%3A%2F%2Flocalhost%3A4000'));
  await chrome.close();
});

test('relaunches Chrome after the previously owned process exits unexpectedly', async () => {
  const calls = [];
  const children = [];
  const directories = ['/tmp/pi-devloop-first', '/tmp/pi-devloop-second'];
  const chrome = createChromeLauncher({
    env: { CHROME_PATH: '/opt/mock/chrome' },
    mkdtemp: async () => directories.shift(),
    readFile: async () => '43129\n',
    rm: async (directory) => calls.push(['rm', directory]),
    spawn: (_command, args) => { calls.push(['spawn', args]); const child = makeChild(); children.push(child); return child; },
    fetch: async () => ({ ok: true }),
    sleep: async () => {},
  });

  await chrome.open('http://localhost:3000');
  children[0].exitCode = 0;
  children[0].emit('exit', 0, null);
  const reopened = await chrome.open('http://localhost:4000');
  assert.deepEqual(reopened, { browserUrl: 'http://127.0.0.1:43129', owned: true });
  assert.equal(calls.filter(([kind]) => kind === 'spawn').length, 2);
  assert(calls.some(([kind, directory]) => kind === 'rm' && directory === '/tmp/pi-devloop-first'));
  assert.equal(calls.findLast(([kind]) => kind === 'spawn')[1].at(-1), 'http://localhost:4000');
  await chrome.close();
});

test('cleans the temporary profile if Chrome cannot be spawned', async () => {
  const calls = [];
  const chrome = createChromeLauncher({
    env: { CHROME_PATH: '/missing/chrome' },
    mkdtemp: async () => '/tmp/pi-devloop-failed',
    rm: async (...args) => calls.push(['rm', ...args]),
    spawn: () => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      queueMicrotask(() => { const error = new Error('not found'); error.code = 'ENOENT'; child.emit('error', error); });
      return child;
    },
  });

  await assert.rejects(chrome.open('http://localhost:3000'), /Chrome could not be started/);
  assert(calls.some(([kind, directory]) => kind === 'rm' && directory === '/tmp/pi-devloop-failed'));
});

test('surfaces configured-browser navigation failure without taking ownership', async () => {
  const chrome = createChromeLauncher({
    fetch: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(chrome.openConfigured('http://127.0.0.1:9222', 'http://localhost:3000'), /HTTP 403/);
  assert.equal(await chrome.close(), false);
});
