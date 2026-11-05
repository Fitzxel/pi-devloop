export async function runDevStart(startServer, openBrowser, cwd) {
  const state = await startServer(cwd);
  return automateDevStart(state, openBrowser, cwd);
}

export async function runDevStartCommand(ctx, startServer, openBrowser) {
  try {
    const result = await runDevStart(startServer, openBrowser, ctx.cwd);
    ctx.ui.notify(JSON.stringify(result, null, 2), 'info');
    return result;
  } catch (error) {
    ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

export function registerDevStartCommand(pi, startServer, openBrowser) {
  pi.registerCommand('devloop:start', {
    description: 'Start the project dev server in Herdr, wait for readiness, and open the ready URL in Chrome',
    handler: async (_args, ctx) => runDevStartCommand(ctx, startServer, openBrowser),
  });
}

export async function automateDevStart(state, openBrowser, cwd) {
  if (state?.status !== 'running') return state;
  if (typeof state.url !== 'string' || !state.url.trim()) {
    return { ...state, browser: 'skipped', browserReason: 'No ready URL was detected.' };
  }
  try {
    const browser = await openBrowser(cwd, state.url);
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
