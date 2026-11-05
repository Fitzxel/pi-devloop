# pi-devloop

A Pi extension starter for dev-server feedback and browser element selection through Herdr.

## Status

This is an early scaffold. It includes Herdr `dev_start`, `dev_status`, `dev_logs`, and `dev_stop` tools; a loopback feedback receiver; a browser overlay script; and on-demand Chrome DevTools MCP integration. Chrome launch management, source-location mapping, and automatic overlay injection are not implemented yet.

## Install / load

The extension entry point is `src/index.ts`; its package manifest declares it under `pi.extensions`. In a Pi project, load this package from a trusted source or test locally with `pi -e ./src/index.ts`.

The extension relies on the host-provided `@earendil-works/pi-coding-agent` and `typebox` imports. It has no external runtime dependencies.

## Included example

From the repository root, `npm start` serves `example/index.html` on an ephemeral loopback port and prints an HTTP ready URL. `dev_start` can use this package script as its default command, making the repository a self-contained smoke-test project.

## Live dev_start smoke test

From a Herdr-managed pane (`HERDR_ENV=1`), run:

```sh
npm run test:e2e
```

The opt-in runner copies the package and example into a temporary project, invokes the same shared orchestration used by the `dev_start` tool, creates a Herdr tab that runs `npm start`, waits for its ready URL, opens a managed Chrome window, and verifies the Chrome target and served page before cleaning up the tab, browser, and temporary project. It requires Herdr and an installed Chrome executable; set `CHROME_PATH` if Chrome is not on the standard path. It does not require an LLM or network package download. The runner uses a test Pi host stub to assert the native MCP registration name/config and does **not** launch the Chrome DevTools MCP process, so it does not verify live MCP tool exposure.

Installing or reloading the extension alone does not start a project or open Chrome. The automatic browser flow begins when an agent invokes `dev_start`; `/devloop:start` remains a direct server command and does not open Chrome.

## Herdr dev server

Run Pi inside a Herdr-managed pane (`HERDR_ENV=1`). The extension exposes both agent tools (`dev_start`, `dev_status`, `dev_logs`, `dev_stop`) and Pi commands. When the agent invokes `dev_start` and readiness returns a URL, the extension automatically registers Chrome DevTools MCP and directs the agent to use the `pi-devloop-chrome` browser tools to navigate to that exact URL. This automation applies only to the agent tool; `/devloop:start` and `/devloop:browser` retain their existing behavior. Missing URLs skip browser registration, and registration errors preserve the running server state and provide a retry path.

Commands:

- `/devloop:start`, `/devloop:stop`, `/devloop:status`, `/devloop:logs [line-count]`
- `/devloop:config` shows effective and explicitly configured project settings.
- `/devloop:set command <shell command>` sets the command; `/devloop:set url <http(s) URL>` sets a fixed URL override; `/devloop:set timeout <milliseconds>` sets the ready-output timeout.
- `/devloop:set layout tab|split` chooses a new tab or a sibling split pane. The default is `tab`.
- `/devloop:set tabName <name>` sets the label for the new tab; the default is `devloop`.
- `/devloop:set browserUrl <http(s) URL>` optionally selects an existing debuggable Chrome instance instead of the MCP-managed isolated profile.
- Omit the value to clear an override, for example `/devloop:set url`. Clearing `layout` restores the `tab` default; clearing `tabName` restores `devloop`; clearing `browserUrl` restores the MCP-managed isolated profile.

These settings are stored in the current project's `.pi/devloop.json`; no manual file creation is needed. An unset command is detected from `scripts.dev` / `scripts.start` in `package.json`, an unset dev-server URL is parsed from ready output, and timeout defaults to 30000 ms. A configured dev-server URL overrides the URL parsed from startup output; with `browserUrl` unset, Chrome DevTools MCP launches its isolated browser when explicitly requested. Legacy `readyPattern` and `readyTimeoutMs` config values remain supported.

The configured command is submitted to Herdr's shell. Only set it in a project you trust. Runtime state is stored at `.pi/devloop/state.json`; add that file to `.gitignore` if you do not want it tracked. `dev_stop` closes the tab created for a tab layout, or just the pane for a split layout.

## Chrome DevTools MCP

Pi does not start Chrome when the extension loads. When the agent invokes `dev_start` and the dev server reports a ready URL, the extension **opens that URL in a Chrome window immediately**, then registers the native `pi-devloop-chrome` MCP against that same browser. With no `browserUrl` configured, devloop launches Chrome with `--enable-automation`, a unique temporary user-data directory, and an ephemeral remote-debugging port; the tool result includes the URL and browser mode. Set `CHROME_PATH` if Chrome is not available under the standard executable name for your platform. If the browser launch or MCP attachment fails, `dev_start` still reports the running server and the browser error. This automation is for the agent tool `dev_start`; the `/devloop:start` command keeps its existing behavior.

If `browserUrl` is configured, devloop does not launch or close an existing browser: it opens the ready URL in a new tab through Chrome's DevTools endpoint and attaches the MCP to that browser. Only configure an endpoint for a browser profile you intend to expose to the agent.

Manual activation remains available. Run `/devloop:browser` or call `browser_connect` to register Chrome DevTools MCP without starting the dev server. In this manual path, an unset `browserUrl` uses the MCP's `--isolated` mode and Chrome launches on the first browser-tool call; `npx -y chrome-devtools-mcp@latest` may download the MCP package on first use. Use tools such as `new_page`, `navigate_page`, `take_snapshot`, and `take_screenshot` for subsequent browser work.

To attach manually to an existing Chrome, start it with remote debugging and a dedicated user-data directory (Chrome 136+ does not allow remote debugging against its default profile). Example on Linux:

```sh
mkdir -p "$HOME/.cache/pi-devloop/chrome-profile"
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/pi-devloop/chrome-profile"
```

Set `/devloop:set browserUrl http://127.0.0.1:9222` (or the endpoint you started Chrome with), then run `/devloop:browser`. `/devloop:browser-status` and `browser_status` report registration and mode; `/mcp` shows live connection details. `/devloop:browser-stop` or `browser_disconnect` closes only a Chrome process launched by devloop and cleans its temporary profile; a configured existing browser is left open. `/devloop:stop` stops the dev server but leaves the Chrome window open. Browser tools can navigate pages and execute page scripts, so only expose a profile to the agent when you intend it.

## Browser feedback receiver

Run `/devloop` in Pi to start the per-session HTTP receiver and show its port and bearer token. It binds only to `127.0.0.1`. The endpoint accepts `POST /selection` with JSON and a same-origin localhost `Origin`. The token is intended for a locally controlled browser page; do not expose it to arbitrary websites. The receiver validates payload lengths before sending a user message to the active Pi session.

`overlay/devloop.js` is a standalone starter script. Before loading it, set:

```js
window.__PI_DEVLOOP__ = {
  endpoint: 'http://127.0.0.1:PORT/selection',
  token: 'TOKEN_SHOWN_BY_/devloop'
};
```

Then evaluate the script in the target page. It highlights elements, opens a small instruction form on click, and submits a bounded description. Do not inject it into pages that should not receive prompts or expose sensitive page data.

## Development

```sh
npm test
```
