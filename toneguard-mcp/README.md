# ToneGuard MCP Server

Multi-agent tone analysis for Claude Code. Two critics (Claude Haiku + GPT-4o-mini) analyze messages in parallel, then a synthesizer (Claude Sonnet) merges their findings.

## Prerequisites

- Python 3.11+
- `ANTHROPIC_API_KEY` environment variable
- `OPENAI_API_KEY` environment variable

## Install

```bash
cd toneguard-mcp
pip install -e ".[dev]"
```

## MCP Client Configuration

### Claude Code

Add to `~/.claude/settings.json` (or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "toneguard": {
      "command": "python3.11",
      "args": ["/path/to/toneguard/toneguard-mcp/server.py"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key",
        "OPENAI_API_KEY": "your-key"
      }
    }
  }
}
```

### Cursor

Add to Cursor MCP settings (same format, different config location).

## Tools

### `analyze_message`

Check a message for tone issues and get a rewrite suggestion.

```
message: "As per my last email, I just wanted to check in about the deadline"
context: "Slack message to coworker"
recipient: "alice"
```

Returns: flagged issues, rewrite suggestion, word-level diff, confidence score, and agent status.

### `log_decision`

Record what you did with a suggestion (helps ToneGuard learn your preferences).

```
action: "used_suggestion" | "sent_original" | "used_edited"
original: "the original message"
suggestion: "the suggestion offered"
final_text: "what was actually sent"
```

### `get_history`

View recent decisions and stats.

```
limit: 10
action_filter: "used_suggestion"
```

### `sync_status`

Check sync backend health (connected, last sync time).

## Cost

~$0.02 per analysis (2 critic calls + 1 synthesizer call).

## Tests

```bash
cd toneguard-mcp
python3.11 -m pytest tests/ -v
```

## Architecture

```
server.py       -> FastMCP server (4 tools)
analyzer.py     -> 2 critics in parallel -> synthesizer
learning_store.py -> JSON file at ~/.toneguard/learning.json
merge.py        -> Conflict resolution (parity with JS Chrome extension)
sync.py         -> Railway sync server client (poll-based)
critics/        -> Markdown prompt files for each critic
```

Learning data syncs across Chrome extension, Android app, and MCP server via the Railway-hosted sync service (`sync-server/`).
