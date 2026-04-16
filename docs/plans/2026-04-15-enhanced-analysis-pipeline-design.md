# Enhanced Analysis Pipeline Design

**Date:** 2026-04-15
**Status:** Approved
**Scope:** 4 pipeline improvements — rubric scoring, competing rewrites, self-grading loop, style preservation

## Problem

ToneGuard's current pipeline does a single analysis pass: two critics flag issues, a synthesizer merges them and produces one rewrite. This misses opportunities to:

1. Give users structured, per-dimension feedback (not just prose issues)
2. Leverage model diversity for better rewrites (critics already generate suggestions independently)
3. Catch subpar rewrites before returning them (no quality gate)
4. Preserve the user's natural voice in rewrites (samples exist but aren't emphasized)

## Design

### Enhanced Pipeline Flow

```
Message
  ├─ Claude Haiku critic (tone + rewrite)     ─┐
  ├─ GPT-4o-mini critic (clarity + rewrite)   ─┤
  │                                             ▼
  │                              Synthesizer (Sonnet)
  │                              ├─ Pick best rewrite from 2 candidates
  │                              ├─ Score rubric (6 dimensions, A-F)
  │                              └─ Produce merged rewrite
  │                                             │
  │                                   ┌─────────▼──────────┐
  │                                   │  Self-Grade Check   │
  │                                   │  Any dim < B?       │
  │                                   └─────────┬──────────┘
  │                                        no / │ \ yes
  │                                       ▼     │    ▼
  │                                    Return   │  Refine + re-grade
  │                                             │  (max 2 passes)
  │                                             ▼
  │                                          Return
  ▼
Diff (unchanged)
```

### 1. Structured Rubric Scoring

New `rubric` field in analysis response:

```json
{
  "rubric": {
    "tone": {"grade": "A", "score": 93, "note": "Warm without being sycophantic"},
    "clarity": {"grade": "B+", "score": 87, "note": "Second sentence could be tighter"},
    "brevity": {"grade": "A-", "score": 90, "note": "Good density"},
    "empathy": {"grade": "A", "score": 95, "note": "Acknowledges recipient's position"},
    "directness": {"grade": "B", "score": 83, "note": "Opening hedges slightly"},
    "voice_fidelity": {"grade": "A-", "score": 90, "note": "Matches user's casual style"}
  },
  "overall_grade": "A-",
  "overall_score": 90
}
```

**Grading scale:** A (93-100), A- (90-92), B+ (87-89), B (83-86), B- (80-82), C+ (77-79), C (73-76), C- (70-72), D (60-69), F (<60)

**Dimensions:**
- **Tone:** Emotional register — no passive-aggression, guilt-trips, or manipulation
- **Clarity:** Easy to understand on first read — no ambiguity
- **Brevity:** Says what it needs to in minimum words
- **Empathy:** Shows awareness of recipient's perspective
- **Directness:** Gets to the point — no excessive hedging or throat-clearing
- **Voice Fidelity:** How well the rewrite matches the user's natural writing style (from voice samples)

### 2. Competing Rewrites

Both critic prompts are updated to produce a full `rewrite` field (not just `suggestion`). The synthesizer receives both rewrites and evaluates them:

**Synthesizer prompt addition:**
```
You received two competing rewrites from different critics.
Evaluate each rewrite against the rubric dimensions.
Pick the stronger rewrite as your starting point, then improve it
by incorporating the best elements from the other.
```

The final response includes a `rewrite_source` field indicating which critic's rewrite was selected as the base: `"claude"`, `"gpt"`, or `"merged"`.

### 3. Self-Grading Loop

After the synthesizer produces its initial result (with rubric scores), a quality gate checks if any dimension scored below B (83). If so:

1. **Refinement pass:** The synthesizer is called again with:
   - The original message
   - The current rewrite
   - The rubric scores with notes
   - Instruction: "Improve the weak dimensions without regressing strong ones"
2. **Re-grade:** The refined rewrite is scored again
3. **Max 2 passes:** If still below B after 2 refinements, return best attempt

This is implemented as `_self_grade()` on `ToneAnalyzer`. The method is only called when `flagged=True` (clean messages skip grading entirely).

**Response includes refinement metadata:**
```json
{
  "refinement_passes": 1,
  "grade_history": [
    {"pass": 0, "overall_grade": "B+", "overall_score": 87},
    {"pass": 1, "overall_grade": "A-", "overall_score": 91}
  ]
}
```

### 4. Style Preservation

The existing `voice_samples` from `LearningStore` are already passed to critics. Enhancements:

- **Synthesizer prompt:** Explicit instruction to match the user's voice patterns from samples
- **Voice Fidelity rubric dimension:** Scores how well the rewrite sounds like the user
- **Self-grade trigger:** Low voice_fidelity score triggers refinement just like any other dimension

No new storage or infrastructure needed.

## Updated Response Schema

```json
{
  "flagged": true,
  "issues": [{"rule": "str", "quote": "str", "explanation": "str"}],
  "rewrite": "str",
  "confidence": 0.85,
  "diff": [{"type": "same|added|removed", "text": "str"}],
  "agents": {"claude": "ok|error", "gpt": "ok|error"},
  "rubric": {
    "tone": {"grade": "A", "score": 93, "note": "str"},
    "clarity": {"grade": "B+", "score": 87, "note": "str"},
    "brevity": {"grade": "A-", "score": 90, "note": "str"},
    "empathy": {"grade": "A", "score": 95, "note": "str"},
    "directness": {"grade": "B", "score": 83, "note": "str"},
    "voice_fidelity": {"grade": "A-", "score": 90, "note": "str"}
  },
  "overall_grade": "A-",
  "overall_score": 90,
  "rewrite_source": "claude|gpt|merged",
  "refinement_passes": 0,
  "grade_history": []
}
```

For unflagged messages, `rubric` and grading fields are omitted (no wasted tokens scoring a clean message).

## Cost Analysis

| Scenario | Current | Enhanced | Delta |
|----------|---------|----------|-------|
| Clean message | ~$0.02 | ~$0.02 | $0.00 |
| Good first rewrite | ~$0.02 | ~$0.02 | $0.00 |
| Needs 1 refinement | ~$0.02 | ~$0.03 | +$0.01 |
| Needs 2 refinements | ~$0.02 | ~$0.04 | +$0.02 |

## Files Changed

1. **`analyzer.py`** — Competing rewrites in synthesizer prompt, `_self_grade()` method, rubric parsing
2. **`critics/claude-tone.md`** — Add `rewrite` field to output, emphasize full message rewrite
3. **`critics/gpt-tone.md`** — Same: add `rewrite` field to output
4. **`server.py`** — Updated docstring for `analyze_message` return schema
5. **`tests/test_analyzer.py`** — Tests for rubric parsing, self-grade loop, competing rewrites
6. **`tests/test_live_integration.py`** — Live validation of rubric scores and refinement

## Non-Goals

- Vector DB for style matching (existing voice_samples sufficient)
- User-configurable rubric dimensions (start fixed)
- Persistent rubric history/trends (future enhancement)
- Chrome extension UI changes (pipeline-only for now)
