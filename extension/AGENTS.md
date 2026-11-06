# Extension Directory

## OVERVIEW

Unpacked Chrome Manifest V3 extension used by devloop-managed Chrome to select a page element and send bounded feedback to Pi through the loopback receiver.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Permissions and extension identity | `manifest.json` | MV3; `activeTab` and `scripting`; no static host permissions |
| Toolbar activation and tab-scoped injection | `service-worker.js` | Uses `chrome.action` and `chrome.scripting`; submits to the configured receiver |
| Hover highlighting and selection payload | `content.js` | Bounded element context; communicates with the service worker |

## CONVENTIONS

- This source is copied to a private temporary directory for devloop-managed Chrome; runtime receiver URL, bearer token, and target origin are supplied through that managed setup.
- Keep permissions minimal. Host access is configured per managed copy for the exact dev-server and loopback receiver origins.
- Preserve bounded payload validation in both the extension and the receiver (`src/server.js`); update the receiver tests and README if the submitted data contract changes.

## ANTI-PATTERNS

- Do not place the bearer token in page JavaScript or expose it to the selected page.
- Do not add broad or persistent host permissions, automatic content-script matches, or mutate an externally configured browser profile.
- Do not assume configured external browsers have this extension installed; the private copy is for devloop-managed Chrome.
