# Changelog

All notable changes to ToneGuard will be documented in this file.

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
