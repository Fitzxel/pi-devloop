# pi-devloop

A Pi extension starter for dev-server feedback and browser element selection through Herdr.

## Status

This is an early scaffold. The first slice includes Herdr `dev_start`, `dev_status`, `dev_logs`, and `dev_stop` tools, a loopback feedback receiver, and a browser overlay script. Chrome launch/CDP/MCP integration, screenshots, source-location mapping, and automatic overlay injection are not implemented yet.

## Install / load

The extension entry point is `src/index.ts`; its package manifest declares it under `pi.extensions`. In a Pi project, load this package from a trusted source or test locally with `pi -e ./src/index.ts`.

The extension relies on the host-provided `@earendil-works/pi-coding-agent` and `typebox` imports. It has no external runtime dependencies.

## Herdr dev server

Run Pi inside a Herdr-managed pane (`HERDR_ENV=1`). `dev_start` reads `.pi/devloop.json`, or detects `scripts.dev` / `scripts.start` from `package.json`, creates a sibling pane without focusing it, starts the command, and waits for ready output. Configuration example:

```json
{
  "command": "pnpm dev",
  "readyPattern": "http://localhost:[0-9]+",
  "readyTimeoutMs": 30000
}
```

The configured command is submitted to Herdr's shell. Only set it in a project you trust. State is stored at `.pi/devloop/state.json`; add that runtime file to `.gitignore` if you do not want it tracked. `dev_stop` closes the pane recorded by this extension.

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
