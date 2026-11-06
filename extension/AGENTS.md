# Extension Directory

## OVERVIEW

Unpacked Chrome Manifest V3 extension used by devloop-managed Chrome to pin up to five page elements at once and send bounded individual or batch feedback to Pi through the loopback receiver. Target IDs remain stable and may exceed five after removals.

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
- Preserve bounded payload validation in both the extension and the receiver (`src/server.js`): keep the 16 KiB total request cap, at most five targets per envelope, unique positive safe-integer IDs, and existing selector/role/text/outerHTML/instruction bounds. IDs are monotonically allocated and not reused during one activation session, so they may exceed five after removals. Accept legacy single-element payloads as well as the version-2 envelope. Individual sends contain exactly one target and its instruction; batch sends contain numbered targets, any per-target instructions, and an optional global instruction. Update HTTP contract tests and README when this contract changes.
- Pinned target IDs stay stable across hover and removal. Pointer hover may show a transient preview but must never replace a pinned target; removing the active target removes only it, and the five-current-target limit remains enforced.
- The shortcut and popup activate selection only; automatic injection may show a one-time-per-tab shortcut toast but must not inspect or alter page content before activation.

## ANTI-PATTERNS

- Do not place the bearer token in page JavaScript or expose it to the selected page.
- Do not add broad or persistent host permissions, automatic content-script matches outside the exact configured origin, or mutate an externally configured browser profile.
- Do not assume configured external browsers have this extension installed; the private copy is for devloop-managed Chrome.
