import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createFeedbackServer } from './server.js';
import { DEVLOOP_EXTENSION_ID, EXTENSION_PUBLIC_KEY } from './extension-identity.js';

test('manifest identity matches the extension ID pinned by the feedback receiver', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.key, EXTENSION_PUBLIC_KEY);
  const derivedId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16).toString('hex')
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
  assert.equal(derivedId, DEVLOOP_EXTENSION_ID);
});

test('feedback server token rotation rejects the previous bearer token', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'old-token', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${address.port}/selection`;
  const headers = { 'content-type': 'application/json', origin: `chrome-extension://${DEVLOOP_EXTENSION_ID}` };
  const body = JSON.stringify({ instruction: 'Inspect', selector: 'main' });
  server.setToken('new-token');
  const rejected = await fetch(endpoint, { method: 'POST', headers: { ...headers, authorization: 'Bearer old-token' }, body });
  assert.equal(rejected.status, 401);
  const accepted = await fetch(endpoint, { method: 'POST', headers: { ...headers, authorization: 'Bearer new-token' }, body });
  assert.equal(accepted.status, 202);
  assert.equal(received.length, 1);
});

test('feedback server permits authenticated extension-context submissions', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'extension-token', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${address.port}/selection`;
  const headers = { origin: `chrome-extension://${DEVLOOP_EXTENSION_ID}`, authorization: 'Bearer extension-token', 'content-type': 'application/json' };
  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { origin: headers.origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), headers.origin);
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ instruction: 'Check', selector: 'main' }) });
  assert.equal(response.status, 202);
  assert.equal(received.length, 1);
});

test('feedback server rejects extension origins other than the pinned devloop extension', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'secret', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/selection`, {
    method: 'POST',
    headers: { origin: `chrome-extension://${'a'.repeat(32)}`, authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ instruction: 'Check', selector: 'main' }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { error: 'origin not allowed' });
  assert.deepEqual(received, []);
});

test('feedback server only accepts authorized same-origin selection payloads', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'session-secret', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${address.port}/selection`;
  const headers = { 'content-type': 'application/json', origin: `chrome-extension://${DEVLOOP_EXTENSION_ID}`, authorization: 'Bearer session-secret' };
  const payload = { instruction: 'Make it larger', selector: 'button.primary', role: 'button', text: 'Save' };

  const accepted = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], payload);

  for (const [requestHeaders, body, status] of [
    [{ ...headers, authorization: 'Bearer wrong' }, payload, 401],
    [{ ...headers, origin: 'https://attacker.example' }, payload, 403],
    [headers, { instruction: 'x'.repeat(5000) }, 400],
    [headers, { instruction: 'no selector' }, 400],
  ]) {
    const response = await fetch(endpoint, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: status === 401 ? 'unauthorized' : status === 403 ? 'origin not allowed' : 'invalid payload' });
    assert.equal(received.length, 1, 'rejected requests must not reach the agent');
  }
});

test('feedback server accepts versioned individual and batch target submissions', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'multi-token', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${address.port}/selection`;
  const headers = { 'content-type': 'application/json', origin: `chrome-extension://${DEVLOOP_EXTENSION_ID}`, authorization: 'Bearer multi-token' };
  const target = (number, selector, instruction) => ({
    number,
    selector,
    role: 'button',
    text: `Target ${number}`,
    outerHTML: `<button id="target-${number}">Target ${number}</button>`,
    rect: { x: number, y: 2, width: 80, height: 24 },
    styles: { display: 'block', position: 'static', color: 'rgb(0, 0, 0)', backgroundColor: 'transparent', fontSize: '16px', width: '80px', height: '24px' },
    ...(instruction ? { instruction } : {}),
  });
  const submissions = [
    { version: 2, mode: 'individual', pageUrl: 'http://localhost:3000/', targets: [target(1, '#first', 'Rewrite in English')] },
    { version: 2, mode: 'batch', pageUrl: 'http://localhost:3000/', globalInstruction: 'Move 1 to where 2 is', targets: [target(1, '#first', 'Rewrite in English'), target(2, '#second')] },
  ];

  for (const payload of submissions) {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
  }
  assert.deepEqual(received, submissions, 'accepted submissions must reach the agent unchanged');
});

test('feedback server rejects invalid multi-target submissions without forwarding them', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'multi-token', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${address.port}/selection`;
  const headers = { 'content-type': 'application/json', origin: `chrome-extension://${DEVLOOP_EXTENSION_ID}`, authorization: 'Bearer multi-token' };
  const target = (number, instruction = 'Change this target') => ({ number, selector: `#target-${number}`, instruction });
  const valid = { version: 2, mode: 'batch', pageUrl: 'http://localhost:3000/', globalInstruction: 'Arrange the targets', targets: [target(1), target(2)] };
  const invalid = [
    { ...valid, version: 3 },
    { ...valid, mode: 'unknown' },
    { ...valid, targets: [] },
    { ...valid, targets: Array.from({ length: 6 }, (_, index) => target(index + 1)) },
    { ...valid, targets: [target(1), target(1)] },
    { ...valid, globalInstruction: '', targets: [target(1, ''), target(2, '')] },
    { ...valid, targets: [{ ...target(1), selector: '' }] },
    { ...valid, targets: [{ ...target(1), instruction: 'x'.repeat(4001) }] },
    { ...valid, targets: [{ ...target(1), outerHTML: 'x'.repeat(4001) }] },
    { ...valid, pageUrl: 'x'.repeat(2049) },
    { ...valid, targets: [target(1), target(2)], mode: 'individual' },
    { version: 2, mode: 'individual', pageUrl: 'http://localhost:3000/', targets: [target(1, '')] },
  ];

  for (const payload of invalid) {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid payload' });
    assert.deepEqual(received, [], 'rejected payloads must not reach the agent');
  }
});

test('feedback server rejects multi-target payloads above the existing body limit', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'multi-token', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/selection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `chrome-extension://${DEVLOOP_EXTENSION_ID}`, authorization: 'Bearer multi-token' },
    body: JSON.stringify({
      version: 2,
      mode: 'batch',
      pageUrl: 'http://localhost:3000/',
      globalInstruction: 'g'.repeat(4000),
      targets: Array.from({ length: 5 }, (_, index) => ({ number: index + 1, selector: `#${index}`, instruction: 'i'.repeat(4000), outerHTML: 'h'.repeat(4000) })),
    }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'payload too large' });
  assert.deepEqual(received, [], 'over-limit payloads must not reach the agent');
});
