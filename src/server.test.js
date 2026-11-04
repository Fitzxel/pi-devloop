import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackServer } from './server.js';

test('feedback server only accepts authorized same-origin selection payloads', async (t) => {
  const received = [];
  const server = createFeedbackServer({ token: 'session-secret', onSelection: (item) => received.push(item) });
  const address = await server.listen();
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${address.port}/selection`;
  const headers = { 'content-type': 'application/json', origin: `http://127.0.0.1:${address.port}`, authorization: 'Bearer session-secret' };
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
