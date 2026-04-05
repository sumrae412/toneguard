# ToneGuard MCP Server + Chrome Extension — Implementation Plan

**Date:** 2026-04-04
**Design:** `docs/plans/2026-04-04-toneguard-mcp-server-design.md`
**Branches:** `feat/mcp-server` (Steps 1-6), `feat/context-menu` (Steps 7-8)
**Location:** MCP server in `toneguard-mcp/`, extension changes in repo root

## Decisions (from clarification)

1. **Repo:** Inside existing toneguard repo as `toneguard-mcp/` subdirectory
2. **Critic dispatch:** All 3 API calls (2 critics + synthesizer) handled directly by MCP server — no plancraft_review.py subprocess
3. **API keys:** Environment variables only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) for v1
4. **Critic prompts:** Stored as markdown files in `toneguard-mcp/critics/` (not in debate-team repo) — colocated with the server

## Architecture (Chosen: Simplicity)

All-in-one MCP server with 4 modules. No subprocess calls, no external script dependencies. Critics run as parallel async tasks within the server process.

```
toneguard-mcp/
├── server.py           # FastMCP server — 4 tools
├── analyzer.py         # Multi-agent analysis: 2 critics → synthesizer
├── learning_store.py   # JSON file-backed learning storage
├── merge.py            # Python port of merge strategies
├── sync.py             # Supabase sync client (httpx async)
├── critics/
│   ├── claude-tone.md  # Claude Haiku critic prompt
│   └── gpt-tone.md    # GPT-4o-mini critic prompt
├── tests/
│   ├── test_merge.py       # Merge parity with JS tests
│   ├── test_learning.py    # Learning store CRUD
│   ├── test_analyzer.py    # Critic + synthesizer mocks
│   └── test_server.py      # Integration: tool → output
├── pyproject.toml      # Dependencies + project metadata
└── README.md           # Setup + MCP client config
```

## Step-by-Step Plan

---

### Step 1: Project scaffolding + merge.py

**Files:** `toneguard-mcp/pyproject.toml`, `toneguard-mcp/merge.py`, `toneguard-mcp/tests/test_merge.py`

**What:**
- Create `pyproject.toml` with dependencies: `fastmcp`, `anthropic`, `openai`, `httpx`, `pytest`, `pytest-asyncio`
- Port all 6 merge functions from `src/sync/merge.js` to Python:
  - `merge_decisions(local, remote)` — union by timestamp+action, sort newest, trim 100
  - `merge_voice_samples(local, remote)` — dedup by text, sort newest, trim 30
  - `merge_relationships(local, remote)` — per-key max messageCount + latest lastSeen
  - `merge_custom_rules(local, remote)` — LWW on updatedAt
  - `merge_stats_history(local, remote)` — union by weekStart, max counts, trim 12
  - `merge_by_mode(a, b)` — helper for stats byMode

**Test:** Port all test cases from `tests/merge.test.js` to pytest. Must produce identical output for the same inputs. This is the cross-platform parity guarantee.

**Dependencies:** None (pure functions, no I/O)

---

### Step 2: learning_store.py

**Files:** `toneguard-mcp/learning_store.py`, `toneguard-mcp/tests/test_learning.py`

**What:**
- `LearningStore` class backed by `~/.toneguard/learning.json`
- Storage keys match Chrome/Android exactly:
  ```python
  STORAGE_KEYS = {
      "decisions": "tg_decisions",
      "voice_samples": "tg_voice_samples",
      "relationships": "tg_relationships",
      "custom_rules": "tg_custom_rules",
      "stats": "tg_stats",
      "stats_history": "tg_stats_history",
  }
  ```
- Methods:
  - `load()` — read JSON file, return empty dict if missing/corrupt
  - `save()` — atomic write (write to `.tmp`, rename)
  - `get(key)` — get a storage key's value
  - `set(key, value)` — set a storage key, trigger save
  - `log_decision(action, original, suggestion, final_text)` — append to decisions, update stats
  - `get_learning_context(limit=5)` — recent decisions + voice samples for critic prompts
  - `get_history(limit=10, action_filter=None)` — query decisions with optional filter
  - `get_stats()` — return current stats dict

**Test:**
- CRUD: write → read → verify
- Atomic write: corrupt mid-write → file intact
- Stats update: log 3 decisions → stats reflect counts
- Empty file: load returns valid empty structure
- Missing file: auto-creates on first write

**Dependencies:** Step 1 (merge.py — used internally for sync merges)

---

### Step 3: sync.py

**Files:** `toneguard-mcp/sync.py`

**What:**
- `SyncClient` class using `httpx.AsyncClient`
- Constants from JS source:
  ```python
  SUPABASE_URL = "https://jimjfaaaccqtcbbxsrys.supabase.co"
  SUPABASE_ANON_KEY = "sb_publishable_NyUr9I9amTiVVWT5H8ysvg_lB054qK0"
  TABLE = "sync_data"
  DEBOUNCE_SECONDS = 5.0
  POLL_INTERVAL_SECONDS = 300  # 5 minutes
  ```
- Methods:
  - `authenticate(api_key_hash)` — POST to `/functions/v1/auth-by-hash`, store JWT
  - `pull(user_hash)` — GET from REST API, return `{data_type: {payload, version}}`
  - `push(user_hash, data_type, payload, version)` — POST with `Prefer: resolution=merge-duplicates`
  - `hash_api_key(api_key)` — SHA-256 hex digest (must match JS `hashApiKey`)
- `SyncManager` class:
  - `init(api_key, learning_store)` — authenticate + pull + start poll
  - `schedule_push(data_type)` — debounced push (5s)
  - `pull()` — pull all, merge with local via `merge.py`, save to learning store
  - `_poll_loop()` — asyncio task, pull every 5 min
  - `stop()` — cancel poll task, flush pending pushes
  - `last_sync_at` property — ISO timestamp of last successful sync
  - `connected` property — bool (JWT is valid)

**Test:** No unit tests for sync (requires live Supabase). Will be tested in integration step.

**Dependencies:** Steps 1-2 (merge.py, learning_store.py)

---

### Step 4: Critic prompts + analyzer.py

**Files:** `toneguard-mcp/critics/claude-tone.md`, `toneguard-mcp/critics/gpt-tone.md`, `toneguard-mcp/analyzer.py`, `toneguard-mcp/tests/test_analyzer.py`

**What — Critic prompts:**

`claude-tone.md` — Claude Haiku critic:
- Focus: tone detection, passive-aggression, guilt-trips, defensive framing, emotional manipulation
- Input: message + style-rules.md + learned voice samples + relationship context
- Output format: `{flagged: bool, issues: [{rule, quote, explanation}], suggestion: str, confidence: float}`

`gpt-tone.md` — GPT-4o-mini critic:
- Focus: clarity, Hemingway checks, sentence structure, grammar, wordiness
- Input: same context as Claude critic
- Output format: same JSON structure

**What — analyzer.py:**

`ToneAnalyzer` class:
- `__init__(style_rules_path, learning_store)` — loads style rules, watches for file changes
- `analyze(message, context=None, recipient=None)` → structured result
- Internal flow:
  1. Build prompt context: style rules + `learning_store.get_learning_context()` + relationship info
  2. Load critic prompts from `critics/*.md`
  3. Call **both critics in parallel** using `asyncio.gather`:
     - Claude Haiku via `anthropic.AsyncAnthropic().messages.create()`
     - GPT-4o-mini via `openai.AsyncOpenAI().chat.completions.create()`
  4. Parse each critic's JSON response (with fallback for malformed output)
  5. Call **synthesizer** (Claude Sonnet) with both outputs:
     - For each issue: ADOPT / REJECT / DEFER
     - Best rewrite combining strongest catches
     - Merged confidence score
  6. Return structured output:
     ```python
     {
         "flagged": bool,
         "issues": [{"rule": str, "quote": str, "explanation": str}],
         "rewrite": str,
         "diff": [{"type": "added"|"removed"|"same", "text": str}],
         "confidence": float,
         "agents": {"claude": str, "gpt": str}
     }
     ```
- `_compute_diff(original, rewrite)` — word-level diff for the `diff` field
- `_reload_style_rules()` — reload from file (called on file change or explicit refresh)

**Test:**
- Mock both API clients → verify parallel dispatch
- Mock malformed critic output → verify graceful fallback
- Test diff computation with known inputs
- Test prompt assembly includes learning context and relationship data

**Dependencies:** Step 2 (learning_store)

---

### Step 5: server.py — FastMCP server with 4 tools

**Files:** `toneguard-mcp/server.py`, `toneguard-mcp/tests/test_server.py`

**What:**

FastMCP server exposing 4 tools:

```python
from fastmcp import FastMCP

mcp = FastMCP("ToneGuard")

@mcp.tool()
async def analyze_message(
    message: str,
    context: str = "",
    recipient: str = "",
) -> dict:
    """Check a message for tone issues and get a rewrite suggestion."""
    return await analyzer.analyze(message, context, recipient)

@mcp.tool()
async def log_decision(
    action: str,  # "used_suggestion" | "sent_original" | "used_edited"
    original: str,
    suggestion: str = "",
    final_text: str = "",
) -> dict:
    """Record what you did with a suggestion. Helps ToneGuard learn."""
    learning_store.log_decision(action, original, suggestion, final_text)
    sync_manager.schedule_push("decisions")
    sync_manager.schedule_push("stats_history")
    return {"logged": True, "decisions_count": len(learning_store.get("decisions") or [])}

@mcp.tool()
async def get_history(
    limit: int = 10,
    action_filter: str = "",
) -> dict:
    """View recent decisions and stats."""
    return {
        "decisions": learning_store.get_history(limit, action_filter or None),
        "stats": learning_store.get_stats(),
    }

@mcp.tool()
async def sync_status() -> dict:
    """Check Supabase sync health."""
    return {
        "connected": sync_manager.connected,
        "last_sync": sync_manager.last_sync_at,
    }
```

**Startup sequence:**
1. Read `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from env
2. Initialize `LearningStore` (creates `~/.toneguard/learning.json` if missing)
3. Initialize `ToneAnalyzer` with path to `style-rules.md` (repo root)
4. Initialize `SyncManager` and call `init(api_key, learning_store)`
5. Start FastMCP server on stdio

**Shutdown:** `sync_manager.stop()` to flush pending pushes

**Test:**
- Integration test: call `analyze_message` with mocked API clients → verify full pipeline
- Test `log_decision` → verify learning store updated + sync scheduled
- Test `get_history` → verify query filters work
- Test `sync_status` → verify connected/disconnected states

**Dependencies:** Steps 2-4 (all modules)

---

### Step 6: README.md + MCP client configuration

**Files:** `toneguard-mcp/README.md`

**What:**

Documentation covering:
- Prerequisites: Python 3.11+, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Install: `cd toneguard-mcp && pip install -e .`
- MCP client config for Claude Code:
  ```json
  {
    "mcpServers": {
      "toneguard": {
        "command": "python",
        "args": ["-m", "toneguard_mcp.server"],
        "env": {
          "ANTHROPIC_API_KEY": "...",
          "OPENAI_API_KEY": "..."
        }
      }
    }
  }
  ```
- MCP client config for Cursor (same format, different config file)
- Usage examples for each tool
- Cost per analysis (~$0.02)

**Dependencies:** Step 5

---

---

### Step 7: Chrome context menu — right-click to analyze selected text

**Files:** `manifest.json`, `service-worker.js`, `content.js`, `overlay.js`

**What:**

Add a Chrome context menu item that lets users select text anywhere, right-click, and run ToneGuard on it. Shows the same overlay as send-interception.

**manifest.json:**
- Add `"contextMenus"` to `permissions` array

**service-worker.js:**
- On install/startup, create context menu:
  ```javascript
  chrome.contextMenus.create({
    id: "toneguard-analyze",
    title: "Check tone with ToneGuard",
    contexts: ["selection"]  // only shows when text is selected
  });
  ```
- Handle `chrome.contextMenus.onClicked`:
  1. Read `info.selectionText` for the selected text
  2. Send `ANALYZE` message to content script in the active tab
  3. Content script shows overlay with result (reuses existing overlay flow)

**content.js:**
- Add listener for `ANALYZE_SELECTION` message from service worker
- When received:
  1. Get the selected text via `window.getSelection()`
  2. Determine context from current site (slack/gmail/generic)
  3. Call existing `analyzeAndIntercept()` flow but in **review mode** (no send blocking)
  4. Show overlay at selection position (near cursor, not near editor)
- Overlay actions:
  - **"Copy rewrite"** — copy suggestion to clipboard
  - **"Replace"** — if selection is inside an editable element, replace the selected text with the rewrite using `document.execCommand("insertText")`
  - **"Dismiss"** — close overlay

**overlay.js:**
- Add positioning mode: `positionNearSelection()` that places the overlay near `window.getSelection().getRangeAt(0).getBoundingClientRect()`
- Add "Copy" button alongside existing "Use suggestion" button
- Add "Replace" button (enabled only when selection is in an editable field)

**Test:**
- Manual: select text on Gmail → right-click → "Check tone with ToneGuard" → overlay appears
- Manual: select text in Slack compose → right-click → analyze → "Replace" swaps text
- Manual: select text on a non-editable page (article) → "Replace" disabled, "Copy" works
- Verify context menu only appears when text is selected (`contexts: ["selection"]`)

**Dependencies:** None (uses existing extension infrastructure). Independent of MCP steps 1-6.

---

### Step 8: Fix custom site registration robustness

**Files:** `service-worker.js`, `content.js`, `popup.js`

**What:**

Fix the main issue: custom sites don't reliably activate after adding them.

**Root cause (from exploration):** `registerCustomSites()` in service-worker.js calls `chrome.scripting.unregisterContentScripts()` then `registerContentScripts()`. If unregister fails (e.g., no scripts registered yet), the re-register never runs. Also, newly registered scripts don't inject into already-open tabs.

**service-worker.js fixes:**
1. Wrap `unregisterContentScripts` in try-catch — if it fails (no existing scripts), proceed to register anyway:
   ```javascript
   async function registerCustomSites(sites) {
     try {
       await chrome.scripting.unregisterContentScripts({ ids: ["tg-custom-sites"] });
     } catch {
       // No existing scripts — that's fine, proceed to register
     }
     if (sites.length === 0) return;
     const patterns = sites.flatMap(s => [
       `https://${s}/*`,
       `https://*.${s}/*`
     ]);
     await chrome.scripting.registerContentScripts([{
       id: "tg-custom-sites",
       matches: patterns,
       js: ["content.js", "overlay.js"],
       runAt: "document_idle"
     }]);
   }
   ```
2. After registration, **inject into already-open tabs** that match the new patterns:
   ```javascript
   const tabs = await chrome.tabs.query({ url: patterns });
   for (const tab of tabs) {
     chrome.scripting.executeScript({
       target: { tabId: tab.id },
       files: ["content.js", "overlay.js"]
     });
   }
   ```
3. Add a `REGISTER_SITE` message handler that calls `registerCustomSites` and confirms success back to popup

**popup.js fixes:**
1. After `addSite()`, wait for confirmation from service worker before showing success
2. Add visual feedback: "Activating on example.com..." → "Active!" or "Failed — try reloading the page"
3. Show a "Reload required" hint for tabs that were open before the site was added

**content.js fixes:**
1. Add guard against double-injection — if ToneGuard is already active on a page, skip re-initialization:
   ```javascript
   if (window.__toneGuardActive) return;
   window.__toneGuardActive = true;
   ```
2. Improve `detectPlatform()` to use exact domain matching instead of `host.includes()`:
   ```javascript
   function detectPlatform() {
     const host = location.hostname;
     if (host === "app.slack.com") return "slack";
     if (host === "mail.google.com") return "gmail";
     if (host === "www.linkedin.com") return "linkedin";
     if (host.endsWith(".turbotenant.com")) return "turbotenant";
     return "generic";
   }
   ```

**Test:**
- Add a custom site → verify it activates without reloading the extension
- Add a custom site with a tab already open → verify injection into open tab
- Remove a custom site → verify content script stops activating
- Add two sites, remove one → verify the other still works
- Verify `host.includes("slack")` no longer matches `not-slack.com`

**Dependencies:** None. Independent of MCP steps and Step 7.

---

## Dependency Graph

```
MCP Server (feat/mcp-server branch):

  Step 1 (merge.py)
      ↓
  Step 2 (learning_store.py) ←─── uses merge for sync
      ↓
  Step 3 (sync.py) ←────── uses merge + learning_store
      ↓
  Step 4 (analyzer.py) ←── uses learning_store for context
      ↓
  Step 5 (server.py) ←──── wires everything together
      ↓
  Step 6 (README.md)

Chrome Extension (feat/context-menu branch):

  Step 7 (context menu)  ──── independent
  Step 8 (custom site fix) ── independent
```

Steps 1-6 are the MCP server (Python).
Steps 7-8 are Chrome extension fixes (JavaScript).
Steps 7 and 8 are independent of each other AND of steps 1-6 — all three tracks can be worked in parallel.

## Out of Scope (from design doc)

- Custom rules management via MCP tools (read-only for now)
- Real-time WebSocket subscription (poll-only for simplicity)
- Multiple concurrent analyses (serial for v1)
- plancraft_review.py modifications (all-in-server approach chosen)
- Chrome encrypted storage reading (env vars only)
- Slack message shortcuts API integration (message-level only, no selected text support)
- Per-site custom selector configuration (generic selectors for custom sites in v1)

## Future: macOS Native App (HeyLemon Model)

A system-wide macOS native app using Accessibility APIs could replace the Chrome extension for desktop use. [HeyLemon.ai](https://heylemon.ai/) demonstrates this pattern:
- macOS app (not browser extension) with Accessibility API permissions
- Works in ANY app — Slack desktop, iMessage, Notes, etc.
- Trigger via keyboard shortcut (fn key) — no right-click needed
- Text injection via system-level APIs, not DOM manipulation

**Why this matters:** The Chrome extension only works in web browsers. A native app would cover Slack desktop, Apple Mail, iMessage, and any other Mac app — eliminating the per-site selector fragility entirely.

**What it would take:** New Swift/SwiftUI project, macOS Accessibility APIs, separate distribution (not Chrome Web Store). Significant scope — treat as a separate project.

## Risk Notes

- **Merge parity:** Python merge functions MUST produce identical output to JS. The test suite is the contract — port every test case from `tests/merge.test.js`.
- **API rate limits:** Two parallel API calls per analysis. No retry logic for rate limits in v1 — if a critic fails, the analyzer returns partial results from the other critic.
- **File watching:** Style rules reload uses polling (check mtime every 60s), not inotify. Simple and cross-platform.
- **Supabase anon key:** Hardcoded in sync.py (same as Chrome extension). This is a publishable key per Supabase design — safe for client code.
- **Context menu positioning:** Overlay near selection may overlap content. Need to handle edge cases (selection at top of viewport, selection in iframes).
- **Double injection guard:** Custom site fix injects into already-open tabs. Must prevent duplicate event listeners if content.js runs twice.
