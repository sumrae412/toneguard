# ToneGuard "Virtual Brain" — Design Plan

**Date:** 2026-05-30
**Goal:** Make ToneGuard durably learn from user edits and bias rewrites toward the user's writing voice — beyond the current 9-recency-window decision injection.

## Phased plan (one PR per phase)

| Phase | Branch | Scope |
|---|---|---|
| 5a | `feat/ext-pattern-extractor` | Pattern extractor: token-level diff mining over `tg_decisions[]` → `tg_patterns[]` in chrome.storage.local + sync |
| 5b | `feat/ext-memory-export` | `memory.md` export: render `tg_patterns[]` as markdown, "Download memory.md" button in extension options |
| 5c | `feat/ext-pattern-injection` | Inject top-N patterns into system prompt suffix (uncached — patterns evolve) |
| 5d | `feat/voice-principles-distillation` | Distill `writing-voice/references/voice_profile.md` into `prompts/voice-principles.txt`; fold into base prompt build |
| 5e | `feat/ext-memory-graph` | Purpose-built graph builder: nodes = patterns + recipients + voice traits; edges = co-occurrence + accept-rate; rendered as cross-linked sections in `memory.md` |

## Key architectural decisions (Phase 5a defaults; revisitable later)

### Pattern extraction algorithm
**Choice:** Token-level diff mining (suggestion vs finalText), bucketed by recipient and tone category.
**Why:** No LLM cost, runs in the service worker, produces specific substitutions. Phase 5c can layer LLM-based summarization if signal is too noisy.
**Rejected:** N-gram mining (requires too many decisions), pure LLM extraction (cost + latency).

### Extraction cadence
**Choice:** Opportunistic (every `analysis_completed` event with action=`used_edited`) + on-demand (when user opens Memory view).
**Why:** Service worker shouldn't carry scheduled background load; on-demand guarantees freshness without periodic compute.

### Privacy / data shape
**Choice:** Same trust boundary as `tg_decisions` today — chrome.storage.local + user's own sync server. No new PII surface. Recipients = `@mention` only.
**Why:** Doesn't introduce new data exposure. User already trusts ToneGuard with raw messages.

### Storage schema (`tg_patterns[]`)
```json
{
  "id": "uuid",
  "from_token": "asap",
  "to_token": "when you have a moment",
  "category": "softening | hedging | formality | structure | other",
  "recipients": ["@sam", "@dana"],
  "occurrences": 4,
  "accept_count": 3,
  "first_seen": "2026-05-15T...",
  "last_seen": "2026-05-29T...",
  "sample_decision_ids": ["dec_abc", "dec_def"]
}
```

### Memory.md structure (Phase 5b)
- Top-level sections: "Substitutions by category", "Patterns by recipient", "Voice principles" (Phase 5d), "Graph view" (Phase 5e)
- Human-readable, inspectable
- Downloadable via button in extension options
- NOT auto-checked into any repo (lives in chrome.storage; export-only)

### Conflict resolution: voice profile vs learned patterns
**Choice:** Voice profile = soft prior. Learned patterns = recency-weighted override.
**Rationale:** The voice profile is curated/durable. Learned patterns reflect actual recent behavior. If they contradict, patterns win for that specific substitution but voice principles still apply globally.

## Out of scope (explicitly)

- Fine-tuning. None of this trains the model.
- Per-message embeddings or vector search. Pure text + structured patterns.
- Multi-user / multi-tenant patterns. Patterns are per-API-key, synced per-user.
- Pattern decay / time-weighting. Phase 5+ if accept-rate stability becomes an issue.

## Risk: pattern injection bloats the cached prefix

The system prompt is currently split (PR #52): cached basePrompt + uncached suffix. Pattern injection MUST go in the **uncached suffix** — patterns change daily, basePrompt must stay stable for caching to work.

Phase 5c will append `buildPatternBlock()` output to `fullPrompt` AFTER `basePrompt`, so it lands in the uncached suffix block. The cached prefix stays untouched. Verify via `usage.cache_read_input_tokens > 0` after Phase 5c ships.

## Acceptance criteria per phase

- **5a:** Patterns extracted; visible via `chrome.storage.local.get('tg_patterns')`. No prompt change yet. vitest green with extractor unit tests.
- **5b:** Memory.md downloadable from options. Renders the pattern store as readable markdown.
- **5c:** Patterns visible in service-worker fetch requests' system prompt suffix. `usage.cache_read_input_tokens > 0` still hits on the cached prefix.
- **5d:** `prompts/voice-principles.txt` exists. Service worker loads it and includes in basePrompt. CACHE INVARIANT: since it's part of basePrompt, voice-principles updates require a full cache write — acceptable since voice changes ~monthly.
- **5e:** Graph rendered as cross-linked sections in memory.md. Bidirectional links work.
