# Plan: ToneGuard Improvement Roadmap

> **Status (annotated 2026-05-24): SHIPPED.** All 10 phases below were delivered piecemeal between 2026-04-27 and 2026-05-24, not as a single planned execution. This doc is kept as a historical artifact; current shipped state lives in [`docs/plans/2026-05-24-session-handoff-v2.md`](2026-05-24-session-handoff-v2.md) and the per-PR commits below. Do not re-execute this plan.
>
> Phase → shipping PR map (primary contributor; many phases touched multiple PRs):
> - Phase 1 (Shared contracts / prompt source of truth) → [#41](https://github.com/sumrae412/toneguard/pull/41), [#39](https://github.com/sumrae412/toneguard/pull/39), `399a4ae` (unify analysis contracts)
> - Phase 2 (Golden fixtures + cross-path contract tests) → vitest baseline (494 tests) + parity scanner [#41](https://github.com/sumrae412/toneguard/pull/41)
> - Phase 3 (Deterministic pre-checks + smart routing) → [#19](https://github.com/sumrae412/toneguard/pull/19) (rubric scoring, competing rewrites, self-grading)
> - Phase 4 (Explainable feedback UI) → [#23](https://github.com/sumrae412/toneguard/pull/23) ("if they only skim" landing panel), [#19](https://github.com/sumrae412/toneguard/pull/19), [#38](https://github.com/sumrae412/toneguard/pull/38) (Smart Brevity layer)
> - Phase 5 (Intent modes) → `shared/analysis/modes.json` canonical; consumed across 4 clients
> - Phase 6 (Voice preservation controls) → [#23](https://github.com/sumrae412/toneguard/pull/23) (personal voice training), [#39](https://github.com/sumrae412/toneguard/pull/39) (PWA voice selector + Android taxonomy fix)
> - Phase 7 (Failure handling + diagnostics) → [#20](https://github.com/sumrae412/toneguard/pull/20), [#22](https://github.com/sumrae412/toneguard/pull/22), [#30](https://github.com/sumrae412/toneguard/pull/30), [#32](https://github.com/sumrae412/toneguard/pull/32)
> - Phase 8 (Site profiles) → [#18](https://github.com/sumrae412/toneguard/pull/18) (custom site permissions + per-site strictness)
> - Phase 9 (Privacy-safe telemetry) → [#42](https://github.com/sumrae412/toneguard/pull/42) (extension popup + PWA export button)
> - Phase 10 (Cross-client parity + docs) → [#41](https://github.com/sumrae412/toneguard/pull/41) (declarative parity scanner + CI gate + generated `docs/client-parity.md`)
>
> Architectural invariants from this plan are now machine-checked by `node scripts/parity_scan.mjs --check` (CI gate). Adding a new client surface requires updating `scripts/parity_manifest.json`.

---

**Original status (preserved for context):** Plan only. Not executed.
**Date:** 2026-04-27
**Branch:** `codex/toneguard-improvement-plan`
**Codex-flow path:** Full planning path. This plan is intended to be used later as a Plan Path input for implementation.

---

## Goal

Improve ToneGuard across four product layers:

1. **Accuracy:** fewer false positives, better rewrites, cheaper routing.
2. **Trust:** explain why a message was flagged and make failures explicit.
3. **Workflow fit:** adapt to user intent and site context.
4. **Maintainability:** remove prompt/schema drift across Chrome, MCP, PWA, and Android.

This roadmap covers all suggested improvements:

- More explainable feedback.
- Intent modes.
- Visible "keep my voice" controls.
- Better extension failure handling.
- Per-site behavior.
- Prompt/schema unification.
- Golden test fixtures.
- Structured telemetry.
- Smarter model routing.
- Deterministic local pre-checks.

---

## Current Baseline

| Area | Current state |
|---|---|
| Chrome extension analysis | `service-worker.js` calls Anthropic directly with `prompts/base.txt`, per-site strictness, custom rules, learned decisions, voice context, relationship context, and landing critic. |
| MCP analysis | `toneguard-mcp/analyzer.py` runs Claude Haiku + GPT-4o-mini critics, Sonnet synthesis, self-grading, landing critic, and voice fingerprint support. |
| UI overlay | `overlay-frame.js` shows badge, confidence, red flags, categories, readability, clarifying questions, word-level diff, landing panel, undo countdown, and action errors. |
| Voice | Extension supports trained and auto samples, fingerprint generation in service worker, MCP supports voice fingerprint injection. |
| Cross-client surfaces | Chrome, PWA, Android, MCP all have overlapping but divergent prompt and response logic. |
| Known risk | `AGENTS.md` explicitly warns that prompts/behaviors are duplicated and must be updated in paired locations. |

The plan should preserve these working pieces and reduce drift rather than rewrite the product.

---

## $exploration

```yaml
key_files:
  - path: service-worker.js
    role: Chrome extension analysis, prompt assembly, Anthropic calls, voice storage, failure response.
  - path: prompts/base.txt
    role: Main extension prompt contract.
  - path: toneguard-mcp/analyzer.py
    role: Multi-model MCP analyzer, synthesis, landing critic, voice fingerprint.
  - path: overlay-frame.js
    role: Extension iframe UI rendering and send/accept/failure flow.
  - path: lib.js
    role: Shared pure JavaScript helpers, parse response, site detection.
  - path: pwa/app.js
    role: PWA direct Anthropic path.
  - path: android/app/src/main/java/com/toneguard/ClaudeApiClient.kt
    role: Android direct Anthropic path.
  - path: tests/
    role: Extension unit and syntax tests.
  - path: toneguard-mcp/tests/
    role: MCP analyzer and integration tests.
patterns:
  - name: DOM safety
    example_file: overlay-frame.js
  - name: Failure visible to user
    example_file: overlay-frame.js
  - name: Extension prompt assembled from base + runtime sections
    example_file: service-worker.js
  - name: MCP model calls isolated behind testable methods
    example_file: toneguard-mcp/analyzer.py
integration_points:
  - system: Chrome extension
    interface: chrome.runtime message types ANALYZE, REFINE, TRAIN_VOICE, REGENERATE_FINGERPRINT
  - system: Anthropic direct browser API
    interface: service-worker.js fetch to /v1/messages
  - system: MCP analyzer
    interface: ToneAnalyzer.analyze
  - system: Sync
    interface: SyncManager data types and client-specific storage adapters
concerns:
  - Prompt/schema drift across four clients is the largest maintenance risk.
  - Model IDs and response formats must be centralized before adding modes.
  - Privacy-safe telemetry requires local-first aggregation and no raw message capture.
confidence: verified
quality_gate:
  passed: true
  scores:
    objective_clarity: pass
    service_scope: pass
    testability: pass
    completeness: pass
```

---

## $requirements

### User Stories

| ID | Role | Want | Benefit |
|---|---|---|---|
| US-1 | User | See exactly which phrases triggered a warning and why | Trust the recommendation instead of seeing a black-box rewrite |
| US-2 | User | Choose the rewrite intent, such as warm, direct, concise, de-escalating, or boundary-setting | Get a rewrite that matches the moment |
| US-3 | User | Control how strongly ToneGuard preserves my voice | Avoid generic assistant-sounding rewrites |
| US-4 | User | Retry, send anyway, or copy diagnostics when analysis fails | Stay in control when APIs, parsing, or service workers fail |
| US-5 | User | Get different interaction density on Slack, Gmail, LinkedIn, PWA, and Android | Fit each writing surface without friction |
| US-6 | Maintainer | Update prompts, model IDs, and response schemas in one source of truth | Prevent extension/MCP/PWA/Android drift |
| US-7 | Maintainer | Run golden fixture tests for safe/pass/problematic examples across clients | Catch prompt and parser regressions before shipping |
| US-8 | Maintainer | Inspect privacy-safe success, failure, latency, routing, and acceptance metrics | Improve quality with evidence |
| US-9 | User | Get fast checks for low-risk messages and deeper analysis only when needed | Reduce latency and API cost |

### Acceptance Criteria

| ID | When | If | Then |
|---|---|---|---|
| AC-1 | A message is flagged | The model returns quote-level issues | The overlay shows issue chips with phrase, category, and one-sentence explanation. |
| AC-2 | A message is flagged | The issue quote is missing or invalid | The UI falls back to category-level explanation without breaking the drawer. |
| AC-3 | The user opens ToneGuard settings | Intent modes are enabled | They can set a default mode and optionally choose mode per check. |
| AC-4 | The user chooses an intent mode | A rewrite is generated | The prompt includes the selected intent and the response records the mode used. |
| AC-5 | The user changes voice preservation | The rewrite is generated | The analyzer receives a voice strength value and applies it consistently. |
| AC-6 | Analysis fails | The API, network, parser, or service worker context caused the failure | The user sees Retry, Send as-is, and Copy diagnostics actions. |
| AC-7 | The same fixture is analyzed by Chrome prompt and MCP prompt | Both code paths parse successfully | Both return schema-valid results with allowed category/mode values. |
| AC-8 | A low-risk message is checked | Deterministic pre-check says it is clearly safe | ToneGuard may pass locally or use the cheapest configured route. |
| AC-9 | A high-risk message is checked | Deterministic pre-check finds conflict markers or user-selected high-stakes mode | ToneGuard escalates to the deeper multi-model route. |
| AC-10 | Telemetry is recorded | Any event contains message text, API key, email, phone, URL query, or raw recipient name | The event is rejected by tests. |
| AC-11 | Chrome, MCP, PWA, or Android model contracts change | Shared prompt/schema artifacts are regenerated | Tests fail if generated code is stale. |

### Scope In

- Shared analysis response schema.
- Shared issue/category/mode vocabulary.
- Prompt source-of-truth and generated client constants.
- Fixture corpus and cross-path test runner.
- Intent modes and voice preservation controls.
- Deterministic local pre-check/routing module.
- Failure UI enhancements.
- Privacy-safe telemetry events and local summaries.
- Site profiles for Slack, Gmail, LinkedIn, TurboTenant, generic, PWA, and Android.

### Scope Out

- Building a hosted analysis proxy.
- Capturing raw user messages for analytics.
- Replacing the existing sync protocol.
- Adding new paid subscriptions or billing.
- Rebuilding the overlay UI framework.
- Removing the direct Anthropic browser path.
- New Chrome Web Store publishing workflow.

### Edge Cases

| Case | Resolution |
|---|---|
| Model returns a quote that does not appear in the original | Render it as a category explanation and mark quote confidence low. |
| Intent mode conflicts with strictness | Intent controls rewrite style; strictness controls whether to flag. Keep them separate. |
| User chooses "direct" but message is emotionally loaded | Preserve directness while still removing attack language. |
| Voice preservation makes a rewrite less clear | Clarity wins for flagged clarity problems; show voice_fidelity as lower rather than keep unclear phrasing. |
| Telemetry write fails | Drop the event locally and never block analysis or send. |
| Routing decides "local pass" but message contains dangerous phrases | Deterministic red-flag list must override local pass. |
| Generated prompt constants are stale | Build/test gate fails and instructs to rerun the generator. |

### Nonfunctional Requirements

| Type | Constraint |
|---|---|
| Privacy | No telemetry event may contain raw message content, API keys, raw recipients, full URLs, or prompts. |
| Performance | Common clean messages should not become slower than the current Chrome path. |
| Cost | Smart routing should reduce average cost per analysis relative to always-running deep analysis. |
| Compatibility | Existing `flagged`, `confidence`, `mode`, `readability`, `red_flags`, `categories`, `reasoning`, `suggestion`, `has_questions`, and `questions` fields must remain backward compatible. |
| Maintainability | Shared prompt/schema generation must be deterministic and tested. |

---

## Architecture Options

### Option A: Shared Artifacts, Direct Client Calls

Keep every client calling models directly, but centralize the shared contracts:

- `shared/analysis/schema.json`
- `shared/analysis/modes.json`
- `shared/analysis/categories.json`
- `shared/prompts/base.md`
- `shared/prompts/landing.md`
- `shared/routing/precheck-rules.json`
- Generator scripts emit:
  - `prompts/base.txt`
  - `toneguard-mcp/critics/*.md`
  - `service-worker.js` prompt constants or generated imported files
  - Android string/raw resources
  - PWA prompt constants

**Pros:** Preserves current privacy model and client autonomy. Lowest infrastructure risk.

**Cons:** Generation and client-specific parsing still need discipline.

### Option B: Local MCP as Canonical Analyzer

Make MCP the canonical analyzer and have extension/PWA/Android call it when available.

**Pros:** One runtime path, richer multi-model orchestration, easier tests.

**Cons:** Breaks the core extension value for users who do not run MCP locally. Android/PWA become harder.

### Option C: Hosted ToneGuard API

Move analysis behind a hosted API.

**Pros:** One backend path, central telemetry, best routing control.

**Cons:** Changes privacy story, adds infra/security/compliance burden, requires key custody decisions.

### Chosen Direction

**Option A.** ToneGuard's product identity is privacy-first, user-key, local client behavior. The right move is shared artifacts and generated constants, not a hosted proxy or MCP-only architecture.

---

## $plan

### Phase 1: Shared Contracts And Prompt Source Of Truth

```yaml
steps:
  - id: 1
    description: Add shared analysis schema, mode taxonomy, category taxonomy, and prompt source files.
    files:
      - shared/analysis/schema.json
      - shared/analysis/modes.json
      - shared/analysis/categories.json
      - shared/prompts/base.md
      - shared/prompts/landing.md
      - shared/routing/precheck-rules.json
    type: shared_prerequisite
    depends_on: []
    test_requirements: Schema lint plus fixture validation against schema.
    status: pending
  - id: 2
    description: Add deterministic prompt/artifact generator for Chrome, MCP, PWA, and Android.
    files:
      - scripts/generate_shared_artifacts.mjs
      - prompts/base.txt
      - toneguard-mcp/critics/landing.md
      - android/app/src/main/res/raw/toneguard_base_prompt.txt
      - pwa/generated-prompts.js
      - service-worker.js
    type: shared_prerequisite
    depends_on:
      - step: 1
        type: build
    test_requirements: Test fails when generated files differ from shared source.
    status: pending
```

Implementation notes:

- Prefer generated files over runtime imports where Chrome MV3 or Android packaging makes imports awkward.
- Keep `service-worker.js` readable. If generated constants get large, generate `generated-prompts.js` and add it to `importScripts`.
- Add a header to generated files: `Generated from shared/. Do not edit directly.`
- Model IDs should be centralized with prompts if they remain client-specific constants.

Verification:

```bash
npm test
cd toneguard-mcp && source $HOME/.local/bin/env && uv run --extra dev pytest tests/ -v
```

---

### Phase 2: Golden Fixtures And Cross-Path Contract Tests

```yaml
steps:
  - id: 3
    description: Create fixture corpus covering safe, tone, clarity, professionalism, high-stakes, passive-aggressive, hedging, and parse-edge cases.
    files:
      - tests/fixtures/analysis-corpus.json
      - toneguard-mcp/tests/fixtures/analysis-corpus.json
    type: value_unit
    depends_on:
      - step: 1
        type: data
    test_requirements: Fixtures validate against shared input/output expectation schema.
    status: pending
  - id: 4
    description: Add JS contract tests for parser, deterministic pre-check expectations, and generated prompt freshness.
    files:
      - tests/analysis-contract.test.js
      - tests/lib.test.js
      - tests/syntax.test.js
    type: value_unit
    depends_on:
      - step: 2
        type: build
      - step: 3
        type: data
    test_requirements: npm test passes.
    status: pending
  - id: 5
    description: Add MCP contract tests using mocked model responses and schema validation.
    files:
      - toneguard-mcp/tests/test_analysis_contract.py
      - toneguard-mcp/tests/test_analyzer.py
    type: value_unit
    depends_on:
      - step: 2
        type: build
      - step: 3
        type: data
    test_requirements: uv pytest passes without live API keys.
    status: pending
```

Fixture categories:

- `safe_short_ack`: "sounds good", "thanks", "got it".
- `passive_aggressive`: "per my last email", "as I already said".
- `defensive`: "I don't know why this is so hard".
- `unclear_ask`: "Can you handle the thing from earlier?"
- `hedged`: "I just maybe wanted to see if perhaps..."
- `high_stakes_conflict`: firm but emotionally loaded.
- `boundary_setting`: clear no with relationship preservation.
- `parse_edge`: multiline JSON, quotes, markdown fence, escaped control chars.
- `non_issue_casual`: friendly chat that should not be over-polished.

---

### Phase 3: Deterministic Pre-Checks And Smart Routing

```yaml
steps:
  - id: 6
    description: Add shared deterministic pre-check engine for obvious pass, local warning hints, and escalation signals.
    files:
      - lib.js
      - tests/lib.test.js
      - shared/routing/precheck-rules.json
    type: value_unit
    depends_on:
      - step: 1
        type: data
      - step: 3
        type: data
    test_requirements: Unit tests for local pass, must-call-model, and must-escalate paths.
    status: pending
  - id: 7
    description: Wire routing into Chrome extension analysis without changing user-visible behavior yet.
    files:
      - service-worker.js
      - tests/analysis-contract.test.js
    type: value_unit
    depends_on:
      - step: 6
        type: build
    test_requirements: Mocked tests prove routing metadata is attached and API calls are skipped only for safe allowlist cases.
    status: pending
  - id: 8
    description: Add equivalent routing hooks to MCP, PWA, and Android.
    files:
      - toneguard-mcp/analyzer.py
      - toneguard-mcp/tests/test_analyzer.py
      - pwa/app.js
      - android/app/src/main/java/com/toneguard/ClaudeApiClient.kt
      - android/app/src/test/java/com/toneguard/PrecheckTest.kt
    type: value_unit
    depends_on:
      - step: 6
        type: build
    test_requirements: Client tests prove the same fixture routing decisions.
    status: pending
```

Routing policy:

| Route | Trigger | Behavior |
|---|---|---|
| `local_pass` | Short safe acknowledgments and greetings | No API call; save voice sample only if long enough and user settings allow. |
| `standard` | Normal message | Current Haiku prompt path in Chrome/PWA/Android or MCP standard path. |
| `deep` | High-stakes mode, conflict phrases, repeated red flags, low confidence prior parse | MCP multi-model path where available; otherwise stronger prompt and no silent pass. |
| `blocked_error` | Parser/API/network failure | Show recoverable failure UI. Never silently mark as safe. |

Deterministic rules should be conservative. They can save work for obvious safe messages and flag escalation signals, but they must not attempt full rewriting locally.

---

### Phase 4: Explainable Feedback Response And UI

```yaml
steps:
  - id: 9
    description: Extend response schema with structured issues while keeping legacy fields.
    files:
      - shared/analysis/schema.json
      - prompts/base.txt
      - toneguard-mcp/analyzer.py
      - toneguard-mcp/tests/test_analysis_contract.py
      - tests/analysis-contract.test.js
    type: value_unit
    depends_on:
      - step: 2
        type: build
    test_requirements: Schema accepts old and new response shapes.
    status: pending
  - id: 10
    description: Render structured issue explanations in the overlay and PWA.
    files:
      - overlay-frame.html
      - overlay-frame.js
      - overlay-frame.css
      - pwa/index.html
      - pwa/app.js
      - tests/syntax.test.js
    type: value_unit
    depends_on:
      - step: 9
        type: data
    test_requirements: DOM tests or smoke tests verify textContent rendering and no innerHTML.
    status: pending
```

New response fields:

```json
{
  "issues": [
    {
      "quote": "as I already said",
      "category": "defensive",
      "severity": "medium",
      "explanation": "This can read like frustration with the recipient.",
      "suggested_fix": "State the missing context without implying blame.",
      "quote_confidence": "exact"
    }
  ],
  "routing": {
    "route": "standard",
    "precheck_hits": ["phrase:defensive"],
    "model": "claude-haiku-4-5-20251001"
  }
}
```

UI design:

- Keep the top drawer compact.
- Show 1-3 issue cards max; collapse extra issues behind "Show more".
- Each issue card displays: quote, category, explanation.
- Use `textContent` only for model output.
- Preserve existing `red_flags` chips for backward compatibility.

---

### Phase 5: Intent Modes

```yaml
steps:
  - id: 11
    description: Add intent mode taxonomy and prompt instructions.
    files:
      - shared/analysis/modes.json
      - shared/prompts/base.md
      - prompts/base.txt
      - toneguard-mcp/critics/claude-tone.md
      - toneguard-mcp/critics/gpt-tone.md
      - tests/fixtures/analysis-corpus.json
    type: value_unit
    depends_on:
      - step: 2
        type: build
    test_requirements: Golden fixtures verify mode names and output schema.
    status: pending
  - id: 12
    description: Add settings and per-check UI for selected intent mode.
    files:
      - popup.html
      - popup.js
      - overlay-frame.html
      - overlay-frame.js
      - overlay-frame.css
      - service-worker.js
      - tests/syntax.test.js
    type: value_unit
    depends_on:
      - step: 11
        type: data
    test_requirements: Unit/smoke tests verify selected mode is included in ANALYZE requests.
    status: pending
  - id: 13
    description: Add PWA and Android mode support.
    files:
      - pwa/index.html
      - pwa/app.js
      - android/app/src/main/res/layout/activity_main.xml
      - android/app/src/main/java/com/toneguard/MainActivity.kt
      - android/app/src/main/java/com/toneguard/ClaudeApiClient.kt
    type: value_unit
    depends_on:
      - step: 11
        type: data
    test_requirements: Android unit tests and JS syntax tests pass.
    status: pending
```

Initial modes:

| Mode | Use |
|---|---|
| `professional` | Default polished workplace tone. |
| `warm` | Friendlier and more relational. |
| `direct` | Shorter, clearer, less softened. |
| `deescalating` | Conflict lowering without avoidance. |
| `boundary` | Firm no, explicit limits, respectful framing. |
| `concise` | Preserve meaning with minimum words. |

Storage:

- `tg_intent_mode_default`: default mode.
- `tg_intent_mode_last`: last per-check override if "remember" is enabled.
- Per-site overrides can be added later using the same map style as strictness.

Prompt rule:

- Intent mode affects rewrite style only.
- It must not suppress true tone/clarity warnings.

---

### Phase 6: Voice Preservation Controls

```yaml
steps:
  - id: 14
    description: Add voice preservation strength settings and prompt controls.
    files:
      - popup.html
      - popup.js
      - options.html
      - options.js
      - service-worker.js
      - toneguard-mcp/analyzer.py
      - toneguard-mcp/tests/test_analyzer.py
    type: value_unit
    depends_on:
      - step: 2
        type: build
      - step: 11
        type: data
    test_requirements: Tests verify strength values are normalized and included in prompt context.
    status: pending
```

Controls:

| Setting | Meaning |
|---|---|
| `preserve` | Keep my words and rhythm unless a phrase is the problem. |
| `balanced` | Default. Preserve style but prioritize clarity. |
| `polish` | More editorial, more willing to restructure. |
| `rewrite` | Highest intervention. Best for rough drafts. |

Response metadata:

```json
{
  "voice": {
    "strength": "balanced",
    "source": "fingerprint",
    "voice_fidelity": 0.88
  }
}
```

Implementation notes:

- Do not duplicate fingerprint generation.
- Make this a thin control layer over the current voice sample/fingerprint system.
- If no voice samples exist, show the control disabled or explain in settings, not in the overlay.

---

### Phase 7: Failure Handling And Diagnostics

```yaml
steps:
  - id: 15
    description: Normalize analysis errors into typed failure objects.
    files:
      - lib.js
      - service-worker.js
      - pwa/app.js
      - android/app/src/main/java/com/toneguard/ClaudeApiClient.kt
      - tests/lib.test.js
    type: value_unit
    depends_on:
      - step: 1
        type: data
    test_requirements: Parser/API/network/auth/context failures map to user-safe messages.
    status: pending
  - id: 16
    description: Add retry, send-as-is, and copy diagnostics to extension and PWA UI.
    files:
      - overlay-frame.html
      - overlay-frame.js
      - overlay-frame.css
      - pwa/index.html
      - pwa/app.js
    type: value_unit
    depends_on:
      - step: 15
        type: data
    test_requirements: Manual smoke tests and syntax tests.
    status: pending
```

Failure object:

```json
{
  "flagged": false,
  "error": {
    "type": "parse_error",
    "message": "ToneGuard could not read the model response.",
    "retryable": true,
    "safe_to_send": "user_decides",
    "diagnostic_code": "TG_PARSE_001"
  }
}
```

Actions:

- **Retry:** re-run the same analysis with the same text and context.
- **Send as-is:** explicit user action, logged as `sent_original_after_error`.
- **Copy diagnostics:** copies non-sensitive diagnostic bundle:
  - extension version
  - diagnostic code
  - site/platform
  - route
  - model ID
  - response status if available
  - parse phase
  - no raw message content

---

### Phase 8: Site Profiles

```yaml
steps:
  - id: 17
    description: Add site profile config and platform-aware prompt/UI behavior.
    files:
      - shared/analysis/site-profiles.json
      - lib.js
      - service-worker.js
      - overlay-frame.js
      - pwa/app.js
      - tests/lib.test.js
    type: value_unit
    depends_on:
      - step: 5
        type: data
      - step: 11
        type: data
    test_requirements: Fixture tests verify site profile is selected and included in analysis context.
    status: pending
```

Initial profiles:

| Platform | Behavior |
|---|---|
| Slack | Compact, faster, fewer issue cards, concise rewrites, numbered lists when useful. |
| Gmail | More complete reasoning, stronger professionalism checks, email formatting. |
| LinkedIn | More formal, avoid overfamiliar phrasing, shorter public-facing rewrite. |
| TurboTenant | Clear landlord/tenant communication, professional and specific. |
| Generic | Balanced default. |
| PWA | Copy-first UI, no auto-send assumptions. |
| Android | Overlay-friendly short explanations and copy/apply actions. |

This phase should not add new supported sites. It should make existing detection smarter.

---

### Phase 9: Privacy-Safe Telemetry

```yaml
steps:
  - id: 18
    description: Add local telemetry event schema and sanitizer.
    files:
      - shared/telemetry/schema.json
      - lib.js
      - tests/telemetry.test.js
    type: shared_prerequisite
    depends_on:
      - step: 1
        type: data
    test_requirements: Tests reject raw message-like, URL-like, email-like, phone-like, and API-key-like values.
    status: pending
  - id: 19
    description: Record local telemetry summaries in Chrome/PWA/Android and MCP without raw content.
    files:
      - service-worker.js
      - options.js
      - pwa/app.js
      - android/app/src/main/java/com/toneguard/LearningStore.kt
      - toneguard-mcp/learning_store.py
      - toneguard-mcp/tests/test_learning.py
    type: value_unit
    depends_on:
      - step: 18
        type: build
    test_requirements: Tests verify event aggregation and sanitizer.
    status: pending
```

Events:

- `analysis_started`
- `analysis_completed`
- `analysis_failed`
- `route_selected`
- `rewrite_accepted`
- `rewrite_edited`
- `send_as_is`
- `retry_clicked`
- `mode_changed`
- `voice_strength_changed`

Allowed fields:

- timestamp
- platform
- site profile
- route
- model ID
- latency bucket
- token estimate bucket
- failure diagnostic code
- issue categories
- accepted/dismissed outcome

Disallowed fields:

- raw message
- raw suggestion
- prompt text
- API key
- recipient names
- emails
- phone numbers
- full URLs

Telemetry should start local-only. Syncing summaries can be considered later after privacy review.

---

### Phase 10: Cross-Client Parity And Documentation

```yaml
steps:
  - id: 20
    description: Add parity matrix and update docs for new modes, routing, failures, and shared generation.
    files:
      - README.md
      - CHANGELOG.md
      - docs/analysis-contract.md
      - docs/client-parity.md
      - STORE_DESCRIPTION.md
    type: value_unit
    depends_on:
      - step: 19
        type: build
    test_requirements: Docs reviewed against implemented behavior.
    status: pending
```

Docs should explicitly state:

- Which clients support each mode/control.
- How to regenerate shared artifacts.
- What telemetry stores and does not store.
- How smart routing works at a high level.
- How to add a new issue category or intent mode.

---

## Suggested Implementation Order

1. **Phase 1:** Shared contracts and generated artifacts.
2. **Phase 2:** Golden fixtures.
3. **Phase 3:** Deterministic pre-checks and routing.
4. **Phase 4:** Explainable issue UI.
5. **Phase 5:** Intent modes.
6. **Phase 6:** Voice preservation controls.
7. **Phase 7:** Failure handling and diagnostics.
8. **Phase 8:** Site profiles.
9. **Phase 9:** Telemetry.
10. **Phase 10:** Docs and parity matrix.

Reasoning:

- Prompt/schema unification must come first. Otherwise every product improvement multiplies drift.
- Fixtures should land before behavior changes so quality can be measured.
- Routing should land before telemetry so telemetry can record route choices from day one.
- Intent and voice controls are user-facing and depend on shared prompt/schema work.
- Failure handling can be implemented independently, but benefits from typed schema first.
- Site profiles compose cleanly after modes/routing exist.

---

## Test Strategy

### JavaScript / Extension

```bash
npm test
```

Add coverage for:

- `parseApiResponse` compatibility with new fields.
- `runPrecheck` routing decisions.
- telemetry sanitizer.
- generated prompt freshness.
- site profile selection.
- response schema validation.

### MCP Server

```bash
cd toneguard-mcp
source $HOME/.local/bin/env
uv run --extra dev pytest tests/ -v
```

Add coverage for:

- schema-valid analyzer output.
- mocked critic/synthesizer responses.
- issue quote normalization.
- intent mode prompt inclusion.
- voice strength prompt inclusion.
- landing critic still isolated from main failures.
- telemetry sanitizer.

### Android

```bash
cd android
./gradlew test
```

Add coverage for:

- response parser accepts new fields.
- failure object mapping.
- pre-check routing fixture subset.

### Manual Smoke Tests

Chrome extension:

1. Reload extension after bumping `manifest.json`.
2. Gmail: flagged message shows issue explanations, landing panel, mode used.
3. Slack: concise profile uses compact issue UI.
4. Parse failure diagnostic build: model response parse failure shows Retry, Send as-is, Copy diagnostics.
5. Voice setting changes rewrite style without breaking send/apply.

PWA:

1. Paste/share text.
2. Select intent mode.
3. Copy rewrite.
4. Verify failure UI.

Android:

1. Analyze selected text.
2. Confirm parser handles new response fields.
3. Confirm typed error displays safely.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Shared generation makes simple prompt edits slower | Medium | Keep source files readable, generated files obvious, and generator command fast. |
| Intent modes cause inconsistent flagging | High | Separate flagging strictness from rewrite intent in prompt and tests. |
| Local pre-check lets bad messages pass | High | Only local-pass tight allowlists; red-flag patterns always escalate. |
| Telemetry violates privacy promise | Critical | Sanitizer tests, allowlist schema, no raw content fields, local-only v1. |
| Cross-client parity takes too long | Medium | Land Chrome + MCP first, then PWA/Android parity in separate commits. |
| UI drawer becomes crowded | Medium | Progressive disclosure: compact issue cards, collapse extra detail. |
| Generated Android resources are awkward | Low | If needed, keep Android prompt as raw text resource and load it in client. |

---

## Milestones

### Milestone 1: Foundation

Deliver phases 1-2.

Outcome:

- Shared prompt/schema source exists.
- Golden corpus exists.
- Drift is detectable.

### Milestone 2: Better Decisions

Deliver phases 3-4.

Outcome:

- ToneGuard knows when to skip, standard check, or escalate.
- Users see why a message was flagged.

### Milestone 3: User Control

Deliver phases 5-6.

Outcome:

- Users can choose intent and voice preservation strength.

### Milestone 4: Trust And Observability

Deliver phases 7-9.

Outcome:

- Failures are recoverable.
- Local metrics show where quality/cost issues are.

### Milestone 5: Parity And Ship

Deliver phase 10.

Outcome:

- Docs match behavior.
- Chrome, MCP, PWA, and Android parity gaps are explicit.

---

## Ship Gates

Before merging:

- `npm test` passes.
- `toneguard-mcp` pytest passes.
- Android unit tests pass if Android files changed.
- Generated prompt/schema freshness test passes.
- Manual Chrome extension smoke test passes.
- `manifest.json` version is bumped for any service-worker behavior change.
- No raw message content is present in telemetry snapshots.
- `rg "innerHTML" overlay-frame.js options.js pwa/app.js` returns no new unsafe model-output rendering.

Before deployment/publishing:

- Re-read `AGENTS.md` gotchas.
- Reload extension in Chrome and confirm service-worker version.
- Run live integration tests only if API keys are available:

```bash
cd toneguard-mcp
set -a && source .env && set +a
uv run --extra dev pytest tests/test_live_integration.py -v -s
```

---

## Next Step

When ready to implement, invoke Codex-flow against this plan and start with Phase 1. Treat each milestone as a mergeable slice, not one giant release.
