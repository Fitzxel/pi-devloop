export async function automateDevStart(state, registerBrowser, cwd) {
  if (state?.status !== 'running') return state;
  if (typeof state.url !== 'string' || !state.url.trim()) {
    return { ...state, browser: 'skipped', guidance: 'Browser opening skipped because the dev server has no ready URL.' };
  }
  try {
    await registerBrowser(cwd);
    return { ...state, browser: 'registered', guidance: `Use the pi-devloop-chrome browser tools to navigate to ${state.url}.` };
  } catch (error) {
    return { ...state, browser: 'error', browserError: error instanceof Error ? error.message : String(error), guidance: `Retry browser registration with browser_connect, then navigate to ${state.url}.` };
  }
}
