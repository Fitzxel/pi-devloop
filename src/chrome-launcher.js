import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp as nodeMkdtemp, readFile as nodeReadFile, rm as nodeRm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const START_TIMEOUT_MS = 10000;
const STOP_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 50;

export function createChromeLauncher(deps = {}) {
  const spawn = deps.spawn ?? nodeSpawn;
  const mkdtemp = deps.mkdtemp ?? nodeMkdtemp;
  const readFile = deps.readFile ?? nodeReadFile;
  const rm = deps.rm ?? nodeRm;
  const fetcher = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  let owned;
  let operation = Promise.resolve();
  const serialize = (action) => {
    const pending = operation.then(action, action);
    operation = pending.catch(() => {});
    return pending;
  };

  return {
    open(url) {
      const targetUrl = validateTargetUrl(url);
      return serialize(async () => {
        if (owned?.endpoint && isRunning(owned.child)) {
          await openNewPage(owned.endpoint, targetUrl);
          return { browserUrl: owned.endpoint, owned: true };
        }
        if (owned) await closeOwned();
        return launch(targetUrl);
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

  async function launch(url) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-chrome-'));
    const args = [
      '--enable-automation',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${directory}`,
      '--remote-debugging-port=0',
      '--new-window',
      url,
    ];
    let lastError;
    let started = false;

    try {
      for (const executable of chromeCandidates(platform, env)) {
        let child;
        try {
          child = spawn(executable, args, { stdio: 'ignore', windowsHide: false, env });
          await waitForSpawn(child);
          owned = { child, directory, endpoint: null };
          started = true;
          break;
        } catch (error) {
          lastError = error;
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
      }
      if (!started) throw new Error(`Chrome could not be started: ${lastError?.message ?? 'no Chrome executable found'}`, { cause: lastError });

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

function chromeCandidates(platform, env) {
  if (typeof env.CHROME_PATH === 'string' && env.CHROME_PATH.trim()) return [env.CHROME_PATH];
  if (platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
  ];
  if (platform === 'win32') return [
    env.PROGRAMFILES ? path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : 'chrome.exe',
    env['PROGRAMFILES(X86)'] ? path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : 'chrome.exe',
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : 'chrome.exe',
    'chrome.exe',
  ];
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
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
