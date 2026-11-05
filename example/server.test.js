import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startExampleServer } from './server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package start script launches and includes the example server', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node example/server.js');
  assert.equal(pkg.scripts['test:e2e'], 'node example/live-e2e.js');
  assert.ok(pkg.files.includes('example'));
});

test('example server prints a loopback ready URL and serves the page', async (t) => {
  const readyLines = [];
  const server = await startExampleServer({ port: 0, onReady: (line) => readyLines.push(line) });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  assert.equal(readyLines.length, 1);
  const readyUrl = readyLines[0].match(/^Example ready: (http:\/\/127\.0\.0\.1:\d+)$/)?.[1];
  assert.ok(readyUrl, `expected a loopback ready URL, received: ${readyLines[0]}`);

  const response = await fetch(readyUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(await response.text(), /Pi Devloop Example/);
});
