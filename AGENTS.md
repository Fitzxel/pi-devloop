# PROJECT KNOWLEDGE BASE

**Generated:** 2025-11-05  
**Commit:** 3b80cb1  
**Branch:** main

## OVERVIEW

Pi extension for managing Herdr development servers and connecting Chrome DevTools for browser-driven development. Runtime is Node.js 20+ ES modules; the Pi entry point is `src/index.ts`.

## STRUCTURE

```text
src/        Pi extension, server orchestration, Chrome integration, and tests
extension/  Unpacked Manifest V3 feedback extension (see extension/AGENTS.md)
example/    Local demo server and opt-in live end-to-end smoke test
odd/        ODD task records
```

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Register Pi tools, commands, and lifecycle hooks | `src/index.ts` | Package entry point in `package.json` (`pi.extensions`) |
| Configure project dev-server settings | `src/project-config.js` | Reads/writes `.pi/devloop.json`; legacy ready config is supported |
| Start/stop/manage Herdr panes | `src/herdr.js` | `src/herdr.test.js`, `src/herdr-placement.test.js` |
| Feedback receiver and payload validation | `src/server.js` | Loopback HTTP receiver and selection validation; tests in `src/server.test.js` |
| Chrome launch and DevTools MCP | `src/chrome-launcher.js`, `src/chrome-devtools.js` | `src/chrome-for-testing.js` resolves/downloads managed Chrome |
| Start flow orchestration | `src/dev-start-automation.js` | `src/dev-start-automation.test.js` |
| Local demo and live smoke test | `example/` | `npm start`; `npm run test:e2e` requires Herdr |
| User-facing behavior and requirements | `README.md` | Keep docs aligned when commands, settings, or lifecycle behavior change |

## CONVENTIONS

- Use native Node.js ES modules (`"type": "module"`); tests use the built-in `node:test` runner.
- Keep runtime dependencies host-provided by Pi; `package.json` intentionally declares no external runtime dependencies.
- Treat browser setup as conditional: dev-server management requires Pi and Herdr; Chrome/MCP flows have additional browser, network, and platform prerequisites documented in `README.md`.
- The configured dev-server shell command is submitted to Herdr. Only run it in projects you trust.

## ANTI-PATTERNS (THIS PROJECT)

- Do not claim that extension loading starts a server or launches Chrome; those happen on explicit start/browser actions.
- Do not claim MCP registration proves Chrome process health, or that a server's running state proves its startup configuration is valid.
- Do not expose the feedback bearer token to page JavaScript or broaden the private feedback extension's host permissions beyond the exact target and loopback receiver origins.
- Do not replace the test runner with an external framework without updating project scripts and documentation.

## COMMANDS

```sh
npm test                 # Unit and integration tests (node --test)
npm start                # Serve the example on an ephemeral loopback port
npm run test:e2e         # Live Herdr/Chrome smoke test; requires HERDR_ENV=1 in Herdr
pi -e ./src/index.ts     # Load the extension locally in Pi
```
