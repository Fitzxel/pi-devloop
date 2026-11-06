# Extension Directory

## OVERVIEW

Unpacked Chrome Manifest V3 extension used by devloop-managed Chrome to select a page element and send bounded feedback to Pi through the loopback receiver.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Permissions and extension identity | `manifest.json` | MV3; `activeTab` only; no static host permissions |
| Keyboard and tab activation | `service-worker.js` | Handles the `Alt+Shift+E` command and popup messages for the configured tab |
| Automatic page injection and feedback overlay | `content.js` | Target-origin-only loading; bounded element context and receiver submission |
| Popup activation UI | `popup.html`, `popup.css`, `popup.js` | Extension action popup; communicates with the active tab |

## CONVENTIONS

- This source is copied to a private temporary directory for devloop-managed Chrome; runtime receiver URL, bearer token, and target origin are supplied through that managed setup.
- Keep permissions minimal. Host access and automatic content-script matching are configured per managed copy for the exact dev-server origin; the loopback receiver origin is granted separately.
- Preserve bounded payload validation in both the extension and the receiver (`src/server.js`); update the receiver tests and README if the submitted data contract changes.
- The shortcut and popup activate selection only; automatic injection may show a one-time-per-tab shortcut toast but must not inspect or alter page content before activation.

## ANTI-PATTERNS

- Do not place the bearer token in page JavaScript or expose it to the selected page.
- Do not add broad or persistent host permissions, automatic content-script matches outside the exact configured origin, or mutate an externally configured browser profile.
- Do not assume configured external browsers have this extension installed; the private copy is for devloop-managed Chrome.
