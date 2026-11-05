import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DEVLOOP_EXTENSION_ID } from './extension-identity.js';

const MAX_BODY = 16 * 1024;
const MAX_TEXT = 4000;

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function createFeedbackServer({ token, onSelection, targetOrigin }) {
  if (!token || typeof onSelection !== 'function') throw new TypeError('token and onSelection are required');
  let currentToken = token;
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
      if (validOrigin(req)) headers['access-control-allow-origin'] = req.headers.origin;
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      if (!validOrigin(req)) return send(403, { error: 'origin not allowed' });
      res.writeHead(204, { 'access-control-allow-origin': req.headers.origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', vary: 'Origin' });
      return res.end();
    }
    if (req.method !== 'POST' || req.url !== '/selection') return send(404, { error: 'not found' });
    if (!validOrigin(req)) return send(403, { error: 'origin not allowed' });
    const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const expected = Buffer.from(currentToken);
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return send(401, { error: 'unauthorized' });
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY) return send(413, { error: 'payload too large' });
      }
      const item = JSON.parse(raw);
      if (!isSelection(item)) return send(400, { error: 'invalid payload' });
      await onSelection(item);
      return send(202, { accepted: true });
    } catch {
      return send(400, { error: 'invalid payload' });
    }
  });
  return {
    server,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    setToken(value) { if (!value) throw new TypeError('token is required'); currentToken = value; },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}

function validOrigin(req) {
  return req.headers.origin === `chrome-extension://${DEVLOOP_EXTENSION_ID}`;
}

function isSelection(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.instruction === 'string' && value.instruction.length > 0 && value.instruction.length <= MAX_TEXT &&
    typeof value.selector === 'string' && value.selector.length > 0 && value.selector.length <= 1000 &&
    (value.role === undefined || (typeof value.role === 'string' && value.role.length <= 200)) &&
    (value.text === undefined || (typeof value.text === 'string' && value.text.length <= 1000)) &&
    (value.outerHTML === undefined || (typeof value.outerHTML === 'string' && value.outerHTML.length <= 4000));
}
