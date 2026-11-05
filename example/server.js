import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(new URL('./index.html', import.meta.url));

export async function startExampleServer({ host = '127.0.0.1', port = Number(process.env.PORT ?? 0), onReady = console.log } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
  const page = await readFile(pagePath, 'utf8');
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method !== 'GET' || (pathname !== '/' && pathname !== '/index.html')) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Example server did not bind to a TCP port');
  }
  onReady(`Example ready: http://${host}:${address.port}`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startExampleServer().catch((error) => {
    console.error(`Example server failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
