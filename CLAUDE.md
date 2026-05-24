# ToneGuard

Chrome extension + MCP server for tone analysis. Analyzes messages for professionalism, clarity, and emotional tone before sending.

## Structure

- Root: Chrome extension (manifest v3, content scripts, popup, overlay)
- `toneguard-mcp/`: Python MCP server (FastMCP, multi-model analysis)
- `android/`: Native Kotlin Android app with accessibility service
- `pwa/`: Progressive Web App for mobile share sheet
- `sync-server/`: Railway-hosted Node/Express + Postgres + WebSocket sync backend

## Dev Setup

- MCP server requires `uv` (system Python 3.9.6 is too old for fastmcp)
- `cd toneguard-mcp && source $HOME/.local/bin/env && uv sync` to install deps
- API keys in `toneguard-mcp/.env` (gitignored): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Run tests: `uv run --extra dev pytest tests/ -v`
- Run live integration tests: `set -a && source .env && set +a && uv run --extra dev pytest tests/test_live_integration.py -v -s`

## Key Gotchas

- Sonnet model ID: `claude-sonnet-4-20250514` (not `-4-5-`)
- Haiku model ID: `claude-haiku-4-5-20251001`
- Build backend: `hatchling`, not legacy setuptools
- The `.env` file must be sourced into the shell for live integration tests (not just present on disk)
- **Dual code paths: MCP + extension.** Prompts/behaviors live twice — `toneguard-mcp/critics/*.md` (MCP analyzer) AND inline constants in `service-worker.js` (extension calls Anthropic directly, not through MCP). Known pairs: landing critic (`critics/landing.md` ↔ `LANDING_SYSTEM_PROMPT`), fingerprint (`analyzer.py:generate_fingerprint` ↔ `regenerateVoiceFingerprint`). Any change to one must update the other.
- **Sync backend lives in 4 clients.** The same sync protocol is implemented in `src/sync/sync-client.js` (Chrome ext + PWA), `toneguard-mcp/sync.py` (MCP server, poll-only), and `android/.../SyncManager.kt` (Android). If you change the server API in `sync-server/src/index.js`, update all three. The server URL is hardcoded in each client — bump together when the Railway hostname changes.

## Chrome Extension Dev Loop

- **Extension reload doesn't always pick up service-worker changes.** Bump `manifest.json` version on every ship (or every meaningful reload) so you can confirm the new build is live in `chrome://extensions`.
- **`chrome.contextMenus.create` duplicate-id is a three-part bug, not one.** The `removeAll()` wrapper is necessary but NOT sufficient. MV3 fires `onInstalled` and `onStartup` close enough together that two `removeAll`/`create` pairs can interleave and re-trigger the duplicate-id error. Required fixes together:
  1. `chrome.contextMenus.removeAll(() => chrome.contextMenus.create(...))` wrapper for idempotence.
  2. **In-flight guard** (module-level boolean) so concurrent lifecycle handlers can't both enter the setup function.
  3. **Pass a callback to `chrome.contextMenus.create`** and explicitly read `chrome.runtime.lastError`, otherwise the duplicate-id surfaces in `chrome://extensions` as an unchecked runtime.lastError even when it's benign.
- **Only one clone of this repo should be loaded as an unpacked extension.** Two clones (e.g. `~/toneguard` and `~/repos/toneguard`) cause silent version skew — Chrome keeps loading whichever path was registered first, even after you bump the manifest in the other clone. If a version bump doesn't appear in `chrome://extensions` after reload, check the "Loaded from" path before debugging the build. Prefer a single canonical clone; delete the stale one.
- **Log structured errors as strings, not objects, in extension code.** `console.warn("ToneGuard:", errObj)` renders fine in DevTools but as `[object Object]` in the `chrome://extensions` error pane — the two surfaces stringify the second arg differently. Format structured errors (`{type, message, diagnostic_code}`) into a readable string like `"type [code]: message"` before logging. See `formatErrorForLog()` in `content.js` (handles null, string, object, primitive, and circular-ref cases).
- **Service-worker state is not persistent.** Chrome can terminate and re-spawn the SW at any time; top-level code (including context-menu creation) re-runs. All setup must be idempotent.
- **Claude responses are pretty-printed JSON.** Haiku 4.5 (`claude-haiku-4-5-20251001`) emits multi-line JSON. Never sanitize with a global control-char regex — it corrupts structural whitespace between `{` and the first key. Use `lib.js:parseApiResponse` (fast-path `JSON.parse`, state-machine sanitizer fallback, surfaces errors instead of silent catch).
- **Never swallow parse errors into a destructive default.** If the Claude response won't parse, return `{flagged: false, error: "..."}` — never silently release the send as if the check passed. The user must see the failure.
- **For bugs the user hits and you can't,** add labeled `console.log` breadcrumbs on the critical path with a grep prefix (`[ToneGuard:diag]`) and ship as a diagnostic build. Don't theorize without runtime evidence — see `bug-fix` skill's "user can reproduce, agent cannot" sub-path.
- **`verifyInsertedText` compares via a symmetric `stripMentions`, but the editor side may be Slack-expanded (`@sam` → `@Sam Rivera`).** Any extension to the mention regex must consume trailing capitalized words on both sides — otherwise the after-side keeps a dangling surname, the substring compare silently fails, and a successful insert gets nacked. See `lib.js:451` and the regression test at `tests/lib.test.js:429`.

## Multi-Model Architecture

- Claude Haiku: tone critic (passive-aggression, guilt-trips, defensive framing)
- GPT-4o-mini: clarity critic (wordiness, weak openings, hedging, filler phrases)
- Claude Sonnet: synthesizer (merges both critics, produces final rewrite + word-level diff)
- Cost: ~$0.02 per analysis
