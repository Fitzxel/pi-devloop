import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp as nodeMkdtemp, readFile as nodeReadFile, rm as nodeRm, cp as nodeCp, writeFile as nodeWriteFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeForTestingResolver } from './chrome-for-testing.js';

const START_TIMEOUT_MS = 10000;
const STOP_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 50;

export function createChromeLauncher(deps = {}) {
  const spawn = deps.spawn ?? nodeSpawn;
  const mkdtemp = deps.mkdtemp ?? nodeMkdtemp;
  const readFile = deps.readFile ?? nodeReadFile;
  const cp = deps.cp ?? nodeCp;
  const writeFile = deps.writeFile ?? nodeWriteFile;
  const rm = deps.rm ?? nodeRm;
  const fetcher = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const resolveChromeForTesting = deps.resolveChromeForTesting ?? createChromeForTestingResolver({
    platform,
    arch: deps.arch ?? process.arch,
    env,
    cacheDirectory: deps.chromeForTestingCacheDirectory,
    fetch: deps.fetch,
  });
  let owned;
  let operation = Promise.resolve();
  const serialize = (action) => {
    const pending = operation.then(action, action);
    operation = pending.catch(() => {});
    return pending;
  };

  return {
    open(url, extensionConfig) {
      const targetUrl = validateTargetUrl(url);
      return serialize(async () => {
        if (owned?.endpoint && isRunning(owned.child)) {
          await openNewPage(owned.endpoint, targetUrl);
          return { browserUrl: owned.endpoint, owned: true };
        }
        if (owned) await closeOwned();
        return launch(targetUrl, extensionConfig);
      });
    },

    openConfigured(endpoint, url) {
      const browserUrl = validateBrowserEndpoint(endpoint);
      const targetUrl = validateTargetUrl(url);
      return serialize(async () => {
        await openNewPage(browserUrl, targetUrl);
        return { browserUrl, owned: false };
      });
    },

    close() {
      return serialize(closeOwned);
    },

    get owned() { return Boolean(owned); },
    get endpoint() { return owned?.endpoint ?? null; },
  };

  async function launch(url, extensionConfig) {
    const executable = typeof env.PI_DEVLOOP_CHROME_PATH === 'string' && env.PI_DEVLOOP_CHROME_PATH.trim()
      ? env.PI_DEVLOOP_CHROME_PATH
      : await resolveChromeForTesting();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-chrome-'));
    const extensionDirectory = path.join(directory, 'extension');
    const config = extensionConfig ?? { endpoint: '', token: '', targetOrigin: new URL(url).origin };
    await cp(deps.extensionDirectory ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension'), extensionDirectory, { recursive: true });
    const manifestPath = path.join(extensionDirectory, 'manifest.json');
    const manifest = JSON.parse(await nodeReadFile(manifestPath, 'utf8'));
    manifest.host_permissions = [toMatchPattern(config.targetOrigin)];
    if (config.endpoint) manifest.host_permissions.push(toMatchPattern(new URL(config.endpoint).origin));
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}${String.fromCharCode(10)}`);
    await writeFile(path.join(extensionDirectory, 'service-worker.js'), `globalThis.DEVLOOP_CONFIG = ${JSON.stringify(config)};${String.fromCharCode(10)}${await nodeReadFile(path.join(extensionDirectory, 'service-worker.js'), 'utf8')}`);
    const args = [
      '--enable-automation',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${directory}`,
      '--remote-debugging-port=0',
      `--load-extension=${extensionDirectory}`,
      '--new-window',
      url,
    ];
    try {
      let child;
      try {
        child = spawn(executable, args, { stdio: 'ignore', windowsHide: false, env });
        await waitForSpawn(child);
      } catch (error) {
        throw new Error(`Chrome could not be started: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      owned = { child, directory, endpoint: null };
      owned.endpoint = await waitForDevTools(owned.child, directory);
      return { browserUrl: owned.endpoint, owned: true };
    } catch (error) {
      try {
        if (owned?.directory === directory) await closeOwned();
        else await rm(directory, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}; Chrome cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, { cause: error });
      }
      throw error;
    }
  }

  async function waitForDevTools(child, directory) {
    const activePortFile = path.join(directory, 'DevToolsActivePort');
    const deadline = now() + (deps.startTimeoutMs ?? START_TIMEOUT_MS);
    let lastError;
    while (now() < deadline) {
      if (child.exitCode != null || child.signalCode != null) {
        throw new Error(`Chrome exited before DevTools was ready (${child.exitCode ?? child.signalCode})`);
      }
      try {
        const port = Number((await readFile(activePortFile, 'utf8')).split(/\s+/)[0]);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
          const endpoint = `http://127.0.0.1:${port}`;
          const response = await fetcher(`${endpoint}/json/version`, { redirect: 'error' });
          if (response.ok) return endpoint;
          lastError = new Error(`Chrome DevTools endpoint returned HTTP ${response.status}`);
        }
      } catch (error) { lastError = error; }
      await sleep(deps.pollIntervalMs ?? POLL_INTERVAL_MS);
    }
    throw new Error(`Chrome DevTools did not become ready${lastError ? `: ${lastError.message}` : ''}`);
  }

  async function openNewPage(endpoint, url) {
    const base = validateBrowserEndpoint(endpoint);
    const target = new URL('/json/new', base);
    target.search = `?${encodeURIComponent(url)}`;
    const response = await fetcher(target.toString(), { method: 'PUT', redirect: 'error' });
    if (!response.ok) throw new Error(`Chrome DevTools navigation failed with HTTP ${response.status}`);
  }

  async function closeOwned() {
    if (!owned) return false;
    const current = owned;
    const child = current.child;
    if (isRunning(child)) {
      let exited = await waitForExit(child, deps.stopTimeoutMs ?? STOP_TIMEOUT_MS, () => child.kill('SIGTERM'));
      if (!exited) exited = await waitForExit(child, deps.stopTimeoutMs ?? STOP_TIMEOUT_MS, () => child.kill('SIGKILL'));
      if (!exited) throw new Error('Chrome did not exit; its temporary profile was left intact');
    }
    await rm(current.directory, { recursive: true, force: true });
    if (owned === current) owned = undefined;
    return true;
  }
}

function toMatchPattern(origin) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Extension permissions require an exact http or https origin');
  return `${url.origin}/*`;
}

function validateTargetUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Dev-server URL must be a valid http or https URL to open Chrome'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('Dev-server URL must be a valid http or https URL to open Chrome');
  return value;
}

function validateBrowserEndpoint(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('browserUrl must be an http or https URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('browserUrl must be an http or https URL');
  if (parsed.username || parsed.password) throw new Error('browserUrl must not include credentials');
  return value.replace(/\/+$/, '');
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

function isRunning(child) {
  return child.exitCode == null && child.signalCode == null;
}

function waitForExit(child, timeoutMs, signal) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(exited);
    };
    const timer = setTimeout(() => finish(child.exitCode != null || child.signalCode != null), timeoutMs);
    timer.unref?.();
    child.once('exit', () => finish(true));
    try { signal(); } catch { /* verify exit below and leave the profile if the process survives */ }
  });
}
