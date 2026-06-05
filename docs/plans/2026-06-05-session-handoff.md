# Session Handoff — 2026-06-05

## Goal

Pick one of three user-driven follow-ups (CWS submission, phone install test, or finishing the `~/.claude` config-repo PR), then ship it. All multi-session code work in ToneGuard is closed.

## Current state

### Shipped this session

**Token-efficiency sweep** (started earlier, closed by 2026-05-30):
- [PR #52](https://github.com/sumrae412/toneguard/pull/52) — cache stable system prompt + log token usage. Set up `cache_control: ephemeral` on `basePrompt` block, `usage.cache_read_input_tokens` logged to telemetry.
- [PR #53](https://github.com/sumrae412/toneguard/pull/53) — cap learned-decision fields (200 char) + custom rules (2000 char).
- `78eb514` — doc-only: trim dated CLAUDE.md validations.

**Phase 5 virtual-brain sweep** (this session, 2026-06-05):
- [PR #56](https://github.com/sumrae412/toneguard/pull/56) — pattern extractor over `tg_decisions[]` → `tg_patterns[]`.
- [PR #57](https://github.com/sumrae412/toneguard/pull/57) — `memory.md` export surface + Download button in options.
- [PR #58](https://github.com/sumrae412/toneguard/pull/58) — inject top-N patterns into VOLATILE system suffix.
- [PR #59](https://github.com/sumrae412/toneguard/pull/59) — distill `writing-voice/references/voice_profile.md` → `prompts/voice-principles.txt`, fold into CACHED basePrompt. Manifest bump 0.4.7 → 0.4.8.
- [PR #60](https://github.com/sumrae412/toneguard/pull/60) — purpose-built memory graph view (hubs / recipients / categories / affinity / orphans) appended to `memory.md`.

**Empirical cache verification** (closing receipt):
- One-off `/tmp/verify-toneguard-cache.mjs` ran 2 identical Anthropic API calls with the production system payload shape.
- Result: **6121 → 6121 token cache hit. PASS.** ~12.5× cost reduction on cached portion.
- `d432f53` — doc-only commit recorded the result in `docs/plans/2026-05-30-virtual-brain.md` naming the 4 surfaces that warrant re-verify if changed.

**Session-learnings persistence** (8 proposals applied):
- `20c35ed` — doc-only in toneguard: CLAUDE.md + AGENTS.md mirror gotchas (cache-prefix-vs-volatile-suffix routing, `web_accessible_resources` for new prompt files).
- `~/claude_code/agent-vault/agent/anthropic-prompt-caching.md` — NEW vault entry covering empirical-verify pattern + distillation pattern + cache-minimum routing. Committed `555be9c` to branch `docs/charley-rename-learnings`, **pushed but not on master**.
- `~/.claude/CLAUDE.md` Guardrail 5 corollary (composite asks with 3+ ambiguous nouns) — committed `979c6f5` to branch `docs/2026-06-02-session-learnings-corollaries`, pushed, **no PR opened yet**.
- Project memory (`~/.claude/projects/-Users-summerrae-claude-code-toneguard/memory/`): 2 NEW files (`gotcha_cache_reverify_surfaces.md`, `pattern_derived_state_not_synced.md`) + MEMORY.md index update + append to `pattern_phased_commits_green_between.md`. Local-only per the gitignore policy.

### In-flight (left for user, NOT shipped)

- **`~/.claude` working tree has prior-session uncommitted work** on branch `docs/2026-06-02-session-learnings-corollaries`:
  - Guardrail 10 (Anti-shallow defaults on substantive questions) — full ~30-line section ready to commit, authored 2026-06-03.
  - Project memory edits to `MEMORY.md`, `pattern_instrument_and_handoff_for_unrepro_bugs.md`, `pattern_phased_commits_green_between.md`.
  - Branch has 3 committed corollaries (Guardrails 9, 2-Corollary-2, 5) ahead of `origin/master`.
- **`agent-vault` is on branch `docs/charley-rename-learnings`**, not master. My commit landed there. Unverified whether that branch is intentional or a leftover.

### Untouched (since 2026-05-25 handoff)

1. **CWS submission (A6)** — outside-Claude work. Checklist in `STORE_DESCRIPTION.md`. Manifest is at 0.4.8.
2. **Phone install test** — Android + iOS PWA install verification against `https://sync-server-production-3a24.up.railway.app/`.
3. **(NEW)** Decide what to do with `~/.claude` `docs/2026-06-02-session-learnings-corollaries` branch — commit Guardrail 10 first + bundle? Open PR on the 3 current commits + ship Guardrail 10 separately?

## Exact next task

**Recommendation:** CWS submission (A6). Highest strategic value (gets ToneGuard live in the Chrome Web Store). All code prerequisites are complete and verified. The other two are either device-blocked or admin cleanup.

If you'd rather start with admin: commit Guardrail 10 to the `~/.claude` branch + open the PR. That clears the meta-repo overhang.

## Template / reference PRs

For the `~/.claude` PR (if you go that route): the recent corollary commits `fdb3047` (Guardrail 9), `dfa5b65` (Guardrail 2 Corollary 2) establish the doc-only-single-corollary commit pattern on this branch.

For CWS submission: no Claude reference — see `STORE_DESCRIPTION.md` for the checklist.

## Pre-flight commands

```bash
cd /Users/summerrae/claude_code/toneguard
git fetch origin --prune
git log --oneline -5                  # expect 20c35ed on top
git status --short                    # expect clean
env -u GH_TOKEN gh pr list --state open  # expect: none for toneguard
node node_modules/.bin/vitest run     # expect 242 passed

# For the ~/.claude branch decision:
cd ~/.claude
git -C ~/.claude branch --show-current  # expect docs/2026-06-02-session-learnings-corollaries
git -C ~/.claude status -sb             # expect Guardrail 10 + project memory unstaged
git -C ~/.claude log origin/master..HEAD --oneline  # expect 3 commits
```

## Re-verify on resume

These three premises silently drift between sessions:

- **Canonical repo path.** ToneGuard: `/Users/summerrae/claude_code/toneguard`. Validate: `git -C /Users/summerrae/claude_code/toneguard rev-parse --show-toplevel`.
- **Current branch + worktree.** This session worked from `claude/hopeful-davinci-1b8a4d` worktree but executed all writes against the main checkout. The worktree is on stale `7e87e06` (handoff doc commit); main is at `20c35ed`. If resuming via the worktree, you'll be ~6 PRs behind main on disk; either `cd` to the main checkout or `git pull` the worktree's branch from origin.
- **CR / CI wiring state.** ToneGuard CI runs `test` (vitest) + `mcp` (pytest) on every PR. No CodeRabbit. `gh pr view 60 --json reviews` returns empty — do NOT wait for review on this repo. See toneguard `CLAUDE.md` → "no review-wired-up fast path."
- **Worktree match.** `git worktree list` from toneguard repo root shows 4 worktrees including `hopeful-davinci-1b8a4d`. If you resume from a different worktree, none of this session's edits are visible there until you pull main into it.

## Architectural invariants to preserve

Cite by slug; do not re-explain:

- `pattern_phased_commits_green_between.md` — multi-phase commits with green tests between phases (extended this session with the capstone empirical-verify paragraph).
- `gotcha_cache_reverify_surfaces.md` (NEW) — the 4 surfaces (`base.txt`, `voice-principles.txt`, `loadBasePrompt`, `buildSystemPayload`, plus `tools[]`) that warrant cache re-verification if touched.
- `pattern_derived_state_not_synced.md` (NEW) — `tg_patterns` derives from synced `tg_decisions`; don't sync deterministic derivations.
- toneguard `CLAUDE.md` → "voice-principles.txt is part of the CACHED prefix; tg_patterns injection is the VOLATILE suffix" — load-bearing for any future "global rule injection" routing decision.
- toneguard `CLAUDE.md` → "New prompt files must be in `web_accessible_resources`" — silent 404 + degraded analysis if violated.
- `~/claude_code/agent-vault/agent/anthropic-prompt-caching.md` (NEW, on branch `docs/charley-rename-learnings`) — empirical verification pattern + voice profile distillation pattern.
- `~/.claude/CLAUDE.md` Guardrail 5 Corollary (composite 3+ ambiguous nouns) — committed `979c6f5`, pushed, awaiting PR. Future sessions reading the branch will see it.

## Parked artifacts

None for this session.

The temporary `/tmp/verify-toneguard-cache.mjs` was deleted after use. The verification result is captured in `docs/plans/2026-05-30-virtual-brain.md`.

## Gates

```bash
# ToneGuard (project)
cd /Users/summerrae/claude_code/toneguard && node node_modules/.bin/vitest run
# Expect: Test Files 10 passed (10), Tests 242 passed (242)

# MCP suite (local has dangling SSL_CERT_FILE env var — unset for this run)
cd /Users/summerrae/claude_code/toneguard/toneguard-mcp && env -u SSL_CERT_FILE uv run --extra dev pytest tests/ -q --tb=no
# Expect: 106 passed, 5 skipped
```

CI on PRs runs the same suites without the env var workaround. See `gotcha_pytest_env_ssl_cert.md` if it surfaces.

## Ship instructions

**For CWS submission:** outside-Claude work. Use the checklist in `STORE_DESCRIPTION.md` and the manifest at `0.4.8`.

**For `~/.claude` PR:** decide first whether to commit Guardrail 10 alongside or ship as 3-commit PR. Then `cd ~/.claude && env -u GH_TOKEN gh pr create --base master --title "..." --body "..."`. Do NOT use `/ship` — the auto-mode classifier blocks direct master push on this repo (per `~/.claude/CLAUDE.md`).

**For phone install test:** device-driven verification against production. No PR needed unless a bug is found.

## Mode directive

`Auto mode. Surface premise contradictions only.`

## Unapproved drafts in flight

### Guardrail 10 — Anti-shallow defaults (in `~/.claude/CLAUDE.md` working tree, uncommitted)

Authored 2026-06-03 by a prior session, never committed. Restored to working tree by this session after isolating the Guardrail 5 commit. **Decision needed:** commit standalone, bundle with another corollary, or revise.

Verbatim text (currently in `~/.claude/CLAUDE.md` between Guardrail 9 and the `---` divider before "Agent vault"):

```markdown
## Guardrail 10 — Anti-shallow defaults on substantive questions

Apply a baseline depth check on every substantive question, plus four triggered layers when the question's shape calls for them. Guardrail 3 (Smart Brevity) governs FORM — lead with the conclusion, no filler, one phone screen for prose. Guardrail 10 governs SUBSTANCE — don't be shallow, surface trade-offs, name what a generic answer would have missed. The two compose: a depth-focused answer still leads with the strong lead and uses bullets; it just doesn't STOP at the lead.

**Baseline (every substantive question):**

> Before answering, identify what would make a typical answer come off as shallow, generic, or incomplete. Avoid those pitfalls. Focus on depth, nuance, trade-offs, evidence, first-principles reasoning, and actionable insights. Default to the best possible answer, not the fastest one.

**Triggered layers (apply when the question's shape matches; multiple can stack):**

| Trigger | Layer to add |
|---|---|
| The question's premise shows the user already has background knowledge (technical context implied, advanced vocabulary, follow-up to a prior in-depth thread) | Identify hidden assumptions, explain the key trade-offs, challenge conventional wisdom where appropriate, surface insights most people would miss. Skip the basics. |
| The question is "how should I solve / decide / approach X" | Add a failure-mode pass: *"Why do most people fail at this? What mistakes repeatedly cause poor outcomes despite good intentions?"* Surface the failure modes BEFORE recommending the approach. |
| The topic has multiple plausible explanations, competing causes, or genuine uncertainty | Researcher mode: examine underlying causes, competing explanations, limitations, unresolved questions. Don't collapse to one explanation prematurely. |
| The topic is controversial, highly debated, or politically/ethically charged | Evidence layer: for every major claim, name the reasoning and evidence. Distinguish facts from assumptions from speculation explicitly. |

**Skip (this guardrail does NOT fire for):**
- Status checks, short acks, yes/no gating questions ("ready to merge?", "ok to proceed?")
- Mechanical edits (rename this var, fix this typo, run this command)
- Lookups with a single correct answer (file path, command syntax, API arg name)
- The question itself is trivial — don't manufacture depth where there isn't any

**How to apply:**
- Pre-answer mental check on substantive questions: *"What would a shallow version of this answer look like — and what specifically would it leave out?"* Then write the answer that includes what shallow would leave out.
- Stack layers when multiple triggers fire (e.g., a controversial decision benefits from failure-mode + evidence).
- Composes with Guardrails 1 (why/who framing) and 2 (evidence on completion claims) — Guardrail 10 is about depth on the answer body; 1 is about framing the task; 2 is about proving the work.

**Source:** depth-prompt patterns surfaced 2026-06-03 — anti-shallow baseline + four conditional layers (background-knowledge depth, failure analysis, researcher mode, evidence-based). Lives here (not in a prompting skill) because the trigger is the user's question shape, not a prompt-engineering authoring task.
```

Two reasonable reads:
1. **Commit as-is.** The text is self-contained and well-formed. Land it as a 4th commit on the same branch, then PR all 4.
2. **Revise first.** The author may have iterations queued; check chat history for the originating session if needed.

Default: option 1 (commit as-is) — the text reads clean and matches the pattern of the other 3 corollaries on this branch.

### Agent vault branch question

My vault entry `agent/anthropic-prompt-caching.md` landed on `docs/charley-rename-learnings`, not `master`. Default: open a PR or fast-forward to master. Verify the branch wasn't intentional first.
