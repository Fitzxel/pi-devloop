export async function runDevStart(startServer, openBrowser, cwd) {
  const state = await startServer(cwd);
  return automateDevStart(state, openBrowser, cwd);
}

export function createDevStartManager({ startServer, isAlive = async () => false, openBrowser, closeBrowser = async () => {}, stopServer = async () => {}, createToken = () => globalThis.crypto.randomUUID(), receiverPort = 0 }) {
  const states = new Map();
  const locks = new Map();
  async function start(cwd) {
    const previous = locks.get(cwd) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const current = states.get(cwd);
      if (current?.status === 'running' && await isAlive(current, cwd)) return { ...current, browser: 'already-running' };
      if (current?.status === 'running') {
        await stopServer(current, cwd);
        current.status = 'stopped';
        await closeBrowser(cwd);
      }
      const token = createToken();
      let state = await startServer(cwd, token);
      if (state?.status !== 'running') return state;
      state = { ...state, feedback: state.feedback ?? { token, endpoint: `http://127.0.0.1:${receiverPort}/selection`, targetOrigin: new URL(state.url).origin } };
      states.set(cwd, state);
      return automateDevStart(state, async (project, url, value) => openBrowser(project, url, value), cwd);
    });
    locks.set(cwd, pending);
    try { return await pending; } finally { if (locks.get(cwd) === pending) locks.delete(cwd); }
  }
  async function status(cwd) {
    const state = states.get(cwd);
    if (!state || state.status !== 'running') return state ?? { status: 'stopped' };
    if (!await isAlive(state, cwd)) { await stopServer(state, cwd); state.status = 'stopped'; await closeBrowser(cwd); }
    return { ...state };
  }
  async function stop(cwd) {
    const state = states.get(cwd);
    if (!state || state.status !== 'running') return { status: 'stopped' };
    await stopServer(state, cwd);
    state.status = 'stopped';
    await closeBrowser(cwd);
    return { ...state };
  }
  return { start, status, stop };
}

export async function runDevStartCommand(ctx, startServer, openBrowser, afterStart) {
  try {
    const result = openBrowser ? await runDevStart(startServer, openBrowser, ctx.cwd) : await startServer(ctx.cwd);
    await afterStart?.(ctx);
    ctx.ui.notify(JSON.stringify(result, null, 2), 'info');
    return result;
  } catch (error) {
    ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

export function registerDevStartCommand(pi, startServer, openBrowser, afterStart) {
  pi.registerCommand('devloop:start', {
    description: 'Start the project dev server in Herdr, wait for readiness, and open the ready URL in Chrome',
    handler: async (_args, ctx) => runDevStartCommand(ctx, startServer, openBrowser, afterStart),
  });
}

export async function automateDevStart(state, openBrowser, cwd) {
  if (state?.status !== 'running') return state;
  if (typeof state.url !== 'string' || !state.url.trim()) {
    return { ...state, browser: 'skipped', browserReason: 'No ready URL was detected.' };
  }
  try {
    const browser = await openBrowser(cwd, state.url, state.feedback);
    return {
      ...state,
      browser: 'opened',
      browserMode: browser.mode,
      browserUrl: browser.browserUrl,
      browserServerName: browser.serverName,
    };
  } catch (error) {
    return {
      ...state,
      browser: 'error',
      browserError: error instanceof Error ? error.message : String(error),
    };
  }
}
