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

## Multi-Model Architecture

- Claude Haiku: tone critic (passive-aggression, guilt-trips, defensive framing)
- GPT-4o-mini: clarity critic (wordiness, weak openings, hedging, filler phrases)
- Claude Sonnet: synthesizer (merges both critics, produces final rewrite + word-level diff)
- Cost: ~$0.02 per analysis
