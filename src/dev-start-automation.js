export async function runDevStart(startServer, openBrowser, cwd) {
  const state = await startServer(cwd);
  return automateDevStart(state, openBrowser, cwd);
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
