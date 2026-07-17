# Changelog

All notable changes to ToneGuard will be documented in this file.

## [0.4.20] - 2026-07-17

### Changed
- Full UI polish pass across all five surfaces (popup, Settings, welcome, in-page overlay drawer, mobile PWA): one cohesive "ink-and-paper" light design system — Material green `#4CAF50` replaced with a deeper emerald `#177245`, warm paper backgrounds, hairline card borders with soft shadows, monospace eyebrow labels and status text, refined focus rings, and consistent radii. Dark-mode variants in the overlay and PWA restyled to match. PWA `theme_color` updated.

## [0.4.19] - 2026-07-17

### Fixed
- **PWA sync was entirely broken in production**: `index.html` loaded the four sync modules from `../src/sync/`, which is outside the Railway deploy context (Root Directory is `/sync-server`) — all four 404'd, so the PWA booted with no sync at all. The modules are now generated copies under `pwa/sync/` (emitted by `scripts/generate_shared_artifacts.mjs`; `src/sync/` stays canonical), referenced relatively, and precached by the service worker (cache bumped to v5).
- Sync died silently after 1 hour: the JWT expires at 3600s and the client never re-authenticated, so every later pull/push 401'd until restart. The client now re-auths once on 401 and retries.
- Realtime sync died permanently on any dropped WebSocket (network blip, server redeploy): the client now reconnects with capped exponential backoff and a fresh token.
- The server's WS heartbeat pinged sockets but never dropped dead ones — vanished clients stayed in the fan-out set forever. It now tracks pong responses and terminates zombies.
- Concurrent devices could silently overwrite each other's sync rows: the server trusted the client-sent version (two devices at v5 both wrote v6; a client omitting version regressed rows to v1). Versions are now computed from the stored row and returned to the client.
- 5xx/unknown API errors told the user "Your message was sent without checking" while the extension actually blocked the send behind the error drawer. Wording now matches behavior ("NOT sent — retry, send as is, or cancel").
- A quota 400 that appeared only on a retry/escalation call (credits depleting mid-analysis) blocked the send with a parse error instead of auto-pausing. All retry paths now run the same quota-pause classification.
- The popup/Settings "paused" banner ignored the 6h cooldown expiry and kept showing paused after analysis had resumed.
- If the overlay failed to inject, an analysis error left the page's send guard permanently wedged (every later send silently blocked until reload).
- `prompts/analysis-tool.json` and `prompts/landing-tool.json` were fetched via `chrome.runtime.getURL()` but missing from `web_accessible_resources`.
- MCP analyzer now discards tool results with leaked tool-call XML markup (port of the extension's `validateToolInput` guard).
- Android: a maxed-out API key (quota/credit 400) was reported as "message may be too long"; now classified like the extension.
- Android: a saved "preserve" voice strength always displayed as "balanced" in Settings (spinner index bug).
- Android: a missing API key could wedge the accessibility service's `analyzing` flag and strand the loading overlay.
- Android: `voice_fingerprint` was missing from the sync data types — fingerprints from other devices were silently dropped.

### Changed
- Sync data pushed to unknown `data_type` values is now rejected (allowlist of the six canonical types).
- `/auth` requires a hex SHA-256 hash, not any 64-char string.
- Sync starts immediately after saving an API key in the popup/welcome page (previously waited for the next browser restart).
- `sync-server/package-lock.json` is now committed so Railway builds are reproducible (`npm ci`).
- Dev-dependency vulnerabilities fixed (`npm audit fix`: vite high, postcss moderate → 0).

## [0.4.18] - 2026-06-19

### Changed
- Hardened `analyzeAndIntercept` against non-string `text`: if a caller ever passes a DOM node or object (the class of bug behind the old "Could not serialize message" retry crash, fixed in #73), it now recovers by reading the live editor text instead of crashing the send. Defense-in-depth - all current callers already pass strings.

## [0.4.17] - 2026-06-19

### Changed
- Quota-pause now shows its in-page notice on **every** unchecked send while paused, not just the first. Previously the notice fired once and later sends went out silently, which looked identical to a clean pass - the user couldn't tell their message had skipped checking. The badge alone was too easy to miss.

## [0.4.16] - 2026-06-18

### Added
- Auto-pause when the Anthropic API key is maxed out. A credit-balance or usage-limit error (HTTP 400) now pauses ToneGuard instead of blocking every send: messages go through unchecked, a clear in-page notice appears the moment it pauses ("ToneGuard paused — this message was sent without checking…"), a "!" badge appears on the toolbar icon, and the popup/Settings show a banner with a **Resume ToneGuard** button. Subsequent sends short-circuit with no API call (and no repeated notice) until you resume, and the pause auto-expires after 6h to re-probe the API.

### Fixed
- A maxed-out API key previously surfaced as a cryptic `TG_RUNTIME_001` error and blocked the user from sending anything.

## [0.3.4] - 2026-04-27

### Added
- Shared analysis schema, categories, modes, prompt sources, and generated artifacts with freshness tests.
- Synthetic golden analysis corpus shared by JS and MCP contract tests.
- Deterministic pre-check routing for local pass, standard, deep, and blocked-error paths.
- Explainable issue cards in Chrome overlay and PWA.
- Intent modes, voice preservation controls, site profiles, typed failure diagnostics, and local-only telemetry summaries.

### Changed
- Chrome landing prompt now loads from a generated prompt artifact instead of an inline service-worker constant.
- Failures no longer silently release sends. Users can retry, send as-is, or copy non-sensitive diagnostics.

## [0.3.1] - 2026-04-18

### Fixed
- **"Use suggestion" no longer falsely reports failure.** The parent-side
  verification in `content.js` compared inserted text to the suggestion via
  strict equality after a simple trim. Editors normalize content in ways
  that broke the match even when the insert succeeded: Gmail appends the
  signature below the body, Slack's Quill fallback pads empty paragraphs
  with zero-width spaces, and various platforms convert NBSP/CRLF or
  collapse newlines. The result was a nack every time, an ⚠ "Couldn't
  apply the rewrite — it's on your clipboard" dialog, and a drawer the
  user couldn't easily dismiss. Verification now normalizes both sides
  (strip zero-width chars, NBSP → space, collapse whitespace, LF
  endings) and accepts either exact match or the suggestion being *newly
  present* in the editor (Gmail signature case). A suggestion that was
  already a substring of the original draft no longer counts as
  verification — that would falsely pass a silent no-op. Silent no-ops
  still fail loudly. New `verifyInsertedText` helper in `lib.js` with 12
  unit tests, including the before-contains-suggestion edge case.
- **Error dialog no longer stacks or traps the drawer.** `clearToast()`
  didn't remove `.tg-stale-notice` panels, so an older error could stay
  on top of a fresh state. Backdrop click during a terminal toast
  (`.tg-stale-notice`, `.tg-stale`, or `.tg-passed`) also re-entered
  `handleSendOriginal()` and got a second nack ("no pending compose"),
  stacking another error dialog. Both paths now clean up correctly.
- **Fix applies to custom sites and the context-menu path too.**
  `service-worker.js` now injects `lib.js` alongside `overlay.js` and
  `content.js` in all three scripting paths (static manifest,
  `registerContentScripts` for user-added sites, `executeScript` for
  context-menu "Check tone with ToneGuard"). Without this, the verify
  helper was absent on those paths and the old strict-equality check
  would still fire.
- **Missing verify helper now fails loudly instead of silently falling
  back.** If `globalThis.__toneGuardLib.verifyInsertedText` is ever
  absent at runtime (bad load order, shipping regression), the decision
  callback logs `[ToneGuard:diag]` and returns a nack with a distinct
  error — rather than re-entering the strict-equality path that
  motivated this release.

### Security
- **Iframe message handler now asserts the sender is our parent window.**
  `overlay-frame.js`'s `message` handler previously validated only the
  sender-set `msg.source` field. A script on the host page could spoof
  that tag. The handler now also requires `e.source === window.parent`,
  rejecting cross-origin / subframe messages before they reach
  `showResult` or the decision plumbing. Pre-existing gap closed as part
  of this release since new message-triggered branches were added.

## [0.3.0] - 2026-04-16

### Added
- **Train Your Voice** (options page) — paste 5–10 messages you'd be happy
  to send as-is; the rewriter learns your style. Samples are tagged
  `source="trained"` and take precedence over passively-collected ones.
- **Style fingerprint** — once you have 3+ trained samples, hit
  "Regenerate style profile" to compress them into a ~200-token style
  profile. The rewriter uses this in place of raw samples (sharper
  signal, lower token cost). Syncs across devices.
- **"If they only skim…" panel** — every flagged analysis now includes a
  descriptive landing view: what a recipient would take away on a single
  skim (takeaway, tone felt, next action). Separate from tone/clarity
  critique — does not flag, does not rewrite. Collapsible, auto-opens
  for flagged messages.
- MCP server gains 3 new tools: `train_voice`, `regenerate_fingerprint`,
  `get_voice_profile` (total: 7). New `voice_fingerprint` sync data type.

### Changed
- Voice sample storage now tracks a `source` field (auto | trained) with
  per-source caps (15 trained / 30 auto). Trained samples take priority
  when building the rewriter's context.
- `getVoiceContext` (service-worker) prefers the derived fingerprint
  when available, falls back to raw samples.

## [0.2.2] - 2026-04-16

### Fixed
- Overlay no longer paints "Suggestion applied!" before the parent
  confirms the insertion actually landed. If the Gmail compose DOM is
  detached or `execCommand` silently no-ops, the rewrite is copied to
  the clipboard and the user sees "Couldn't apply the rewrite — it's on
  your clipboard" instead of a lying success toast.

## [0.2.1] - 2026-04-16

### Fixed
- Claude API response parser corrupted valid pretty-printed JSON by
  escaping structural newlines. Fixed with a state-machine sanitizer
  that only escapes control chars inside string literals.
- `chrome.contextMenus.create` no longer throws "duplicate id" on
  extension reload.

## [0.2.0] - 2026-04-01

### Added
- In-page overlay with Shadow DOM replaces side panel (no extra permissions needed)
- Word-level inline diff highlighting in suggestions
- Undo countdown (3 seconds) after sending with a suggestion
- Per-site strictness overrides (Slack, Gmail, LinkedIn, TurboTenant)
- Dark mode support in overlay
- Stale extension context detection with reload prompt
- "Review" button injected near editors for draft-mode analysis
- Voice learning from sent messages (last 30 samples)
- Recipient relationship tracking via @mentions
- Weekly communication stats dashboard on options page
- Decision history with learning feedback to Claude
- Custom rules editor (plain English)
- Custom site support with dynamic content script registration
- Clarifying questions flow (up to 3 questions before rewrite)
- Safety timeout (10s) prevents permanently stuck messages
- Conversation context scraping on Slack for context-aware analysis

### Changed
- Moved from side panel architecture to in-page overlay
- Improved prompt with detailed tone, clarity, and professionalism rules

## [0.1.0] - 2026-03-15

### Added
- Initial Chrome extension with Manifest v3
- Claude API integration (Haiku model) for message analysis
- Support for Slack, Gmail, LinkedIn, and TurboTenant
- Popup with API key management and enable/disable toggle
- Global strictness control (Gentle / Balanced / Strict)
- Basic send interception on supported platforms
