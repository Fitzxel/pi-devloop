# pi-devloop

Pi extension for browser-driven development. Start a project dev server with Herdr, open its ready URL in Chrome, and connect Chrome DevTools tools to inspect and iterate on the page. The browser feedback extension can send selected page elements and instructions back to Pi.

## Requirements

- Pi and Node.js 20 or newer.
- Herdr on `PATH`, with Pi running in a Herdr-managed pane (`HERDR_ENV=1`), for dev-server commands.
- Chrome integration is optional. Managed Chrome may download Chrome for Testing on first use; this requires network access and, on Linux/macOS, `unzip`. The Chrome DevTools MCP package may also be downloaded via `npx` on first use.

## Install

Install the published package in Pi:

```sh
pi install npm:@fitzxel/pi-devloop
```

Restart Pi or run `/reload` after installation. Loading the extension does not start a server or launch Chrome.

To try the current checkout instead:

```sh
pi -e ./src/index.ts
```

## Quick start

Run Pi inside a Herdr-managed pane, then:

```text
/devloop:start
```

This starts the configured command, waits for its ready URL, opens that URL in Chrome, and registers Chrome DevTools MCP against the same browser. The `dev_start` agent tool follows the same flow. If browser setup fails, the server remains running and can be managed or retried separately.

This repository includes a small example server. From the checkout, run `npm start`; it serves `example/index.html` on an ephemeral loopback port. Use it to try devloop's start flow.

## Commands

| Command | Purpose |
| --- | --- |
| `/devloop:start` | Start the server and open its ready URL in Chrome. |
| `/devloop:stop` | Stop the dev server; leaves the Chrome window open. |
| `/devloop:status` | Show observed server and browser-registration state. |
| `/devloop:logs [line-count]` | Show recent server output. |
| `/devloop:config` | Show effective and explicitly configured project settings. |
| `/devloop:set <setting> [value]` | Set or clear a project setting; see Configuration. |
| `/devloop:browser` | Register Chrome DevTools MCP without starting the server. |
| `/devloop:browser-status` | Show MCP registration and browser mode. |
| `/devloop:browser-stop` | Disconnect MCP and close only a browser launched by devloop. |
| `/devloop` | Start a standalone browser feedback receiver for this Pi session. |

The extension also exposes the `dev_start`, `dev_status`, `dev_logs`, and `dev_stop` agent tools, plus `browser_connect`, `browser_status`, and `browser_disconnect`.

## Configuration

Settings are stored in the current project's `.pi/devloop.json`; use `/devloop:set` to change them. Omit the value to clear an override.

| Setting | Purpose / default |
| --- | --- |
| `command` | Shell command to start. If unset, uses `scripts.dev` or `scripts.start` from `package.json`. |
| `url` | Fixed dev-server URL override. If unset, devloop parses the ready URL from server output. |
| `timeout` | Ready-output timeout in milliseconds; defaults to `30000`. |
| `readyPattern` | Regular expression matched against server output to detect readiness; defaults to devloop's built-in pattern. |
| `layout` | Herdr placement: `tab` (default) or `split`. |
| `tabName` | Label for a new tab; defaults to `devloop`. |
| `browserUrl` | Existing debuggable Chrome endpoint. If unset, browser integration launches an isolated managed browser. |

Examples:

```text
/devloop:set command npm run dev
/devloop:set url http://localhost:5173
/devloop:set timeout 60000
/devloop:set readyPattern Ready\s+in
/devloop:set layout split
/devloop:set browserUrl http://127.0.0.1:9222
/devloop:set readyPattern
```

The configured shell command is run by Herdr; only configure commands in projects you trust. `readyPattern` is configurable with `/devloop:set`; `readyTimeoutMs` is a legacy alias for `timeout` and is used only when `timeout` is unset. Devloop keeps active lifecycle state in memory and does not write `.pi/devloop/state.json`.

## Browser and page feedback

When a dev server reports a ready URL, `/devloop:start` and `dev_start` open it in Chrome and attach MCP to that browser. With no `browserUrl`, devloop manages a Chrome for Testing Stable installation in the user cache; set `PI_DEVLOOP_CHROME_PATH` to use a compatible Chrome/Chromium executable instead. With `browserUrl`, devloop attaches to the existing browser and does not launch or close it. Only expose a browser profile you intend the agent to control.

To attach to an existing Chrome, start it with remote debugging and a dedicated user-data directory (Chrome 136+ does not allow remote debugging against the default profile). For example, on Linux:

```sh
mkdir -p "$HOME/.cache/pi-devloop/chrome-profile"
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/pi-devloop/chrome-profile"
```

Then set `/devloop:set browserUrl http://127.0.0.1:9222` and run `/devloop:browser` (or `/devloop:start`). Manual browser MCP registration uses `npx -y chrome-devtools-mcp@latest` and may download that package on first use. Browser tools can navigate pages and execute scripts.

The unpacked Manifest V3 extension in `extension/` is loaded into devloop-managed Chrome. Activate element selection with **Alt+Shift+E** or the extension popup, select up to five elements, add instructions, and send their context to Pi. A configured external browser is not modified and is not assumed to have the feedback extension installed.

The feedback receiver binds only to `127.0.0.1`. For managed Chrome, its per-run token and endpoint are supplied only to a private temporary extension copy, not to page JavaScript. The receiver validates requests from that extension and the configured dev-server origin.

## Development and tests

```sh
npm test
```

The live smoke test exercises the start flow with Herdr and managed Chrome:

```sh
npm run test:e2e
```

It requires a Herdr-managed pane (`HERDR_ENV=1`); managed Chrome may require the first-use download and `unzip` on Linux/macOS. The test verifies the browser target and served page, but does not launch the Chrome DevTools MCP process or verify live MCP tool exposure.
