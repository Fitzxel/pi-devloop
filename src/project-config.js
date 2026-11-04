import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const CONFIG_PATH = '.pi/devloop.json';
const ALLOWED_KEYS = new Set(['command', 'url', 'timeout', 'layout', 'tabName', 'browserUrl']);
const DEFAULT_BROWSER_URL = 'http://127.0.0.1:9222';

export async function readProjectSettings(cwd) {
  let config;
  try { config = JSON.parse(await readFile(path.join(cwd, CONFIG_PATH), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Invalid ${CONFIG_PATH}: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${CONFIG_PATH} must contain a JSON object.`);
  return config;
}

export function parseSettingArgs(args) {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) throw new Error('Usage: /devloop:set <command|url|timeout|layout|tabName|browserUrl> [value]');
  if (!ALLOWED_KEYS.has(match[1])) throw new Error('Setting must be one of: command, url, timeout, layout, tabName, browserUrl');
  const value = match[2]?.trim();
  return { key: match[1], value: value || undefined };
}

export async function getProjectConfig(cwd) {
  const configured = await readProjectSettings(cwd);
  let command = configured.command;
  if (command === undefined) {
    let pkg;
    try { pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')); }
    catch { pkg = null; }
    const script = pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.start ? 'start' : null;
    command = script ? `npm run ${script}` : null;
  }
  return {
    command,
    url: configured.url ?? null,
    timeout: configured.timeout ?? configured.readyTimeoutMs ?? 30000,
    layout: configured.layout ?? 'tab',
    tabName: configured.tabName ?? 'devloop',
    browserUrl: configured.browserUrl == null ? DEFAULT_BROWSER_URL : validateHttpUrl(configured.browserUrl, 'browserUrl'),
    configured: {
      command: configured.command ?? null,
      url: configured.url ?? null,
      timeout: configured.timeout ?? null,
      layout: configured.layout ?? null,
      tabName: configured.tabName ?? null,
      browserUrl: configured.browserUrl ?? null,
    },
  };
}

function validateHttpUrl(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} must be an http or https URL`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an http or https URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error(`${name} must be an http or https URL`);
  if (name === 'browserUrl' && (parsed.username || parsed.password)) throw new Error(`${name} must not include credentials`);
  return value;
}

export async function setProjectConfig(cwd, key, rawValue) {
  if (!ALLOWED_KEYS.has(key)) throw new Error(`key must be one of: ${[...ALLOWED_KEYS].join(', ')}`);
  const config = await readProjectSettings(cwd);
  if (rawValue === undefined || rawValue === '') {
    delete config[key];
  } else if (key === 'command') {
    if (typeof rawValue !== 'string' || !rawValue.trim() || rawValue.length > 2000 || /[\0\r\n]/.test(rawValue)) {
      throw new Error('command must be a non-empty single-line string (max 2000 characters)');
    }
    config.command = rawValue;
  } else if (key === 'url' || key === 'browserUrl') {
    validateHttpUrl(rawValue, key);
    config[key] = rawValue;
  } else if (key === 'layout') {
    if (rawValue !== 'tab' && rawValue !== 'split') throw new Error('layout must be tab or split');
    config.layout = rawValue;
  } else if (key === 'tabName') {
    if (typeof rawValue !== 'string' || !rawValue.trim() || rawValue.length > 80 || /[\0\r\n]/.test(rawValue)) {
      throw new Error('tabName must be a non-empty single-line string (max 80 characters)');
    }
    config.tabName = rawValue.trim();
  } else {
    const timeout = typeof rawValue === 'number' ? rawValue : /^\d+$/.test(rawValue) ? Number(rawValue) : NaN;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('timeout must be a positive integer in milliseconds');
    config.timeout = timeout;
  }

  const directory = path.join(cwd, path.dirname(CONFIG_PATH));
  const file = path.join(cwd, CONFIG_PATH);
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return getProjectConfig(cwd);
}
