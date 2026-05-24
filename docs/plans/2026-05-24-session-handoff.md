# Session handoff — 2026-05-24

## Goal

Pick a coherent next direction for ToneGuard. The 2026-04-27 improvement roadmap is **fully shipped** — every phase that drove the last 4 weeks of work has landed. Future "what's next?" sessions should NOT re-execute that roadmap.

## State as of this handoff

### Shipped this session

- [PR #37](https://github.com/sumrae412/toneguard/pull/37) → `e96c02c` — fix Slack display-name expansion in `lib.js:verifyInsertedText` (regression test from PR #31 was failing on clean `main`).
- (direct) → `87a42cd` — `CLAUDE.md` gotcha for the symmetric-strip requirement.
- [PR #39](https://github.com/sumrae412/toneguard/pull/39) → `e253cb3` — PWA voice-strength selector + Android voice-strength taxonomy drift fix (`light/balanced/strong` → canonical `preserve/balanced/polish/rewrite`).
- (direct) → `ffc9c3c` — `CLAUDE.md` note on recurring CodeRabbit `AGENTS.md` noise.

### Roadmap status (the big finding)

The 2026-04-27 ToneGuard improvement roadmap is at `docs/plans/2026-04-27-toneguard-improvement-roadmap.md` (still **untracked** in working tree). All 10 phases are effectively complete:

| Phase | Status | Evidence |
|---|---|---|
| 1. Shared contracts | ✅ | `shared/analysis/*.json`, `shared/prompts/*.md`, `shared/routing/precheck-rules.json`, `scripts/generate_shared_artifacts.mjs` all present |
| 2. Golden fixtures | ✅ | `tests/fixtures/analysis-corpus.json` + MCP mirror, all 9 categories covered; `analysis-contract.test.js` green |
| 3. Pre-checks + smart routing | ✅ | `lib.js:precheckAnalysis` wired into service-worker, PWA, MCP, Android |
| 4. Explainable issue UI | ✅ | `shared/analysis/schema.json:issues` array; `overlay-frame.js:425 tg-issue-card` + PWA mirror |
| 5. Intent modes | ✅ | `shared/analysis/modes.json` + 6-mode UI in every client |
| 6. Voice preservation | ✅ | Closed by PR #39 (PWA UI + Android taxonomy fix) |
| 7. Failure diagnostics | ✅ | `lib.js:ANALYSIS_ERROR_MAP` (TG_AUTH/PARSE/NET/RUNTIME), retry+copy-diagnostics UI |
| 8. Site profiles | ✅ | `shared/analysis/site-profiles.json` + `getSiteProfile` consumed in service-worker and overlay |
| 9. Telemetry | ✅ | `shared/telemetry/schema.json` + `sanitizeTelemetryEvent` + 8 recording sites |
| 10. Docs + parity matrix | ✅ | `README.md`, `CHANGELOG.md`, `docs/analysis-contract.md`, `docs/client-parity.md` |

### Untracked artifacts to triage

These have been sitting in the working tree across sessions:

- `docs/plans/2026-04-27-toneguard-improvement-roadmap.md` — now obsolete (100% shipped). Decide: track as historical archive (commit unchanged), annotate as complete and commit, or delete.
- `AGENTS.md` — **has real bugs.** Codex/Claude string drift from a bad search-replace (lines 23, 24, 35, 36, 41, 43 all say "Codex" where they should say "Claude" or "claude-"). Spawned a task chip to fix this in its own session; if the chip wasn't started, do it manually: `grep -n "Codex" AGENTS.md` should return 0 lines after the fix. The wrong model IDs would cause runtime auth failures if anything consumed `AGENTS.md` as a config source.
- `.claude/worktrees/` — 3 sibling worktrees (`claude/brave-margulis-bc76a7`, `claude/thirsty-khorana-07fad0`, `claude/wonderful-matsumoto-a3ef09`) from parallel sessions. The `worktree-cleanup` hook reports none stale, so leave alone unless you confirm otherwise.

## Exact next task

**There is no automatic next task.** The roadmap is closed. The right move for the next session is:

1. Triage the 3 untracked files (decisions above).
2. **Then frame a new direction.** Candidates worth considering:
   - **Product:** what does ToneGuard need next post-foundation? (User feedback loop? New platform? Sharper tone categories? Voice fingerprint v2?)
   - **Engineering hygiene:** the codebase has 4 client surfaces (Chrome ext, MCP server, PWA, Android) — `docs/client-parity.md` is the canonical parity matrix. Any drift detected during this session (PR #39's Android taxonomy mismatch) suggests parity-doc accuracy is a recurring failure mode worth automating against.
   - **Telemetry-driven:** Phase 9 telemetry is shipped — actually read it. `localStorage["toneguard_telemetry"]` (extension) or the MCP `learning_store.py`. What's the failure rate? What's the route distribution? What's most-flagged?
   - **Live integration:** `toneguard-mcp/tests/test_live_integration.py` requires API keys via shell-sourced `.env`. Was this run recently? Are the multi-model critics still scoring well?

Whichever direction the user picks, drive it through `/claude-flow` (new feature work) or `/bug-fix` (regression) — not through this roadmap. **Do not silently rebuild already-shipped phases.**

## Architectural invariants to preserve

Named by memory slug — do not re-explain:

- `gotcha_mcp_vs_extension_dual_code_paths.md` — prompt and fingerprint live twice (MCP critics + service-worker constants). Any change to one updates the other.
- `gotcha_parity_doc_two_axis_drift.md` — `docs/client-parity.md` claims drift on TWO axes (existence + canonical-taxonomy). Grep both before trusting.
- `pattern_audit_subagent_verify_missing_claims.md` — "X is missing" findings need inline grep verification; "X is done" findings safe to trust.
- `pattern_verify_roadmap_before_execute.md` — for any planning doc >2 weeks old, audit files-exist before /claude-flow.
- `gotcha_asymmetric_normalizer_breaks_compare.md` — symmetric text transforms must consume equivalent shapes on both sides.
- Project `CLAUDE.md` "Key Gotchas" section — multiple Chrome-ext, model-ID, and Slack-mention-regex rules.

## Pre-flight commands

```bash
cd /Users/summerrae/claude_code/toneguard
git fetch origin --prune
git status --short                      # expect: 3 untracked files (this handoff doc, AGENTS.md, roadmap doc, .claude/worktrees/)
gh pr list --state open                 # expect: empty (nothing of mine in flight)
git log --oneline -5                    # confirm ffc9c3c is on top
node node_modules/.bin/vitest run       # baseline: 475 passed, 0 failed
```

If `vitest` reds, STOP and reconcile before any new work. PR #37 fixed a regression test that was red on clean `main` — verify it's still green.

## Gates

- `node node_modules/.bin/vitest run` — JS test suite (475 tests as of this handoff)
- `cd toneguard-mcp && source $HOME/.local/bin/env && uv run --extra dev pytest tests/ -v` — MCP test suite
- Android: gradle requires JDK 17 (not installed on this machine as of 2026-05-24); skip locally and rely on per-PR review if CI absent
- Roadmap ship-gate doc: see `docs/plans/2026-04-27-toneguard-improvement-roadmap.md:959-983` for the full pre-merge checklist

## Ship instructions

For any new work: drive through `/claude-flow` (feature) or `/bug-fix` (regression). Ship via `/ship`. Do NOT use `/ship` on doc-only changes that don't touch behavior — the prior 4 commits on `main` (87a42cd, ffc9c3c, this handoff's commit) all landed via direct `git commit + push` to `main` and that pattern is fine for additive doc commits.

## Mode directive

Auto mode. Surface premise contradictions only.
