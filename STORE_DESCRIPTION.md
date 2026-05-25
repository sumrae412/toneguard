# Chrome Web Store Listing

## Short Description (132 chars max)
Checks your messages for tone and clarity before sending. Only interrupts when it matters.

## Detailed Description

**ToneGuard — Think before you send.**

Ever hit Send and immediately regretted it? ToneGuard catches tone and clarity issues in your messages before they reach the other person. It only interrupts when it matters — no constant nagging for perfect grammar.

**How it works:**
1. Write your message normally on Slack, Gmail, LinkedIn, or any site you add
2. When you hit Send, ToneGuard quickly checks your message with Claude AI
3. If the message looks good, it sends immediately — you won't even notice
4. If there's a tone or clarity issue, ToneGuard shows a suggestion with a clear explanation
5. You decide: use the suggestion, edit it, or send your original message

**Features:**
- Real-time tone, clarity, and professionalism analysis
- Smart suggestions with word-level diff highlighting
- Explainable warnings showing what phrase was flagged and why
- Rewrite modes for professional, warm, direct, de-escalating, boundary-setting, and concise messages
- Voice preservation controls for lighter or stronger rewrites
- Retry and diagnostic actions when analysis fails
- Learns your writing style over time
- Adjustable strictness (Gentle / Balanced / Strict) — globally or per site
- Add your own custom rules in plain English
- Works on Slack, Gmail, LinkedIn, and any site you add
- Weekly stats dashboard showing your communication patterns
- 3-second undo after sending
- Dark mode support
- All data stays on your device — no tracking, no analytics
- Local quality counters never store message text, prompts, recipients, API keys, emails, phone numbers, or URLs

**Privacy first:**
ToneGuard uses YOUR Claude API key — there's no middleman server. Your messages go directly from your browser to the Anthropic API and nowhere else. All settings and learning data are stored locally on your device.

**Requirements:**
- A Claude API key from Anthropic (https://console.anthropic.com)
- Chrome browser

**Open source:** https://github.com/sumrae412/toneguard

## Category
Productivity

## Language
English

## Tags
tone, writing, communication, AI, clarity, messaging, Slack, Gmail, productivity

---

## CWS submission checklist

Pre-submit prep (track here, finalize before upload):

- [ ] **Privacy policy URL** — host `PRIVACY.md` somewhere public (GitHub raw works: `https://raw.githubusercontent.com/sumrae412/toneguard/main/PRIVACY.md`)
- [ ] **Support contact URL** — `https://github.com/sumrae412/toneguard/issues`
- [ ] **Promo tile** — 440×280 PNG OR 1400×560 PNG
- [ ] **1–5 screenshots** — 1280×800 PNG or 640×400 PNG (use overlay drawer in action, options page, weekly stats popup, suggestion card, intent-mode picker)
- [ ] **Build zip** — `npm run build` produces `toneguard-0.4.0.zip` (reads version from manifest.json)
- [ ] **$5 Chrome Web Store developer fee** — one-time, at `https://chrome.google.com/webstore/devconsole`

## Permissions justification

Paste each into the CWS submission form when prompted:

- **`storage`** — Store the user's API key and per-site strictness preferences locally in the browser.
- **`activeTab`** — Read the message being composed in the active tab when the user clicks Send, so ToneGuard can analyze and offer a suggestion.
- **`scripting`** — Inject a content script into supported sites (Slack, Gmail, LinkedIn) to intercept the Send action and surface the suggestion overlay.
- **`contextMenus`** — Provide a right-click "Check this message" shortcut for users who want to analyze selected text outside the supported sites.
- **`host_permissions: https://api.anthropic.com/*`** — Send the user's message to the Anthropic Claude API for analysis. Uses the user's own API key (BYOK); ToneGuard never proxies or stores the key.
- **`host_permissions: https://*.slack.com/*`, `https://mail.google.com/*`, `https://www.linkedin.com/*`** — Intercept Send actions on the three primary supported sites. Additional sites the user opts into are requested at runtime via `optional_host_permissions`.

## Post-approval

After Google approves the listing, update `README.md`'s "install from source" section to point at the live Chrome Web Store URL. Doc-only commit direct to main per repo convention.
