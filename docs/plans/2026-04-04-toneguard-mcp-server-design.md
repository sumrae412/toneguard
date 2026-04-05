# ToneGuard MCP Server — Design

**Date:** 2026-04-04
**Status:** Approved
**Branch:** TBD (will be created during implementation)

## Problem

ToneGuard's tone analysis skill only works in Claude Code and is stateless — it doesn't learn from past decisions. The Chrome extension and Android app have learning + sync, but there's no way to use ToneGuard from Cursor, Codex, or other MCP clients, and no way for those clients to contribute to the shared learning pool.

## Solution

A local MCP server (Python/FastMCP) that exposes ToneGuard analysis as tools. Uses the existing debate-team infrastructure for multi-model review (Claude Haiku + GPT-4o-mini as parallel critics, Claude Sonnet as synthesizer). Stores learning data locally and syncs to Supabase alongside the Chrome extension and Android app.

## Architecture

```
┌─────────────────────────────────────────────┐
│  MCP Clients (Claude Code / Cursor / Codex)  │
└──────────────────┬──────────────────────────┘
                   │ stdio
         ┌─────────┴──────────┐
         │  ToneGuard MCP     │
         │  (FastMCP/Python)  │
         ├────────────────────┤
         │ • style-rules.md   │ ← read at startup
         │ • learning store   │ ← local JSON file
         │ • API key from     │
         │   encrypted prefs  │
         └────────┬───────────┘
                  │ analyze_message
                  ▼
    ┌─────────────────────────────┐
    │  plancraft_review.py        │
    │  (extended with tone modes) │
    ├──────────┬──────────────────┤
    │          │  parallel        │
    │  ┌───────┴──────┐          │
    │  ▼              ▼          │
    │ --mode         --mode      │
    │ tone-claude    tone-gpt    │
    │ (Haiku)        (GPT-4o-m)  │
    └──────────┬──────────────────┘
               │ critic outputs
               ▼
    ┌─────────────────────────────┐
    │  Synthesizer (Sonnet)       │
    │  • Adopt/reject per finding │
    │  • Best rewrite wins        │
    │  • Single merged output     │
    └─────────────────────────────┘
```

## Multi-Agent Flow

1. User calls `analyze_message` with a message string
2. MCP server writes message + style rules + learning context to temp file
3. Server calls `plancraft_review.py` with `--mode tone-claude` and `--mode tone-gpt` in parallel
4. Each critic returns structured JSON: `{flagged, issues[], suggestion, confidence}`
5. Synthesizer (Claude Sonnet) merges critic outputs using debate-team protocol:
   - **ADOPT**: finding is valid, actionable — include in final result
   - **REJECT**: false positive, already addressed, or contradicted by other critic
   - **DEFER**: valid but subjective — include with lower confidence
6. Synthesizer writes the final rewrite combining the best catches from both critics
7. Structured result returned to MCP client

## Tools

### `analyze_message`

Core analysis tool. Triggers the debate-team flow.

```
Input:
  message: string (required) — the message to check
  context: string (optional) — "slack", "email", "text", etc.
  recipient: string (optional) — "@name" for relationship context

Output:
  flagged: boolean
  issues: [{rule: string, quote: string, explanation: string}]
  rewrite: string
  diff: [{type: "added"|"removed"|"same", text: string}]
  confidence: float (0-1)
  agents: {claude: summary, gpt: summary}
```

### `log_decision`

Record what the user did with the suggestion. Triggers debounced sync push.

```
Input:
  action: "used_suggestion" | "sent_original" | "used_edited"
  original: string
  suggestion: string (optional)
  final_text: string (optional, for "used_edited")

Output:
  logged: boolean
  decisions_count: int
```

### `get_history`

View recent decisions and stats.

```
Input:
  limit: int (default 10)
  action_filter: string (optional)

Output:
  decisions: [{action, original, suggestion, timestamp}]
  stats: {checked, flagged, accepted, dismissed, edited}
```

### `sync_status`

Check Supabase sync health.

```
Input: (none)

Output:
  connected: boolean
  last_sync: string (ISO timestamp)
```

## Integration with Debate-Team

### New critic files

- `debate-team/critics/claude-tone.md` — Claude Haiku critic prompt
  - Focuses on: tone detection, passive-aggression, guilt-trips, defensive framing
  - Gets: style-rules.md + learned examples + voice samples + relationship context

- `debate-team/critics/gpt-tone.md` — GPT-4o-mini critic prompt
  - Focuses on: clarity, Hemingway checks, sentence structure, grammar
  - Gets: same context as Claude critic

### plancraft_review.py extensions

Add two new modes to the existing script:

- `--mode tone-claude`: Calls Anthropic API (Haiku) with claude-tone critic prompt
- `--mode tone-gpt`: Calls OpenAI API (GPT-4o-mini) with gpt-tone critic prompt
- `--input-type tone`: New input type that reads a message (not a plan/diff)
- Output format: same JSON structure as existing critics

### Synthesizer prompt

The synthesizer (Claude Sonnet, called directly from the MCP server) gets:
- Both critic outputs
- The original message
- Style rules (for tie-breaking)
- Learning context (for calibration)

It produces the final structured output with the adopt/reject changelog.

## Learning Store

### Storage format

Local JSON file at `~/.toneguard/learning.json`:

```json
{
  "tg_decisions": [...],
  "tg_voice_samples": [...],
  "tg_relationships": {...},
  "tg_custom_rules": "",
  "tg_stats": {...},
  "tg_stats_history": [...]
}
```

Same keys and formats as Chrome extension and Android app.

### Sync

Reuses the same Supabase backend:
- **URL:** `https://jimjfaaaccqtcbbxsrys.supabase.co`
- **Auth:** POST to `/functions/v1/auth-by-hash` with SHA-256 hash of API key
- **Pull/push:** REST API with `Prefer: resolution=merge-duplicates`
- **Merge strategies:** Python port of `src/sync/merge.js` (same as Kotlin port)

Sync runs:
- Pull on server startup
- Push 5s after any learning write (debounced)
- Poll every 5 minutes

### API key source

Reads from the same encrypted SharedPreferences file used by the ToneGuard Chrome extension, or falls back to `ANTHROPIC_API_KEY` env var.

## Style Rules

Read-only. Server reads `style-rules.md` from the ToneGuard repo at startup. To change rules, edit the file directly. The server watches for file changes and reloads automatically.

## Dependencies

- `fastmcp` — MCP server framework
- `anthropic` — Claude API (Haiku for critic, Sonnet for synthesis)
- `openai` — GPT-4o-mini (second critic)
- `httpx` — Supabase REST calls (async)
- No new dependencies for plancraft_review.py (already uses anthropic + openai)

## Cost per analysis

| Component | Model | Est. tokens | Cost |
|-----------|-------|-------------|------|
| Claude critic | Haiku 4.5 | ~3K in, ~500 out | ~$0.005 |
| GPT critic | GPT-4o-mini | ~3K in, ~500 out | ~$0.002 |
| Synthesizer | Sonnet 4.6 | ~2K in, ~500 out | ~$0.014 |
| **Total** | | | **~$0.02** |

## Files to create

### New files
- `toneguard-mcp/server.py` — FastMCP server with 4 tools
- `toneguard-mcp/learning_store.py` — JSON file-backed learning storage
- `toneguard-mcp/merge.py` — Python port of merge strategies
- `toneguard-mcp/sync.py` — Supabase sync client
- `debate-team/critics/claude-tone.md` — Claude tone critic prompt
- `debate-team/critics/gpt-tone.md` — GPT style critic prompt

### Modified files
- `~/.claude/scripts/plancraft_review.py` — add `--mode tone-claude` and `--mode tone-gpt`

## Testing

- Unit test merge strategies (must match JS/Kotlin output)
- Test each critic independently with sample messages
- Integration test: analyze a message end-to-end, verify structured output
- Cross-platform test: log a decision via MCP, verify it appears in Chrome extension

## Out of scope

- Custom rules management via MCP tools (read-only for now)
- Real-time WebSocket subscription (poll-only for simplicity)
- Multiple concurrent analyses (serial for v1)
