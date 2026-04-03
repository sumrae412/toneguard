# ToneGuard Privacy Policy

**Last updated:** April 2, 2026

## Overview

ToneGuard is a Chrome extension that checks your messages for tone and clarity before you send them. Your privacy matters — here's exactly what the extension does and doesn't do with your data.

## What Data ToneGuard Accesses

- **Message text:** When you click Send (or press Enter) on a supported site, ToneGuard reads the text of the message you're about to send.
- **Conversation context:** On Slack, ToneGuard reads the last few visible messages in the current thread to provide context-aware analysis. No other platform's conversation history is read.
- **@mentions:** ToneGuard extracts @mentions from your messages to track how often you message certain contacts, which helps it calibrate tone suggestions (e.g., more casual for frequent contacts).

## Where Data Is Sent

- **Anthropic API:** Your message text (and optional conversation context) is sent to the Anthropic Claude API for analysis. This requires your own API key, which you provide in the extension settings. ToneGuard does not proxy your messages through any other server.
- **No other third parties:** ToneGuard does not send data to any analytics service, advertising network, tracking pixel, or any server other than the Anthropic API.

## What Data Is Stored

All data is stored locally on your device using Chrome's built-in storage APIs:

| Data | Storage | Purpose |
|------|---------|---------|
| API key | `chrome.storage.sync` | Authenticate with Claude API (syncs across your Chrome devices) |
| Settings (enabled, strictness, custom sites, custom rules) | `chrome.storage.sync` | Persist your preferences |
| Voice samples (last 30 sent messages, truncated to 300 chars) | `chrome.storage.local` | Help Claude match your writing style in suggestions |
| Decision history (accepted/dismissed/edited suggestions) | `chrome.storage.local` | Help Claude learn your preferences over time |
| Recipient relationships (@mention counts) | `chrome.storage.local` | Calibrate tone for frequent vs. infrequent contacts |
| Weekly stats (checked/flagged counts) | `chrome.storage.local` | Show you your communication stats on the options page |

## What Data Is NOT Collected

- ToneGuard does **not** collect, transmit, or store any personal information on external servers.
- ToneGuard does **not** have its own backend server. All processing is done via the Anthropic API using your own API key.
- ToneGuard does **not** use cookies, fingerprinting, or tracking of any kind.
- ToneGuard does **not** access or read any page content other than message editors and send buttons on supported sites.

## Data Retention

- All locally stored data can be cleared at any time from the ToneGuard options page (learning history) or by removing the extension.
- Voice samples are automatically limited to the 30 most recent messages.
- Weekly stats are automatically rotated, keeping only the last 12 weeks.
- Uninstalling the extension removes all stored data.

## Anthropic API Data Handling

When your message is sent to the Anthropic API for analysis, it is subject to [Anthropic's Usage Policy](https://www.anthropic.com/policies) and [Privacy Policy](https://www.anthropic.com/privacy). Anthropic does not use API inputs to train models. See Anthropic's documentation for full details.

## Permissions Explained

| Permission | Why It's Needed |
|------------|----------------|
| `storage` | Save your settings, learning history, and voice samples locally |
| `activeTab` | Access the current tab to inject content scripts on custom sites |
| `scripting` | Register content scripts dynamically for user-added custom sites |
| Host permissions (Slack, Gmail, LinkedIn, TurboTenant) | Intercept send actions on these supported platforms |
| `https://api.anthropic.com/*` | Send messages to the Claude API for analysis |
| Optional `https://*/*` | Only requested when you add a custom site, scoped to that domain |

## Your Control

- **Disable anytime:** Toggle ToneGuard off from the popup without uninstalling.
- **Clear history:** Wipe all learning data from the options page.
- **Remove sites:** Remove any custom site from monitoring via the popup.
- **Uninstall:** Removes the extension and all associated data.

## Changes to This Policy

If this privacy policy changes, the updated version will be included with the extension update. The "Last updated" date at the top will reflect the change.

## Contact

For questions or concerns about this privacy policy, open an issue at:
https://github.com/sumrae412/toneguard/issues
