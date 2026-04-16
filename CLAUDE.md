# ToneGuard

Chrome extension + MCP server for tone analysis. Analyzes messages for professionalism, clarity, and emotional tone before sending.

## Structure

- Root: Chrome extension (manifest v3, content scripts, popup, overlay)
- `toneguard-mcp/`: Python MCP server (FastMCP, multi-model analysis)
- `android/`: Native Kotlin Android app with accessibility service
- `pwa/`: Progressive Web App for mobile share sheet
- `supabase/`: Backend infrastructure (migrations, Edge Functions)

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

## Chrome Extension Dev Loop

- **Extension reload doesn't always pick up service-worker changes.** Bump `manifest.json` version on every ship (or every meaningful reload) so you can confirm the new build is live in `chrome://extensions`.
- **`chrome.contextMenus.create` throws `"Cannot create item with duplicate id <id>"` on reload** if the entry already exists. Always wrap in `chrome.contextMenus.removeAll(() => chrome.contextMenus.create(...))`. Only surfaces on reload, not fresh install.
- **Service-worker state is not persistent.** Chrome can terminate and re-spawn the SW at any time; top-level code (including context-menu creation) re-runs. All setup must be idempotent.
- **Claude responses are pretty-printed JSON.** Haiku 4.5 (`claude-haiku-4-5-20251001`) emits multi-line JSON. Never sanitize with a global control-char regex — it corrupts structural whitespace between `{` and the first key. Use `lib.js:parseApiResponse` (fast-path `JSON.parse`, state-machine sanitizer fallback, surfaces errors instead of silent catch).
- **Never swallow parse errors into a destructive default.** If the Claude response won't parse, return `{flagged: false, error: "..."}` — never silently release the send as if the check passed. The user must see the failure.
- **For bugs the user hits and you can't,** add labeled `console.log` breadcrumbs on the critical path with a grep prefix (`[ToneGuard:diag]`) and ship as a diagnostic build. Don't theorize without runtime evidence — see `bug-fix` skill's "user can reproduce, agent cannot" sub-path.

## Multi-Model Architecture

- Claude Haiku: tone critic (passive-aggression, guilt-trips, defensive framing)
- GPT-4o-mini: clarity critic (wordiness, weak openings, hedging, filler phrases)
- Claude Sonnet: synthesizer (merges both critics, produces final rewrite + word-level diff)
- Cost: ~$0.02 per analysis
