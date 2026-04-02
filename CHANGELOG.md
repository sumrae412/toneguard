# Changelog

All notable changes to ToneGuard will be documented in this file.

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
