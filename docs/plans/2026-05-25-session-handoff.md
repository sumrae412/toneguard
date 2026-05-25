# Session handoff — 2026-05-25

Direction 4 ("free + easy to install") closed. Three follow-ups remain, all user-driven.

## Goal for next session

Pick up whichever follow-up the user names: (1) CWS submission (A6), (2) phone install test, or (3) Railway auto-deploy investigation. None require active Claude work until the user surfaces a specific blocker.

## What shipped this session

| Commit / PR | What |
|---|---|
| [`9ccbe3b`](https://github.com/sumrae412/toneguard/commit/9ccbe3b) | PR #36 — Mermaid diagrams inline in PRD (merged at session start) |
| [`4a32bc2`](https://github.com/sumrae412/toneguard/commit/4a32bc2) | Direction-4 design doc — `docs/plans/2026-05-24-free-easy-install-design.md` |
| [`31944dd`](https://github.com/sumrae412/toneguard/commit/31944dd) | Implementation plan — `docs/plans/2026-05-24-free-easy-install-plan.md` |
| [`2a761d2`](https://github.com/sumrae412/toneguard/commit/2a761d2) | Gitignore `.claude/worktrees/` |
| [`7241845`](https://github.com/sumrae412/toneguard/commit/7241845) | Vitest exclude — honest 155-baseline restored |
| [`9f87f49`](https://github.com/sumrae412/toneguard/commit/9f87f49) | CLAUDE.md + AGENTS.md — session gotchas (PWA install criteria, hosting probe, Express 4/ESM, vitest exclude) |
| [`dc475ee`](https://github.com/sumrae412/toneguard/commit/dc475ee) | **PR #43** — PWA install fix v1 (Branch B postinstall — *failed in production due to Railway Root Directory exclusion*) |
| [`fcc6dc5`](https://github.com/sumrae412/toneguard/commit/fcc6dc5) | **PR #44** — `git mv pwa sync-server/pwa` (the fix that actually made production serve) |
| [`48f89b7`](https://github.com/sumrae412/toneguard/commit/48f89b7) | **PR #45** — CWS submission readiness (turbotenant scrub + v0.4.0 + BYOK copy + store description polish) |

Plus 1 commit in `~/.claude` repo (global CLAUDE.md Railway Root Directory gotcha) and 3 local-only project-memory entries (`gotcha_pwa_install_requirements`, `pattern_probe_before_trusting_hosting_claim`, `pattern_user_simplification_mid_brainstorm_rescope`).

## Current state

- **Production PWA**: live at https://sync-server-production-3a24.up.railway.app/ — last verified 10/10 routes return 200 (`/`, `/manifest.json`, `/sw.js`, `/app.js`, all 5 icons, `/healthz`).
- **Chrome extension**: manifest at `v0.4.0`, host_permissions scrubbed of personal SaaS. CWS-ready but not yet submitted.
- **Tree**: clean on `main` at `48f89b7`. Three stale worktrees from parallel sessions exist under `.claude/worktrees/` (`brave-margulis-bc76a7`, `thirsty-khorana-07fad0`, `wonderful-matsumoto-a3ef09`) — orthogonal to this work, leave alone unless the user names them.
- **Open PRs**: none.
- **Pre-staged source icons** at `icons/icon{180,192,512}.png` — generated this session from `icons/icon.svg`. Already vendored into `sync-server/pwa/icons/`. They'll be committed alongside this handoff for parity with the existing root icons set.

## Three follow-ups (all user-driven, pick one)

### 1. CWS submission (A6)

The submission steps are tracked in [`STORE_DESCRIPTION.md`](../../STORE_DESCRIPTION.md) under "CWS submission checklist":

- Build zip: `npm run build` → produces `toneguard-0.4.0.zip` (reads version from `manifest.json`)
- Produce screenshots (1280×800 or 640×400 PNG) — overlay drawer in action, options page, weekly stats popup, suggestion card, intent-mode picker
- Produce promo tile (440×280 or 1400×560 PNG)
- Pay $5 dev fee at https://chrome.google.com/webstore/devconsole
- Paste content from `STORE_DESCRIPTION.md` (short desc, detailed desc, permissions justification) into the listing form
- Submit for review (typical wait: 1-3 days)
- After approval: update `README.md`'s "install from source" section with the live CWS URL — doc-only commit direct to main per repo convention

Most of this is outside-Claude work. If the user asks Claude for help, the entry point is screenshot capture via `mcp__computer-use__screenshot` or `mcp__Claude_in_Chrome__*` tools.

### 2. Phone install test

- Open https://sync-server-production-3a24.up.railway.app/ on Android Chrome → confirm "Install ToneGuard" prompt fires (192/512 icon requirement now met)
- Open same URL on iOS Safari → Share → Add to Home Screen → confirm icon renders sharp at retina resolution (the 180px apple-touch-icon)
- If the prompt does NOT fire on Android, check Chrome DevTools (chrome://inspect for connected device) for missing manifest fields or SW registration errors. Probe production headers first: `curl -sSI https://sync-server-production-3a24.up.railway.app/manifest.json`

### 3. Railway auto-deploy investigation

**Observation:** Neither PR #44 nor #45 auto-triggered a Railway redeploy on merge. Had to manually `railway up --detach` from `sync-server/` cwd both times. Possible causes:

- Railway's GitHub integration is not connected to the `toneguard-sync` project (check dashboard → Project Settings → GitHub)
- Integration is connected but watches a different branch
- Integration was disconnected when Root Directory was set to `/sync-server`

Quick investigation:
```bash
cd ~/claude_code/toneguard/sync-server
railway status              # confirm linked project
railway service             # confirm service link (already 'sync-server')
# Then Railway dashboard: Project → Service → Settings → Source → GitHub
```

Fix is dashboard-side; no code changes expected. Document the resolution in `~/.claude/CLAUDE.md` under the existing Railway section.

## Architectural invariants to preserve

Cite by name only — do not re-explain:

- **PWA install criteria** (CLAUDE.md "Key Gotchas") — 192/512 PNG icons required for Android auto-prompt; iOS has no auto-prompt.
- **Railway sync-server hosts both backbone AND PWA** at `sync-server-production-3a24.up.railway.app` (CLAUDE.md "Key Gotchas"). PWA lives at `sync-server/pwa/`. Static middleware at `sync-server/src/index.js`.
- **Dual code paths: MCP + extension** (CLAUDE.md) — any prompt/behavior change updates both `toneguard-mcp/critics/*.md` and `service-worker.js` inline constants.
- **Canonical taxonomies live in `shared/analysis/*.json`** — parity scanner enforces.
- **`docs/client-parity.md` is a generated build artifact** — don't hand-edit.
- **AGENTS.md ⇔ CLAUDE.md mirror convention** — `cp CLAUDE.md AGENTS.md` in same commit on any CLAUDE.md edit.
- **Vitest excludes `.claude/worktrees/`** (CLAUDE.md) — don't remove; restores honest 155-test baseline.
- **Service-worker setup must be idempotent** — `contextMenus.create` needs `removeAll` + in-flight guard + lastError callback.

## Pre-flight commands for next session

```bash
cd /Users/summerrae/claude_code/toneguard
git fetch origin --prune
git log --oneline -5                  # expect 48f89b7 or newer on top
git status --short                    # expect clean (this handoff commit will be in)
env -u GH_TOKEN gh pr list --state open   # expect: no open PRs
node node_modules/.bin/vitest run     # expect 163 passed (160 baseline + 3 Stream A tests)
node scripts/parity_scan.mjs --check  # exit 0
node scripts/generate_shared_artifacts.mjs --check   # exit 0
curl -sS -o /dev/null -w "/ → %{http_code}\n" https://sync-server-production-3a24.up.railway.app/
curl -sS -o /dev/null -w "/manifest.json → %{http_code}\n" https://sync-server-production-3a24.up.railway.app/manifest.json
```

All three production probes should return 200.

## Gates before shipping any new code

- `node node_modules/.bin/vitest run` (163 baseline)
- `node scripts/parity_scan.mjs --check`
- `node scripts/generate_shared_artifacts.mjs --check`
- Manifest version bump in `manifest.json` if extension code changed (currently `0.4.0`)
- `cp CLAUDE.md AGENTS.md` if CLAUDE.md changed
- MCP changes: `cd toneguard-mcp && uv run --extra dev pytest tests/ -v`

## Ship instructions

For follow-ups that touch code: use `/ship` (PR → review → merge). For doc-only changes (handoff updates, decision records, README polish post-CWS): commit direct to `main` per repo convention (CLAUDE.md "Repo Conventions"; established pattern in [`ffe3bfd`](https://github.com/sumrae412/toneguard/commit/ffe3bfd), [`475514e`](https://github.com/sumrae412/toneguard/commit/475514e), [`9f87f49`](https://github.com/sumrae412/toneguard/commit/9f87f49)).

## Mode directive

Auto mode. Surface premise contradictions only.
