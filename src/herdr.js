import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const READY_DEFAULT = '(https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?\\/?|ready in .+)';

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
  let config = {};
  try { config = JSON.parse(await readFile(path.join(cwd, '.pi/devloop.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Invalid .pi/devloop.json: ${error.message}`); }
  if (config.command) return { ...config, command: validateCommand(config.command) };
  let pkg;
  try { pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')); }
  catch { throw new Error('Set "command" in .pi/devloop.json or add a package.json dev script.'); }
  const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null;
  if (!script) throw new Error('No package.json dev or start script found; configure .pi/devloop.json.');
  return { readyPattern: READY_DEFAULT, ...config, command: `npm run ${script}` };
}

function validateCommand(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 2000 || /[\0\r\n]/.test(command)) throw new Error('Configured command must be a non-empty single-line string.');
  return command;
}

export async function startDevServer({ cwd = process.cwd(), config: supplied, stateFile = path.join(cwd, '.pi/devloop/state.json') } = {}) {
  const config = supplied ?? await loadConfig(cwd);
  const paneOutput = await runHerdr(['pane', 'split', '--current', '--direction', 'right', '--cwd', cwd, '--no-focus'], { cwd });
  const created = JSON.parse(paneOutput);
  const paneId = created.result?.pane?.pane_id;
  if (!paneId) throw new Error('Herdr pane split did not return result.pane.pane_id.');
  try {
    await runHerdr(['pane', 'run', paneId, config.command], { cwd });
    const pattern = config.readyPattern ?? READY_DEFAULT;
    const readyOutput = await runHerdr(['pane', 'wait-output', paneId, '--regex', pattern, '--source', 'recent-unwrapped', '--timeout', String(config.readyTimeoutMs ?? 30000)], { cwd });
    const url = readyOutput.match(/https?:\/\/[^\s\u001b]+/)?.[0] ?? null;
    const state = { pane_id: paneId, command: config.command, url, status: 'running', started_at: new Date().toISOString() };
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    return state;
  } catch (error) {
    try { await runHerdr(['pane', 'close', paneId], { cwd }); } catch { /* preserve original error */ }
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
  await runHerdr(['pane', 'close', state.pane_id], { cwd });
  await writeFile(stateFile, `${JSON.stringify({ ...state, status: 'stopped' }, null, 2)}\n`, { mode: 0o600 });
  return { ...state, status: 'stopped' };
}
