import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, readDevState, runHerdr } from './herdr.js';

test('loadConfig uses configured command and validates it', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.pi'));
  await writeFile(path.join(cwd, '.pi/devloop.json'), JSON.stringify({ command: 'pnpm dev', readyPattern: 'Ready' }));
  assert.deepEqual(await loadConfig(cwd), { command: 'pnpm dev', readyPattern: 'Ready' });
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

test('runHerdr refuses control outside a managed pane', async () => {
  await assert.rejects(runHerdr(['pane', 'list'], { env: { HERDR_ENV: '0' } }), /HERDR_ENV=1 required/);
});
