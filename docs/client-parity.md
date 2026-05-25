<!-- Generated from shared/analysis/*.json + scripts/parity_manifest.json by scripts/parity_scan.mjs. Do not edit directly. -->

# ToneGuard Client Parity

Each row is a capability or canonical taxonomy. Each column is a client surface. Generated from `shared/analysis/*.json` + `scripts/parity_manifest.json` by `scripts/parity_scan.mjs`. Run `node scripts/parity_scan.mjs` to regenerate; `node scripts/parity_scan.mjs --check` is wired into CI.

## Canonical taxonomy match (per client)

| Taxonomy | Chrome | MCP | PWA | Android |
|---|---|---|---|---|
| `intent_modes` | ✅ canonical | passthrough | ✅ canonical | ✅ canonical |
| `voice_strengths` | ✅ canonical | ✅ canonical | ✅ canonical | ✅ canonical |

## Feature presence

| Capability | Chrome | MCP | PWA | Android |
|---|---|---|---|---|
| Intent mode UI | ✅ | ✅ | ✅ | ✅ |
| Voice strength UI | ✅ | ✅ | ✅ | ✅ |
| Site profiles | ✅ | — | ✅ | — |
| Local telemetry | ✅ | — | ✅ | — |
| Structured issue cards | ✅ | ✅ | — | ✅ |
| Retry + copy diagnostics | ✅ | — | ✅ | ✅ |

## Canonical taxonomy values

- `intent_modes`: `professional`, `warm`, `direct`, `deescalating`, `boundary`, `concise`
- `voice_strengths`: `preserve`, `balanced`, `polish`, `rewrite`
- `response_modes`: `(empty)`, `tone`, `polish`, `both`
- `categories`: `adverbs`, `passive voice`, `wordy`, `hedging`, `hard to read`, `tone`, `grammar`, `clarity`, `inclusive language`, `professionalism`, `structure`, `audience`

## Drift policy

Any `⚠️ drift` cell fails CI via `node scripts/parity_scan.mjs --check`. MCP intent modes are `passthrough` — the server forwards them to the LLM rather than enumerating locally, so drift is not measurable. Voice strength canonical lives at [`shared/analysis/voice-strengths.json`](../shared/analysis/voice-strengths.json); intent modes and response modes live at [`shared/analysis/modes.json`](../shared/analysis/modes.json); categories at [`shared/analysis/categories.json`](../shared/analysis/categories.json).

