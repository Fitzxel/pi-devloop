# pi-devloop

A Pi extension starter for dev-server feedback and browser element selection through Herdr.

## Status

This package includes Herdr `dev_start`, `dev_status`, `dev_logs`, and `dev_stop` tools; a loopback feedback receiver; an unpacked Manifest V3 feedback extension for devloop-managed Chrome; and on-demand Chrome DevTools MCP integration. Its Pi status bar reports the observed dev-server lifecycle as `running` or `stopped` and the Chrome DevTools MCP registration as `connected` or `disconnected`. The server indicator does not claim that startup configuration is valid or that the server is ready to start; the MCP indicator reflects registration, not Chrome process health.

## Requirements

- **Pi** with this package loaded as an extension.
- **Herdr** installed and available on `PATH`; run Pi inside a Herdr-managed pane (`HERDR_ENV=1`) to start, inspect, or stop dev servers.
- **Node.js 20 or newer** for the package runtime.

For managed browser launch, devloop automatically uses a compatible Chrome for Testing Stable build. On first use it needs network access to Google's official release metadata and download hosts; Linux and macOS also need `unzip`, while Windows uses PowerShell. Set `PI_DEVLOOP_CHROME_PATH` to a compatible Chrome/Chromium executable to bypass Chrome for Testing resolution and download. Alternatively, configure `browserUrl` to attach to an existing debuggable Chrome endpoint instead of launching a managed browser.

The Chrome DevTools MCP package is fetched with `npx -y chrome-devtools-mcp@latest` when the MCP is registered; first use therefore needs `npx` and, unless the package is already cached, network access to npm. These browser and MCP requirements are conditional: starting and controlling the dev server requires Pi and Herdr, while browser integration requires a browser and the corresponding launch or attach setup.

## Install / load

The extension entry point is `src/index.ts`; its package manifest declares it under `pi.extensions`. In a Pi project, load this package from a trusted source or test locally with `pi -e ./src/index.ts`.

The extension relies on the host-provided `@earendil-works/pi-coding-agent` and `typebox` imports. It has no external runtime dependencies.

## Included example

From the repository root, `npm start` serves `example/index.html` on an ephemeral loopback port and prints an HTTP ready URL. `dev_start` can use this package script as its default command, making the repository a self-contained smoke-test project.

## Live `/devloop:start` smoke test

From a Herdr-managed pane (`HERDR_ENV=1`), run:

```sh
npm run test:e2e
```

The opt-in runner copies the package and example into a temporary project, registers and invokes the same `/devloop:start` command handler used by the extension, creates a Herdr tab that runs `npm start`, waits for its ready URL, opens a managed Chrome window, and verifies the Chrome target and served page before cleaning up the tab, browser, and temporary project. It requires Herdr. Without a compatible `PI_DEVLOOP_CHROME_PATH`, the first managed launch downloads Chrome for Testing Stable, so network access is required; the Linux/macOS archive extractor (`unzip`) must also be available. It does not require an LLM or npm package download. The runner uses a test Pi host stub to assert the native MCP registration name/config and does **not** launch the Chrome DevTools MCP process, so it does not verify live MCP tool exposure.

Installing or reloading the extension alone does not start a project or open Chrome. When invoked, both the agent `dev_start` tool and `/devloop:start` start the configured command and open its ready URL in Chrome. `/devloop:browser` remains the separate on-demand MCP registration path.

## Herdr dev server

Run Pi inside a Herdr-managed pane (`HERDR_ENV=1`). The extension exposes both agent tools (`dev_start`, `dev_status`, `dev_logs`, `dev_stop`) and Pi commands. When the agent invokes `dev_start` or the user runs `/devloop:start`, the command starts the configured server in Herdr, waits for its ready URL, opens that URL in Chrome, and attaches Chrome DevTools MCP to the same browser. The agent tool result exposes the `pi-devloop-chrome` browser tools; the slash command reports the resulting state through Pi UI. Missing URLs skip browser registration, and browser errors preserve the running server state with a retry path.

Commands:

- `/devloop:start`, `/devloop:stop`, `/devloop:status`, `/devloop:logs [line-count]`
- `/devloop:config` shows effective and explicitly configured project settings.
- `/devloop:set command <shell command>` sets the command; `/devloop:set url <http(s) URL>` sets a fixed URL override; `/devloop:set timeout <milliseconds>` sets the ready-output timeout.
- `/devloop:set layout tab|split` chooses a new tab or a sibling split pane. The default is `tab`.
- `/devloop:set tabName <name>` sets the label for the new tab; the default is `devloop`.
- `/devloop:set browserUrl <http(s) URL>` optionally selects an existing debuggable Chrome instance instead of the MCP-managed isolated profile.
- Omit the value to clear an override, for example `/devloop:set url`. Clearing `layout` restores the `tab` default; clearing `tabName` restores `devloop`; clearing `browserUrl` restores the MCP-managed isolated profile.

These settings are stored in the current project's `.pi/devloop.json`; no manual file creation is needed. An unset command is detected from `scripts.dev` / `scripts.start` in `package.json`, an unset dev-server URL is parsed from ready output, and timeout defaults to 30000 ms. A configured dev-server URL overrides the URL parsed from startup output; with `browserUrl` unset, Chrome DevTools MCP launches its isolated browser when explicitly requested. Legacy `readyPattern` and `readyTimeoutMs` config values remain supported.

The configured command is submitted to Herdr's shell. Only set it in a project you trust. Devloop keeps its active lifecycle state in memory and does not write `.pi/devloop/state.json` into the project. A repeated start while the foreground process recorded by Herdr `pane process-info` remains present is a no-op; once it disappears, the next start creates fresh feedback credentials and reopens only a devloop-owned Chrome. `dev_stop` closes the tab created for a tab layout, or just the pane for a split layout.

## Chrome DevTools MCP

Pi does not start Chrome when the extension loads. When the agent invokes `dev_start` and the dev server reports a ready URL, the extension **opens that URL in a Chrome window immediately**, then registers the native `pi-devloop-chrome` MCP against that same browser. With no `browserUrl` configured, devloop launches Chrome with `--enable-automation`, a unique temporary user-data directory, and an ephemeral remote-debugging port; the tool result includes the URL and browser mode. If the browser launch or MCP attachment fails, `dev_start` still reports the running server and the browser error. The `/devloop:start` command follows the same ready-URL browser-opening flow; installing or reloading the extension alone does not launch a project or browser.

Without `PI_DEVLOOP_CHROME_PATH`, a managed launch resolves the current Chrome for Testing Stable release from Google's official metadata and downloads it into the user cache (`~/.cache/pi-devloop/chrome-for-testing`, or `%LOCALAPPDATA%\\pi-devloop\\chrome-for-testing` on Windows). Installed versions are reused; new Stable releases are cached alongside older versions. Linux and macOS require the `unzip` utility; Windows uses PowerShell. The official metadata does not publish archive checksums, so devloop requires the expected HTTPS metadata/download hosts and version/platform URL, limits archive size, and rejects unsafe archive paths. Set `PI_DEVLOOP_CHROME_PATH` to a compatible Chromium or Chrome for Testing executable to use a different browser; the generic `CHROME_PATH` variable is not read. Branded Google Chrome Stable 137+ ignores `--load-extension` and therefore cannot load this unpacked extension.

If `browserUrl` is configured, devloop does not launch or close an existing browser: it opens the ready URL in a new tab through Chrome's DevTools endpoint and attaches the MCP to that browser. Only configure an endpoint for a browser profile you intend to expose to the agent.

Manual activation remains available. Run `/devloop:browser` or call `browser_connect` to register Chrome DevTools MCP without starting the dev server. In this manual path, an unset `browserUrl` uses the MCP's `--isolated` mode and Chrome launches on the first browser-tool call; `npx -y chrome-devtools-mcp@latest` may download the MCP package on first use. Use tools such as `new_page`, `navigate_page`, `take_snapshot`, and `take_screenshot` for subsequent browser work.

To attach manually to an existing Chrome, start it with remote debugging and a dedicated user-data directory (Chrome 136+ does not allow remote debugging against its default profile). Example on Linux:

```sh
mkdir -p "$HOME/.cache/pi-devloop/chrome-profile"
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/pi-devloop/chrome-profile"
```

Set `/devloop:set browserUrl http://127.0.0.1:9222` (or the endpoint you started Chrome with), then run `/devloop:browser`. `/devloop:browser-status` and `browser_status` report registration and mode; `/mcp` shows live connection details. `/devloop:browser-stop` or `browser_disconnect` closes only a Chrome process launched by devloop and cleans its temporary profile; a configured existing browser is left open. `/devloop:stop` stops the dev server but leaves the Chrome window open. Browser tools can navigate pages and execute page scripts, so only expose a profile to the agent when you intend it.

## Browser feedback receiver

A real dev-server start creates a fresh per-run HTTP receiver and bearer token, binds only to `127.0.0.1`, and passes its endpoint, token, and exact dev-server origin only into a private temporary copy of the extension for managed Chrome. A repeated start while running does not rotate credentials. Run `/devloop` in Pi to start a standalone per-session receiver and show its port and bearer token. It binds only to `127.0.0.1`. The endpoint accepts `POST /selection` with validated JSON only from the pinned devloop extension origin and requires its current bearer token; the service worker only submits for the exact configured dev-server origin. The token is intended for the private extension copy and is not exposed to page JavaScript. The receiver validates payload lengths before sending a user message to the active Pi session.

The feedback overlay is the unpacked Manifest V3 extension in `extension/`. Devloop-managed Chrome loads a private temporary copy at launch with host permissions limited to the exact target and loopback receiver origins (including ports); it does not declare automatic content scripts. The extension toolbar action explicitly activates selection, highlights hovered elements, and submits the bounded selection payload from its service worker. The bearer token is not placed in page JavaScript. The content script is injected only into the tab selected through the extension action. Configured external browsers are not modified or assumed to have the extension installed. The old `overlay/devloop.js` entry is deprecated and inert.

## Development

```sh
npm test
```
