import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getProjectConfig, readProjectSettings } from './project-config.js';

const exec = promisify(execFile);
const READY_DEFAULT = '(https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?\\/?|ready in .+)';

export function resolveDevUrl(configuredUrl, readyOutput) {
  return configuredUrl ?? readyOutput.match(/https?:\/\/[^\s\u001b]+/)?.[0] ?? null;
}

export function buildPaneCreationCommand(cwd, config = {}, env = process.env) {
  if ((config.layout ?? 'tab') === 'split') {
    return {
      layout: 'split',
      args: ['pane', 'split', '--current', '--direction', 'right', '--cwd', cwd, '--no-focus'],
    };
  }
  const args = ['tab', 'create'];
  if (env.HERDR_WORKSPACE_ID) args.push('--workspace', env.HERDR_WORKSPACE_ID);
  args.push('--cwd', cwd, '--label', config.tabName ?? 'devloop', '--no-focus');
  return { layout: 'tab', args };
}

export function buildPaneCloseCommand(state) {
  return state.layout === 'tab' && state.tab_id
    ? ['tab', 'close', state.tab_id]
    : ['pane', 'close', state.pane_id];
}

export async function runHerdr(args, { cwd = process.cwd(), env = process.env } = {}) {
  if (env.HERDR_ENV !== '1') throw new Error('Not running inside a Herdr-managed pane (HERDR_ENV=1 required).');
  try {
    const { stdout } = await exec('herdr', args, { cwd, env, timeout: 15000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Herdr command failed: ${error.stderr?.trim() || error.message}`);
  }
}

export async function loadConfig(cwd) {
  const configured = await readProjectSettings(cwd);
  const effective = await getProjectConfig(cwd);
  return {
    ...configured,
    command: validateCommand(effective.command),
    url: effective.url,
    timeout: effective.timeout,
    readyPattern: configured.readyPattern ?? READY_DEFAULT,
    readyTimeoutMs: effective.timeout,
  };
}

function validateCommand(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 2000 || /[\0\r\n]/.test(command)) throw new Error('Configured command must be a non-empty single-line string.');
  return command;
}

export async function startDevServer({ cwd = process.cwd(), config: supplied, stateFile = path.join(cwd, '.pi/devloop/state.json') } = {}) {
  const config = supplied ?? await loadConfig(cwd);
  const creation = buildPaneCreationCommand(cwd, config, process.env);
  const paneOutput = await runHerdr(creation.args, { cwd });
  const created = JSON.parse(paneOutput);
  const paneId = creation.layout === 'tab' ? created.result?.root_pane?.pane_id : created.result?.pane?.pane_id;
  const tabId = creation.layout === 'tab' ? (created.result?.tab?.tab_id ?? created.result?.tab?.id) : undefined;
  if (!paneId || (creation.layout === 'tab' && !tabId)) throw new Error(`Herdr ${creation.layout} creation did not return its pane and tab IDs.`);
  try {
    await runHerdr(['pane', 'run', paneId, config.command], { cwd });
    const pattern = config.readyPattern ?? READY_DEFAULT;
    const readyOutput = await runHerdr(['pane', 'wait-output', paneId, '--regex', pattern, '--source', 'recent-unwrapped', '--timeout', String(config.timeout ?? config.readyTimeoutMs ?? 30000)], { cwd });
    const url = resolveDevUrl(config.url, readyOutput);
    const state = { pane_id: paneId, tab_id: tabId, layout: creation.layout, tab_name: creation.layout === 'tab' ? (config.tabName ?? 'devloop') : undefined, command: config.command, url, status: 'running', started_at: new Date().toISOString() };
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    return state;
  } catch (error) {
    try {
      await runHerdr(buildPaneCloseCommand({ layout: creation.layout, pane_id: paneId, tab_id: tabId }), { cwd });
    } catch { /* preserve original error */ }
    throw error;
  }
}

export async function readDevState(stateFile) {
  try { return JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function getDevLogs(state, { cwd = process.cwd(), lines = 80 } = {}) {
  if (!Number.isInteger(lines) || lines < 1 || lines > 500) throw new Error('lines must be an integer between 1 and 500');
  return runHerdr(['pane', 'read', state.pane_id, '--source', 'recent-unwrapped', '--lines', String(lines)], { cwd });
}

export async function stopDevServer(stateFile, { cwd = process.cwd() } = {}) {
  const state = await readDevState(stateFile);
  if (!state) return { status: 'stopped' };
  await runHerdr(buildPaneCloseCommand(state), { cwd });
  await writeFile(stateFile, `${JSON.stringify({ ...state, status: 'stopped' }, null, 2)}\n`, { mode: 0o600 });
  return { ...state, status: 'stopped' };
}
