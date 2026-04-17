# Plan: Personal Voice Training (#1) + Message Landing Critic (#3)

**Status:** Plan only. Not executed.
**Date:** 2026-04-16
**Branch (to create):** `feat/voice-training-and-landing`

---

## Context: what already exists

Commit `5fcd3ac` (enhanced analysis pipeline) shifted the baseline significantly. Before writing new code, acknowledge what's already in place:

| Capability | State |
|---|---|
| `tg_voice_samples` storage (chrome + local JSON + Supabase sync) | ✅ exists |
| Auto-capture of voice samples in `service-worker.js:393` (`saveVoiceSample`) | ✅ exists |
| Voice samples injected into synthesizer prompt with explicit "match this style" instruction | ✅ exists (analyzer.py:203-221) |
| `voice_fidelity` rubric dimension (0-100, letter grade) | ✅ exists |
| Self-grading refinement loop (refines if any dim < B) | ✅ exists |
| Supabase `sync_data` table with RLS + JWT auth | ✅ exists |
| Supabase merge for `voice_samples` (CRDT-style) | ✅ exists (merge.py) |

**What's NOT there:**
- No explicit opt-in training UX (paste-your-best-messages flow)
- No derived style fingerprint — samples are injected as raw text (token-heavy, noisy)
- No review/edit UI for voice samples in `options.html`
- No separation between *passively collected* samples and *curated training set*
- No "message landing" / takeaway analysis of any kind
- No "what a skimmer reads" surface in the overlay

These gaps define the work.

---

## Requirements

### Feature #1 — Personal Voice Training

**User stories**
- As a user, I want to paste 5-10 messages I'm proud of so the rewriter sounds like me, not like a generic polite assistant.
- As a user, I want to see which samples ToneGuard is using and remove any I don't want it learning from.
- As a user, I want to regenerate my "style profile" after I've added new samples.

**Acceptance criteria**
- AC-1: The options page has a "Train Your Voice" section with a multi-line textarea accepting pasted samples separated by blank lines.
- AC-2: Submitting training samples stores them as `tg_voice_samples` with `source: "trained"` (distinct from `source: "auto"` used by existing auto-capture).
- AC-3: Trained samples take precedence over auto-captured samples when the synthesizer prompt is built (up to 5 trained > auto).
- AC-4: The options page lists current samples with origin badge (trained/auto), timestamp, and per-item delete.
- AC-5: A "regenerate style profile" button calls a new MCP tool that compresses samples into a structured fingerprint; the fingerprint (not raw samples) is injected into the synthesizer prompt when available.
- AC-6: If the user has <3 trained samples, the system falls back to raw-sample injection (current behavior).
- AC-7: `voice_fidelity` rubric score reflects fingerprint-match quality; no regression on the 74 existing analyzer tests.

**Scope — in**
- New MCP tool: `train_voice(samples: list[str]) -> {fingerprint: str, sample_count: int}`
- Fingerprint is free-text structured block (~200 tokens) with sections: *tone defaults*, *preferred phrasings*, *avoided phrasings*, *formality register*, *opening/closing patterns*
- Fingerprint stored in `learning_store` under new key `voice_fingerprint`, synced to Supabase
- New options-page section with textarea, sample list, regenerate button
- Analyzer prefers `voice_fingerprint` over raw samples when present (fallback chain: fingerprint → trained samples → auto samples → none)

**Scope — out**
- Continuous/incremental fingerprint updates (regenerate is manual-only, v1)
- Per-recipient voice styles (that's Feature #2, future)
- Migration of existing auto-collected samples — they remain, tagged `source: "auto"`
- Android/PWA support for the training UI
- Voice fingerprint preview/editing — users see it but can't hand-edit (v1)

**Edge cases**
- <30 char samples: reject with inline error ("too short — paste longer examples")
- Duplicate samples: dedupe on submit
- 10+ samples pasted: cap at 15 stored, warn user
- Fingerprint generation fails (API error): keep existing fingerprint if any, else fall back to raw samples
- User clears all samples: `voice_fingerprint` is cleared too (no stale profile)

---

### Feature #3 — Message Landing Critic

**User stories**
- As a user, I want to see what a recipient would take away if they only skimmed my message so I can check my intent survived.
- As a user, I want to write "my intent" once and have the system tell me whether the rewrite preserved it.

**Acceptance criteria**
- AC-8: Analysis output includes a new `landing` object: `{takeaway: str, tone_felt: str, next_action: str | null}`.
- AC-9: The overlay shows a "If they only skim…" panel beneath the rewrite, displaying takeaway/tone/action.
- AC-10: Analysis cost increase ≤ $0.005 per call (Haiku-tier, not Sonnet).
- AC-11: Landing generation runs in parallel with the two existing critics (no latency increase for clean messages).
- AC-12: On API failure, the landing panel is hidden; analysis still returns a valid result.

**Scope — in**
- New parallel critic call in `analyzer.py` using Claude Haiku (same model as tone critic, lowest-cost slot)
- New prompt file: `toneguard-mcp/critics/landing.md`
- Extension of analyzer result schema: adds `landing` field
- Overlay UI: new collapsible panel showing landing output (iframe overlay — edit `overlay-frame.js` + `overlay-frame.css`, not legacy `overlay.js`)

**Scope — out**
- "Intent input" field (user types intended takeaway, we diff). Defer to v2 — v1 just *shows* the takeaway.
- Making landing a 7th rubric dimension — keep separate so it can fail independently without triggering refinement loops.
- Landing-driven refinement (re-rewrite if takeaway drifts). Additive later.

**Edge cases**
- Very short messages (<10 words): skip landing call, show nothing.
- Message is a question: takeaway may be the answer expected — prompt must handle this explicitly.
- Non-English messages: out of scope for v1, prompt in English only.

---

## Design decisions with tradeoffs

### D1. Fingerprint representation: free-text vs structured JSON
**Chosen:** Structured free-text markdown block (~200 tokens, sections for tone/phrasings/register).
**Alternatives:**
- **Pure JSON schema** (e.g. `{formality: "casual", uses_emdash: true, ...}`) — rejected: lossy, forces reductive choices, hard to extend.
- **Raw samples only** (current behavior) — rejected: token-heavy (~500+ for 5 samples), noisy, no compression benefit.

**Tradeoff:** Free-text is less machine-readable but is what the synthesizer actually consumes (a text prompt). Structured-feeling output from an LLM reads well and composes into prompts naturally. Cost: one Sonnet call per regenerate (~$0.02, infrequent).

### D2. Fingerprint storage location
**Chosen:** `learning_store` key `voice_fingerprint` (JSON file), synced to Supabase as new `data_type: "voice_fingerprint"`.
**Alternatives:**
- Store inline in `voice_samples` payload — rejected: conflates raw data with derived data.
- Store in `custom_rules` — rejected: different lifecycle (rules are hand-authored, fingerprint is generated).

**Tradeoff:** Adds one more sync data type (minor). Benefits: clean invalidation (regenerate = overwrite), separate merge policy (last-write-wins vs CRDT-union for samples).

### D3. Landing critic: separate call vs rubric dimension
**Chosen:** Separate parallel Haiku call, output merged into top-level `landing` field.
**Alternatives:**
- **7th rubric dimension (`intent_fidelity`)** — rejected: triggers refinement loops when landing disagrees with rewrite, which could over-correct. Also, landing is *descriptive* (what does this read as) not *prescriptive* (what should change).
- **Sequential step after synthesis** — rejected: adds latency in serial chain.

**Tradeoff:** Adds one model call (~$0.002 Haiku). Parallelism hides latency. Independent failure means if landing fails, rewrite still returns.

### D4. UX surface for the landing panel
**Chosen:** Collapsible section in the overlay, below the rewrite, default-expanded for flagged messages only.
**Alternatives:**
- Always visible — rejected: clutters clean messages where the rewrite is fine.
- Inline with rubric — rejected: rubric is a *scorecard*, landing is a *reframe*; mixing them muddies the mental model.

**Tradeoff:** Users have to click to see landing on clean messages, but that's rare (clean = no rewrite to compare against anyway).

### D5. Training samples: cap and eviction
**Chosen:** Cap trained samples at 15; cap auto samples at 30 (existing); combined injection prefers trained up to 5.
**Alternative:** Unified cap of 30 — rejected: trained samples are higher-signal and shouldn't compete with the cap.

### D6. Sequencing (user proposed #1 then #3)
**Chosen:** Build in parallel on a single branch, one PR. Reasons:
- Both touch `analyzer.py` (fingerprint injection + landing call sit adjacent in `analyze()`).
- Both touch overlay iframe (`overlay-frame.js`/`.css`/`.html`).
- Testing is clearer when the analyzer contract changes once, not twice.
- Ship gate is the same (`./scripts/quick_ci.sh` — wait, this project uses `uv run pytest`; see build commands).

Risk: PR gets larger (~600 LoC vs 350+250). Mitigation: clean commits-per-phase inside the branch.

---

## File-level change list

### MCP server (`toneguard-mcp/`)

| File | Change | Size |
|---|---|---|
| `analyzer.py` | Add `_build_voice_section()` that prefers fingerprint over samples. Add `_call_landing()` method. Wire landing into `asyncio.gather()` in `analyze()`. Schema: add `landing` field to result. | ~80 LoC |
| `critics/landing.md` | **NEW** — system prompt for takeaway/tone-felt/next-action extraction. | ~40 lines |
| `learning_store.py` | Add `voice_fingerprint` to `STORAGE_KEYS`. Add `save_trained_samples(samples: list[str])` and `get_trained_samples()` helpers. Fingerprint is a plain string. | ~30 LoC |
| `sync.py` | Add `"voice_fingerprint"` to `DATA_TYPES`. | ~2 LoC |
| `merge.py` | Add `merge_voice_fingerprint(local, remote)` — last-write-wins on timestamp. | ~15 LoC |
| `server.py` | New tool `train_voice(samples: list[str]) -> dict`. New tool `get_voice_profile() -> dict`. Tool `regenerate_fingerprint() -> dict`. | ~50 LoC |
| `tests/test_analyzer.py` | Fingerprint injection priority tests; landing parallel-call tests; landing failure isolation tests. | ~120 LoC |
| `tests/test_learning_store.py` | Trained vs auto sample distinction; fingerprint round-trip. | ~60 LoC |

### Chrome extension

| File | Change | Size |
|---|---|---|
| `options.html` | New `<section>` "Train Your Voice" with textarea, submit, sample list, regenerate button. | ~40 lines HTML + 30 lines CSS |
| `options.js` | Wire training form: submit → save to `chrome.storage.local` with `source: "trained"`, trigger sync push. Render sample list with delete buttons. Call backend to regenerate fingerprint. | ~120 LoC |
| `service-worker.js` | `saveVoiceSample` gains `source` param (default `"auto"`). New message handler `TRAIN_VOICE` that batch-inserts with `source: "trained"`. | ~40 LoC |
| `overlay-frame.html` | New `<div class="tg-landing-panel">` block. | ~15 lines |
| `overlay-frame.css` | Styles for landing panel (collapsible, muted bg). | ~30 lines |
| `overlay-frame.js` | Render `result.landing` into panel when present. Hide if missing. | ~40 LoC |
| `src/sync/sync-manager.js` | Add `"voice_fingerprint"` to DATA_TYPES (mirrors Python change). | ~2 LoC |

### Supabase

| File | Change | Size |
|---|---|---|
| *(none)* | The `sync_data` table is data-type-agnostic — just store a new `data_type` value. No migration needed. | 0 |

### Docs

| File | Change |
|---|---|
| `CHANGELOG.md` | Entry under "Unreleased". |
| `README.md` | Add "Train your voice" to the feature list + quick instructions. |
| `docs/plans/2026-04-16-voice-training-and-landing-critic.md` | **This doc.** |

**Total estimated size:** ~650 LoC across Python + JS + HTML/CSS, plus ~180 LoC of tests.

---

## Phased build sequence (inside the single branch)

| Phase | What | Verification gate |
|---|---|---|
| **A.** Backend foundation | `learning_store` keys, `sync`/`merge` additions, trained-vs-auto distinction | `uv run pytest toneguard-mcp/tests/test_learning_store.py -v` |
| **B.** Fingerprint generation | `train_voice` + `regenerate_fingerprint` MCP tools; analyzer prefers fingerprint | Analyzer tests pass; manual: run `train_voice` and verify fingerprint stored |
| **C.** Landing critic | `critics/landing.md`, parallel call in analyzer, result schema extension | Analyzer tests pass with landing field; failure-isolation test passes |
| **D.** Extension: voice training UI | `options.html` section, `options.js` handlers, `service-worker.js` routing | Manual: paste samples, see them listed, click regenerate, see fingerprint returned |
| **E.** Extension: landing panel | `overlay-frame` changes, render `landing` from analyzer response | Manual: flag a message, see landing panel populate |
| **F.** End-to-end verification | Run full analysis on a sample message, verify fingerprint-driven rewrite and landing panel both appear | `./toneguard-mcp` tests green + manual smoke in Chrome |

**Why this order:** A→B unblocks backend independently (can be merged even if UI slips). C is orthogonal to A/B. D depends on B's MCP tools. E depends on C's result schema. F is the integration smoke.

---

## Open questions / risks

1. **Fingerprint generation model.** Sonnet is overkill for a one-shot style summary. Haiku may be sufficient — decide in phase B by running both on a test sample set. If Haiku output is thin, use Sonnet. Cost impact is one call per regenerate (<$0.02 either way, infrequent).

2. **Where does auto-capture go?** Today `saveVoiceSample` is called in `service-worker.js` — need to locate all call sites and confirm they become `source: "auto"`. Quick grep before phase A.

3. **Fingerprint staleness.** A fingerprint derived from 5 samples 3 months ago is stale if the user has since added 10 new samples. V1: show last-regenerated timestamp; user manually regenerates. V2 (future): auto-regenerate when trained sample count changes by >20%.

4. **Landing panel on "clean" messages.** If message is clean (not flagged), does landing still run? Current acceptance says yes (AC-11), but there's an argument for skipping to save cost. Decision: **run always** — landing is useful *especially* when the message looks fine but may land wrong. The $0.002 per call is acceptable.

5. **Test-driven development discipline.** Per CLAUDE.md's TDD skill, write analyzer tests *before* implementation for phases B, C. Extension UI can be manually verified but should have at least smoke tests in `tests/`.

6. **Semgrep + pre-commit.** The DOM-API rule in existing CLAUDE.md notes — landing panel and options page both render model output to DOM; **must use `createElement`/`textContent`, not `innerHTML`**. See `defensive-ui-flows` skill.

---

## Build commands (per CLAUDE.md)

```bash
# MCP server (Python)
cd toneguard-mcp
source $HOME/.local/bin/env
uv sync
uv run --extra dev pytest tests/ -v

# Extension tests (JS)
cd ..
npm test

# Live integration (uses real API keys from .env)
cd toneguard-mcp && set -a && source .env && set +a && uv run --extra dev pytest tests/test_live_integration.py -v -s
```

---

## What this plan deliberately does NOT do

- No execution. Zero files written outside `docs/plans/`.
- No feature branch created. Do that in Phase 5 when you're ready to start.
- No subagent dispatch. The scope here is well-enough understood after exploration that the full claude-flow advisor loop would be ceremony.
- No decisions locked in on items marked "Open questions" above. Those get resolved inside the implementation phase with quick spikes.

**Next step when ready to build:** `git checkout -b feat/voice-training-and-landing`, then execute phases A → F in order. Re-invoke claude-flow at that point, passing this plan as the input to skip directly to Phase 5 (plan path).
