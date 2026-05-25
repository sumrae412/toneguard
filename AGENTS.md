# ToneGuard

Chrome extension + MCP server for tone analysis. Analyzes messages for professionalism, clarity, and emotional tone before sending.

## Structure

- Root: Chrome extension (manifest v3, content scripts, popup, overlay)
- `toneguard-mcp/`: Python MCP server (FastMCP, multi-model analysis)
- `android/`: Native Kotlin Android app with accessibility service
- `sync-server/pwa/`: Progressive Web App for mobile share sheet (served from the Railway sync-server)
- `sync-server/`: Railway-hosted Node/Express + Postgres + WebSocket sync backend

## Dev Setup

- MCP server requires `uv` (system Python 3.9.6 is too old for fastmcp)
- `cd toneguard-mcp && source $HOME/.local/bin/env && uv sync` to install deps
- API keys in `toneguard-mcp/.env` (gitignored): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Run tests: `uv run --extra dev pytest tests/ -v`
- Run live integration tests: `set -a && source .env && set +a && uv run --extra dev pytest tests/test_live_integration.py -v -s`
- CI runs vitest (Node) + pytest (MCP) on every PR via `.github/workflows/ci.yml`. The MCP job uses `astral-sh/setup-uv@v3` — don't replicate the local `source $HOME/.local/bin/env` pattern in workflows; that path is OS-specific and doesn't exist on `ubuntu-latest` runners.

## Key Gotchas

- Sonnet model ID: `claude-sonnet-4-20250514` (not `-4-5-`)
- Haiku model ID: `claude-haiku-4-5-20251001`
- Build backend: `hatchling`, not legacy setuptools
- The `.env` file must be sourced into the shell for live integration tests (not just present on disk)
- **Dual code paths: MCP + extension.** Prompts/behaviors live twice — `toneguard-mcp/critics/*.md` (MCP analyzer) AND inline constants in `service-worker.js` (extension calls Anthropic directly, not through MCP). Known pairs: landing critic (`critics/landing.md` ↔ `LANDING_SYSTEM_PROMPT`), fingerprint (`analyzer.py:generate_fingerprint` ↔ `regenerateVoiceFingerprint`). Any change to one must update the other.
- **Sync backend lives in 4 clients.** The same sync protocol is implemented in `src/sync/sync-client.js` (Chrome ext + PWA), `toneguard-mcp/sync.py` (MCP server, poll-only), and `android/.../SyncManager.kt` (Android). If you change the server API in `sync-server/src/index.js`, update all three. The server URL is hardcoded in each client — bump together when the Railway hostname changes.
- **Canonical taxonomies live in `shared/analysis/*.json`; clients consume but don't redefine.** `voice-strengths.json` is the source of truth for the voice-strength enum in `service-worker.js`, `sync-server/pwa/app.js`, `analyzer.py`, and `MainActivity.kt`. Drift is detected by `node scripts/parity_scan.mjs` against `scripts/parity_manifest.json`; CI regenerates `docs/client-parity.md` on every PR and fails on drift via `--check`. If you add a new client-replicated constant, promote to `shared/analysis/` and add a probe to the manifest — don't add a 5th copy.
- **`docs/client-parity.md` is a generated build artifact — do not hand-edit.** Header carries `<!-- Generated from ... Do not edit directly. -->`. Regen via `node scripts/parity_scan.mjs`. Same convention as the outputs of `scripts/generate_shared_artifacts.mjs`.
- **PWA cannot import `lib.js` (no bundler).** When the extension and PWA need the same helper (e.g. `buildTelemetryClipboardPayload`), inline a copy in `sync-server/pwa/app.js` with a sync-pointer comment back to `lib.js`. This is the third axis of the "Dual code paths" gotcha above — same helper, three places (lib.js for ext + service worker, inline in sync-server/pwa/app.js, separate in MCP if applicable). Update all sides together.
- **PWA install criteria (Android + iOS).** Android Chrome's `beforeinstallprompt` requires BOTH 192×192 AND 512×512 PNG icons declared in `sync-server/pwa/manifest.json` — missing either silently disables the auto-prompt, forcing a 3-tap Add-to-Home-Screen menu install. iOS Safari has NO auto-prompt at all (always 4-tap manual Share → Add to Home Screen — Apple's choice, unfixable in code). Verify icon dimensions with `sips -g pixelWidth -g pixelHeight sync-server/pwa/icons/icon192.png`. SW `cache.addAll()` paths must NOT use `../icons/` — that escapes the PWA's served scope and 404s silently; keep all PWA assets under `pwa/`. See [`gotcha_pwa_install_requirements.md`](../../.claude/projects/-Users-summerrae-claude-code-toneguard/memory/gotcha_pwa_install_requirements.md).
- **Railway sync-server hosts BOTH the sync backbone AND the PWA** at `https://sync-server-production-3a24.up.railway.app`. The PWA lives at `sync-server/pwa/` (moved here from repo root on 2026-05-25 after Railway Root Directory `/sync-server` excluded the sibling `pwa/` from the build context). `sync-server/src/index.js` mounts `app.use(express.static(path.resolve(__dirname, "../pwa")))` to serve it. **Before any plan that depends on "the PWA is live" or "X service is up," still run a probe** — content-serving regressions are real:
  ```bash
  for p in / /manifest.json /sw.js /icons/icon192.png /healthz; do
    curl -sS -o /dev/null -w "%{http_code} %{content_type}  $p\n" "https://sync-server-production-3a24.up.railway.app$p"
  done
  ```
  All should return 200. Root Directory is `/sync-server` (set in Railway dashboard); changing the PWA's filesystem location requires updating `PWA_DIR` in `sync-server/src/index.js`.
- **`sync-server` is Express 4, not Express 5** (per `sync-server/package.json` — `"express": "^4.21.0"`). Doesn't affect most fixes but matters for middleware compatibility.
- **Express ESM in `sync-server` (`"type": "module"`) — no `__dirname`.** When adding static-file serving or path math, use `import { fileURLToPath } from "node:url"; const __dirname = path.dirname(fileURLToPath(import.meta.url));`.
- **Vitest scans into `.claude/worktrees/` by default — `vitest.config.js` excludes it.** Without the exclude, main-checkout `vitest run` reports inflated test counts (sibling worktree tests get counted). Honest single-checkout baseline is ~155 in 8 files; main-checkout with active worktrees can read 400+ if the worktrees have their own tests. The exclude was added 2026-05-24 to make test runs deterministic. Don't remove it.

## Repo Conventions

- **Doc-only commits land direct to main, no PR.** Handoff docs, archive annotations, plan files, README updates that touch zero code/tests/schemas ship as a single commit pushed straight to `main`. Established pattern: commits `ffe3bfd`, `a24f128`, `ec12592`, `475514e`, `18407f8`, `76abf6c`. Overrides the global `/next` skill's "ship via `/ship`" instruction for this repo when the diff is documentation-only. Code, schema, or test changes still go through `/ship` → PR → review. Confirm with the user before pushing if unsure whether a change qualifies as doc-only.

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
- **`AGENTS.md` is a verbatim mirror of `CLAUDE.md`** (resolved in commit `100a231`, 2026-05-24). Both files must stay byte-identical so Codex CLI, generic agent runners, and Claude all see the same gotchas — and CodeRabbit stops flagging `AGENTS.md` drift as PR noise (the pre-fix file had Codex/Claude string drift from a bad search-replace and surfaced on every unrelated PR via CR's `--base main` working-tree scan). Any edit to `CLAUDE.md` needs a paired `cp CLAUDE.md AGENTS.md && git add CLAUDE.md AGENTS.md` in the same commit. If divergence is ever intentional (agent-tool-specific content), document why at the top of `AGENTS.md`.

## Multi-Model Architecture

- Claude Haiku: tone critic (passive-aggression, guilt-trips, defensive framing)
- GPT-4o-mini: clarity critic (wordiness, weak openings, hedging, filler phrases)
- Claude Sonnet: synthesizer (merges both critics, produces final rewrite + word-level diff)
- Cost: ~$0.02 per analysis
