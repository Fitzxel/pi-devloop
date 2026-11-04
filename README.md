# pi-devloop

A Pi extension starter for dev-server feedback and browser element selection through Herdr.

## Status

This is an early scaffold. It includes Herdr `dev_start`, `dev_status`, `dev_logs`, and `dev_stop` tools; a loopback feedback receiver; a browser overlay script; and on-demand Chrome DevTools MCP integration. Chrome launch management, source-location mapping, and automatic overlay injection are not implemented yet.

## Install / load

The extension entry point is `src/index.ts`; its package manifest declares it under `pi.extensions`. In a Pi project, load this package from a trusted source or test locally with `pi -e ./src/index.ts`.

The extension relies on the host-provided `@earendil-works/pi-coding-agent` and `typebox` imports. It has no external runtime dependencies.

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

Chrome DevTools MCP is on demand: Pi does not start Chrome when the extension loads or when the dev server becomes ready. Run `/devloop:browser` or let the agent call `browser_connect` to register the MCP server. With no `browserUrl` configured, it uses `--isolated`: the MCP launches Chrome with a temporary user-data directory on the first browser-tool call, and removes that profile when the browser closes. The window shows Chrome's automation-control banner. Registration runs `npx -y chrome-devtools-mcp@latest` and may download the MCP package on first use. Use `new_page`, `navigate_page`, `take_snapshot`, and `take_screenshot` for browser work.

To attach to an existing Chrome instead, start it with remote debugging and a dedicated user-data directory (Chrome 136+ does not allow remote debugging against its default profile). Example on Linux:

```sh
mkdir -p "$HOME/.cache/pi-devloop/chrome-profile"
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/pi-devloop/chrome-profile"
```

Set `/devloop:set browserUrl http://127.0.0.1:9222` (or the endpoint you started Chrome with), then run `/devloop:browser`; this preserves the existing-browser attach path and does not pass `--isolated`. `/devloop:browser-status` and `browser_status` report whether the server is registered and its `managed` or `attach` mode; registration alone does not mean Chrome has launched yet. `/mcp` shows live connection state and tool details. `/devloop:browser-stop` or `browser_disconnect` closes the MCP-managed browser and cleans up its temporary profile; in attach mode it only disconnects and leaves existing Chrome open. Since browser tools can navigate pages and execute page scripts, only attach to an existing profile you intend to expose to the agent.

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
