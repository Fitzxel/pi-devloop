import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, readDevState, resolveDevUrl, runHerdr } from './herdr.js';

test('loadConfig uses configured command and validates it', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.pi'));
  await writeFile(path.join(cwd, '.pi/devloop.json'), JSON.stringify({ command: 'pnpm dev', readyPattern: 'Ready' }));
  assert.deepEqual(await loadConfig(cwd), { command: 'pnpm dev', readyPattern: 'Ready', url: null, timeout: 30000, readyTimeoutMs: 30000 });
  await writeFile(path.join(cwd, '.pi/devloop.json'), JSON.stringify({ command: 'echo\nunsafe' }));
  await assert.rejects(loadConfig(cwd), /single-line/);
});

test('loadConfig detects dev script and readDevState handles missing state', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  assert.equal((await loadConfig(cwd)).command, 'npm run dev');
  assert.equal(await readDevState(path.join(cwd, '.pi/devloop/state.json')), null);
});

test('configured URL overrides the URL detected in ready output', () => {
  assert.equal(resolveDevUrl('https://preview.example.test', 'Local: http://localhost:5173/'), 'https://preview.example.test');
  assert.equal(resolveDevUrl(null, 'Local: http://localhost:5173/'), 'http://localhost:5173/');
});

test('extracts the ready URL from Herdr structured wait-output', () => {
  const readyOutput = JSON.stringify({
    url: 'http://127.0.0.1:35493',
    pane_id: 'w0:p4',
    read: {
      format: 'text',
      pane_id: 'w0:p4',
      revision: 0,
      source: 'recent_unwrapped',
      tab_id: 'w0:t4',
      text: 'Starting server\\nhttp://127.0.0.1:35493',
    },
  });
  assert.equal(resolveDevUrl(null, readyOutput), 'http://127.0.0.1:35493');
  assert.equal(resolveDevUrl('https://preview.example.test', readyOutput), 'https://preview.example.test');

  const cliEnvelope = JSON.stringify({
    id: 'cli:pane:wait-output',
    result: {
      matched_line: 'http://127.0.0.1:35493',
      pane_id: 'w0:p4',
      read: { format: 'text', pane_id: 'w0:p4', revision: 0, source: 'recent_unwrapped', tab_id: 'w0:t4', text: '   terminal banner\\nhttp://127.0.0.1:35493' },
      revision: 0,
      type: 'output_matched',
    },
  });
  assert.equal(resolveDevUrl(null, cliEnvelope), 'http://127.0.0.1:35493');
  assert.equal(resolveDevUrl(null, JSON.stringify(readyOutput)), 'http://127.0.0.1:35493');

  const textOnlyOutput = JSON.stringify({ pane_id: 'w0:p5', read: { format: 'text', text: 'Local: http://localhost:4567/' } });
  assert.equal(resolveDevUrl(null, textOnlyOutput), 'http://localhost:4567/');
});

test('runHerdr refuses control outside a managed pane', async () => {
  await assert.rejects(runHerdr(['pane', 'list'], { env: { HERDR_ENV: '0' } }), /HERDR_ENV=1 required/);
});
