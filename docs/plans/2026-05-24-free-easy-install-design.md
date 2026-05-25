# Design — ToneGuard: free + easy to install

**Date:** 2026-05-24
**Status:** Approved, ready for implementation plan
**Supersedes:** Direction 4 framing in [`2026-05-24-session-handoff-v3.md`](2026-05-24-session-handoff-v3.md) (5-bet funnel-stage plan)

---

## Goal

Make ToneGuard installable by non-technical outside users on (1) Chrome desktop and (2) phones. Keep free + BYOK architecture as-is.

The handoff doc's Direction 4 framed an open-ended product-bets discussion (voice fingerprint v2, new platform, sharper categories, feedback loop). A brainstorming pass replaced that framing with a single, sharper goal pulled directly from the user: *"I just want to make this a free app that's easy to install."*

## Decisions locked in this session

| Decision | Choice | Why |
|---|---|---|
| Primary goal | Ship to outside users | Frames the bet space against reach + onboarding friction. |
| "Free" definition | Free extension, user BYOKs Anthropic key | Preserves PRD §10.1. No proxy infra, no monthly bill on Summer. |
| Install surfaces | Chrome (CWS) + PWA on phones | Two surfaces. Android, MCP, Outlook deferred. |
| BYOK onboarding | Keep BYOK, rewrite copy | Cheapest. Honest. Let conversion data (when it exists) tell us whether the key step is the bottleneck. |
| PWA hosting | Extend existing Railway sync-server to also serve PWA static files | Single Railway service. ~30 min of config vs. ~1-2 hours for a separate static host. |

## Out of scope (deferred to later decisions)

- Voice fingerprint v2
- Sharper analysis categories (collapse-to-1 or tighten-existing)
- Feedback loop / voluntary share button
- Android Play Store distribution
- MCP server package distribution
- iOS / Outlook native apps
- Server-side LLM proxy (paid or free-tier)
- Paid pricing tier

Each gets its own decision later, not bundled into this design.

## Premise contradictions surfaced and resolved

1. **Handoff said "no open PRs"; PR #36 was open.** Reviewed and merged at top of session ([`9ccbe3b`](https://github.com/sumrae412/toneguard/commit/9ccbe3b)).
2. **User said "the PWA is hosted on Railway."** Probed `https://sync-server-production-3a24.up.railway.app/`: root + manifest + sw + icons all `404`; only `/healthz` returns `200`. The Railway service hosts the sync-server only. The PWA has never been hosted. This is the root cause of the "really hard to install on the phone" experience — there was no install URL to install from.
3. **PWA install criteria fail even after hosting.** Manifest declares 48×48 and 128×128 only; Android Chrome's `beforeinstallprompt` requires both 192×192 and 512×512. Icons use `../icons/...` paths that escape any standalone-served scope.

## The plan

Two independent streams. Can ship in parallel or either order.

### Stream A — Chrome Web Store listing (~1 week)

1. **Scrub `manifest.json` host_permissions.** Drop `https://*.turbotenant.com/*` (personal SaaS, will be questioned in CWS review). Keep Slack, Gmail, LinkedIn as declared. Custom user sites stay runtime-requested (matches PRD §8.1).
2. **Rewrite first-run BYOK copy.** Update popup's "no API key" state with non-technical language: what an API key is, link to console.anthropic.com, expected monthly cost (~$3 per PRD §6.7), why ToneGuard never sees the key.
3. **Polish `STORE_DESCRIPTION.md` listing.** 4-5 screenshots, promo tile (440×280 or 1400×560), privacy disclosures URL pointing at PRD §10 (host externally or extract to a standalone page).
4. **Submit to CWS.** $5 dev account, 1-3 day review.

### Stream B — Make PWA installable on Railway (~1 day)

1. **Extend `sync-server/src/index.js`.** Add `app.use(express.static('<pwa-path>'))` for `pwa/` and `icons/` before route handlers. Redeploy. Result: PWA loads at `https://sync-server-production-3a24.up.railway.app/`.
2. **Self-contain PWA icons.** Move/copy `icons/icon{48,128,180,192,512}.png` into `pwa/icons/`. Update:
   - `pwa/manifest.json` icons array — add 192 + 512 entries; use 512 as `purpose: maskable`.
   - `pwa/index.html` — favicon path, `apple-touch-icon` path (point at 180).
   - `pwa/sw.js` cache list.
   All paths become `icons/iconN.png` (no `..`).
3. **Add install instructions** in `pwa/index.html` (or new `pwa/install.html`). Two paths: Android (1-2 taps once auto-prompt fires) and iOS (4 taps with screenshots — Apple has no auto-prompt).
4. **Verify in production.** On Android Chrome: confirm "Install ToneGuard" prompt fires. On iOS Safari: confirm home-screen icon renders sharp at retina resolution.

### Already done this session

Generated three icons from `icons/icon.svg` (not yet wired into PWA):
- `icons/icon180.png` (180×180) — apple-touch-icon
- `icons/icon192.png` (192×192) — required for Android install prompt
- `icons/icon512.png` (512×512) — required for Android install prompt + maskable

## Success criterion

A non-technical friend can install ToneGuard on both their laptop (CWS) and their phone (Railway PWA URL) without Summer walking them through it on a call.

## Pressure-test (what kills this plan)

1. **CWS review trips on host_permissions** → mitigated by manifest scrub (Stream A step 1).
2. **PWA traffic affects sync-server availability** → theoretical at current usage; if it materializes, fall back to Stream B path (b): separate static host on GitHub Pages or Cloudflare Pages.
3. **iOS Safari install remains 4 taps** → unfixable (Apple's choice); mitigated by documentation only.
4. **BYOK is the actual conversion ceiling** → known unknown; accepted by design. If post-launch data shows users install but never paste a key, BYOK onboarding gets reopened (separate decision).

## Next step

Transition to `writing-plans` skill for the concrete implementation plan: file-by-file edits, test gates, ship order, verification commands.
