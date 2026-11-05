import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeDevTools, MCP_SERVER_NAME } from '../src/chrome-devtools.js';
import { createChromeLauncher } from '../src/chrome-launcher.js';
import { runDevStart } from '../src/dev-start-automation.js';
import { startDevServer, stopDevServer } from '../src/herdr.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'src/index.ts');

function createTestPiHost() {
  const servers = new Map();
  return {
    getMcpServers: () => [...servers.values()],
    registerMcpServer(name, config) {
      servers.set(name, { name, config, extensionPath });
    },
    async unregisterMcpServer(name) {
      servers.delete(name);
    },
  };
}

async function waitForPage(endpoint, readyUrl, timeoutMs = 10000) {
  const expected = new URL(readyUrl);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/list`, { redirect: 'error' });
      if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}`);
      const targets = await response.json();
      const page = targets.find((target) => {
        if (target.type !== 'page') return false;
        try {
          const actual = new URL(target.url);
          return actual.origin === expected.origin && actual.pathname === (expected.pathname || '/');
        } catch { return false; }
      });
      if (page) return page;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not open ${readyUrl}${lastError ? `: ${lastError.message}` : ''}`);
}

async function closeBrowser(browser, launcher) {
  let firstError;
  try {
    await browser.disconnect();
  } catch (error) {
    firstError = error;
    await browser.disconnect();
    console.error(`Managed Chrome cleanup succeeded on retry after: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (launcher.owned) throw new Error('Managed Chrome is still owned after disconnect');
  return firstError;
}

async function runLiveTest() {
  if (process.env.HERDR_ENV !== '1') {
    throw new Error('Run `npm run test:e2e` inside a Herdr-managed pane (HERDR_ENV=1 required).');
  }

  const project = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-e2e-project-'));
  const stateFile = path.join(project, '.pi', 'devloop', 'state.json');
  const launcher = createChromeLauncher();
  const pi = createTestPiHost();
  const browser = createChromeDevTools(pi, launcher);
  let failure;
  let result;
  let summary;
  let serverState;

  try {
    await writeFile(path.join(project, 'package.json'), await readFile(path.join(root, 'package.json')));
    await cp(path.join(root, 'example'), path.join(project, 'example'), {
      recursive: true,
      filter: (source) => !source.endsWith('live-e2e.js') && !source.endsWith('server.test.js'),
    });

    result = await runDevStart(
      async (cwd) => {
        serverState = await startDevServer({ cwd, stateFile });
        return serverState;
      },
      (cwd, url) => browser.openReady(cwd, url),
      project,
    );

    assert.equal(result.status, 'running', 'dev_start should leave the example server running');
    assert.equal(result.browser, 'opened', result.browserError ?? 'dev_start should open managed Chrome');
    assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
    assert.equal(result.browserMode, 'managed');

    const registration = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
    assert.ok(registration, `expected ${MCP_SERVER_NAME} to be registered`);
    assert.equal(registration.config.exposure, 'direct');
    assert.ok(registration.config.args.includes(`--browser-url=${result.browserUrl}`));

    const page = await waitForPage(result.browserUrl, result.url);
    const response = await fetch(result.url, { redirect: 'error' });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Pi Devloop Example<\/title>/);
    assert.match(html, /id="e2e-marker"/);

    summary = {
      status: 'passed',
      readyUrl: result.url,
      browserUrl: result.browserUrl,
      pageUrl: page.url,
      mcpServer: registration.name,
      pageTitle: page.title,
    };
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = [];
  try { await closeBrowser(browser, launcher); } catch (error) { cleanupErrors.push(error); }
  try {
    const stopped = await stopDevServer(stateFile, { cwd: project });
    if (serverState?.status === 'running' && stopped.status !== 'stopped') throw new Error('Herdr dev server did not stop');
  } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length === 0) {
    try { await rm(project, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  } else {
    cleanupErrors.push(new Error(`Test project retained for safety at ${project}`));
  }

  if (failure && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'E2E failed and cleanup was incomplete');
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'E2E cleanup failed');
  return summary;
}

runLiveTest().then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error(`dev_start live E2E failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
