# ToneGuard

Chrome extension for real-time tone analysis. Intercepts send actions on Slack, Gmail, LinkedIn, and custom sites. Uses Shadow DOM overlay for UI.

## Key Files
- `content.js` -- Content script (send interception, text replacement, selection analysis)
- `overlay.js` -- Shadow DOM overlay component
- `service-worker.js` -- Background worker (API, context menu, site registration)
- `popup.js` -- Extension popup (settings, custom sites)
- `toneguard-mcp/` -- Python MCP server for IDE integration

## Conventions
- Content script is a single IIFE with `window.__toneGuardActive` double-injection guard
- Platform detection uses exact domain matching (not substring)
- Text replacement uses multi-tier fallback (execCommand -> framework API -> clipboard paste)
- Closed shadow DOM retargets `e.target` to host element; `composedPath()` won't reveal internal elements — use host element identity check instead of path traversal
- Shadow DOM overlay host needs `stopPropagation()` on keyboard/focus events (`keydown`, `keyup`, `keypress`, `input`, `focusin`, `focusout`) to prevent host pages (Slack, Gmail) from stealing focus from overlay inputs/contentEditable
- Claude API responses may contain literal control characters (newlines, tabs) inside JSON string values; always sanitize with `replace(/[\x00-\x1F\x7F]/g, ...)` before `JSON.parse`
- Button `onclick` overrides set in selection mode (context menu) must be cleared to `null` in `showResult()` before re-binding normal-mode handlers, or stale closures will fire alongside `addEventListener` handlers
- Every new styled element with explicit text color needs a corresponding dark mode override in the `@media (prefers-color-scheme: dark)` CSS array block
- CSS in `overlay.js` is a string array joined with `\n` — each rule must be a separate array element
- Service worker message handlers that need async responses must `return true`
- MCP server model: `claude-sonnet-4-20250514`, build system: hatchling
