import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getProjectConfig, parseSettingArgs, setProjectConfig } from './project-config.js';

test('project settings are optional and can be changed independently', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));

  assert.deepEqual(await getProjectConfig(cwd), {
    command: 'npm run dev', url: null, timeout: 30000, layout: 'tab', tabName: 'devloop', browserUrl: null,
    configured: { command: null, url: null, timeout: null, readyPattern: null, layout: null, tabName: null, browserUrl: null },
  });
  await setProjectConfig(cwd, 'command', 'pnpm dev -- --host 0.0.0.0');
  await setProjectConfig(cwd, 'url', 'https://preview.example.test');
  await setProjectConfig(cwd, 'timeout', '45000');
  await setProjectConfig(cwd, 'readyPattern', 'started\\s+on');
  await setProjectConfig(cwd, 'layout', 'split');
  await setProjectConfig(cwd, 'tabName', 'API server');
  await setProjectConfig(cwd, 'browserUrl', 'http://127.0.0.1:9333');
  assert.deepEqual(await getProjectConfig(cwd), {
    command: 'pnpm dev -- --host 0.0.0.0', url: 'https://preview.example.test', timeout: 45000, layout: 'split', tabName: 'API server', browserUrl: 'http://127.0.0.1:9333',
    configured: { command: 'pnpm dev -- --host 0.0.0.0', url: 'https://preview.example.test', timeout: 45000, readyPattern: 'started\\s+on', layout: 'split', tabName: 'API server', browserUrl: 'http://127.0.0.1:9333' },
  });
  const persisted = JSON.parse(await readFile(path.join(cwd, '.pi/devloop.json'), 'utf8'));
  assert.deepEqual(persisted, { command: 'pnpm dev -- --host 0.0.0.0', url: 'https://preview.example.test', timeout: 45000, readyPattern: 'started\\s+on', layout: 'split', tabName: 'API server', browserUrl: 'http://127.0.0.1:9333' });

  await setProjectConfig(cwd, 'url', 'https://user:pass@preview.example.test');
  assert.equal((await getProjectConfig(cwd)).url, 'https://user:pass@preview.example.test');
  await setProjectConfig(cwd, 'browserUrl', undefined);
  assert.equal((await getProjectConfig(cwd)).browserUrl, null, 'clearing browserUrl restores the MCP-managed browser mode');
  await setProjectConfig(cwd, 'url', undefined);
  assert.equal((await getProjectConfig(cwd)).url, null);
  assert.equal((await getProjectConfig(cwd)).command, 'pnpm dev -- --host 0.0.0.0');
});

test('set command parser preserves command arguments and treats a missing value as clear', () => {
  assert.deepEqual(parseSettingArgs('command pnpm dev -- --host 0.0.0.0'), { key: 'command', value: 'pnpm dev -- --host 0.0.0.0' });
  assert.deepEqual(parseSettingArgs('url'), { key: 'url', value: undefined });
  assert.deepEqual(parseSettingArgs('layout tab'), { key: 'layout', value: 'tab' });
  assert.deepEqual(parseSettingArgs('browserUrl http://127.0.0.1:9444'), { key: 'browserUrl', value: 'http://127.0.0.1:9444' });
  assert.deepEqual(parseSettingArgs('readyPattern ready\\s+on'), { key: 'readyPattern', value: 'ready\\s+on' });
  assert.throws(() => parseSettingArgs('unknown value'), /one of: command, url, timeout, readyPattern, layout, tabName, browserUrl/);
});

test('settings can be created for a project before it has package.json', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await setProjectConfig(cwd, 'command', 'make dev');
  assert.equal((await getProjectConfig(cwd)).command, 'make dev');
});

test('project settings reject invalid keys, URL, and timeout', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await assert.rejects(setProjectConfig(cwd, 'readyPattern', 'ready\nnow'), /single-line string/);
  await assert.rejects(setProjectConfig(cwd, 'url', 'javascript:alert(1)'), /http or https URL/);
  await assert.rejects(setProjectConfig(cwd, 'timeout', '0'), /positive integer/);
  await assert.rejects(setProjectConfig(cwd, 'layout', 'stack'), /layout must be tab or split/);
  await assert.rejects(setProjectConfig(cwd, 'tabName', 'bad\nname'), /single-line/);
  await assert.rejects(setProjectConfig(cwd, 'browserUrl', 'ftp://127.0.0.1:9222'), /http or https/);
  await assert.rejects(setProjectConfig(cwd, 'browserUrl', 'http://user:pass@127.0.0.1:9222'), /credentials/);
});
