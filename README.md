# ToneGuard

**Checks your messages for tone and clarity before sending. Only interrupts when it matters.**

ToneGuard is a Chrome extension that uses Claude AI to analyze your messages on Slack, Gmail, LinkedIn, and other sites before you send them. If a message has tone or clarity issues, ToneGuard suggests a rewrite. If it looks good, it sends instantly — you won't even notice it's there.

## Features

- **Smart interception** — catches tone, clarity, and professionalism issues in real time
- **Word-level diffs** — see exactly what changed between your original and the suggestion
- **Learns your style** — adapts to your writing voice and learns from your decisions
- **Per-site strictness** — set different sensitivity levels for Slack vs. Gmail vs. LinkedIn
- **Custom rules** — add your own rules in plain English ("never use the word 'urgent'")
- **Custom sites** — add any website you want ToneGuard to monitor
- **Weekly stats** — track how many messages were checked, flagged, and your pass rate
- **Undo countdown** — 3-second undo after sending with a suggestion
- **Dark mode** — matches your system preference
- **Privacy first** — all data stored locally, messages go directly to Anthropic's API

## Requirements

- Chrome browser (Manifest v3)
- A Claude API key from [Anthropic Console](https://console.anthropic.com)

## Installation

### From Chrome Web Store
*(Coming soon)*

### From Source (Developer Mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/sumrae412/toneguard.git
   cd toneguard
   ```

2. Install dev dependencies (for running tests):
   ```bash
   npm install
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked**
   - Select the `toneguard` folder

4. Set up your API key:
   - Click the ToneGuard icon in your Chrome toolbar
   - Enter your Claude API key (`sk-ant-...`)
   - Click **Save**

## Usage

Once installed and configured:

1. **Write a message** on any supported site (Slack, Gmail, LinkedIn, TurboTenant)
2. **Hit Send** as you normally would
3. If your message looks good, it sends immediately
4. If ToneGuard detects an issue, a drawer appears with:
   - Your original message
   - A suggested rewrite with changes highlighted
   - An explanation of what was flagged and why
5. Choose one of three actions:
   - **Use suggestion** — sends the rewritten version
   - **Send as-is** — sends your original message unchanged
   - **Edit suggestion** — modify the rewrite before sending

### Adding Custom Sites

1. Click the ToneGuard icon in the toolbar
2. Scroll to **Active sites**
3. Type a domain (e.g., `teams.microsoft.com`) and click **Add**
4. Grant the permission when prompted

### Adjusting Strictness

- **Gentle** — only flags clearly problematic messages
- **Balanced** (default) — catches meaningful issues
- **Strict** — flags anything that could be improved

Set a global level from the popup, or override per-site.

### Custom Rules

Open the ToneGuard options page (right-click icon > Options) to add custom rules in plain English:
```
- Never use the word "urgent" unless it truly is
- Always include a greeting in emails
- Don't use exclamation marks more than once per message
```

## Building for Distribution

Create a `.zip` file ready for Chrome Web Store upload:

```bash
npm run build
```

This creates `toneguard-0.2.0.zip` in the project root, containing only the files needed for the extension.

## Running Tests

```bash
npm test
```

Tests cover utility functions, manifest integrity, and JavaScript syntax validation.

## How It Works

1. **Content scripts** (`content.js`, `overlay.js`) are injected into supported sites
2. When you press Send, the content script intercepts the action and sends the message text to the **service worker**
3. The service worker calls the **Claude API** with a detailed system prompt covering tone, clarity, and professionalism rules
4. If the message is flagged, the overlay shows results; otherwise the send proceeds silently
5. Your decisions (accepted/dismissed/edited) are stored locally and fed back to Claude in future analyses to improve accuracy

## Privacy

ToneGuard uses your own Claude API key — there is no intermediary server. Messages go directly from your browser to the Anthropic API. All settings, learning history, and voice samples are stored locally on your device.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Android / Mobile (PWA)

ToneGuard includes a Progressive Web App in the `pwa/` directory that works on Android (and iOS) via the browser share sheet.

### How it works on Android

1. Host the `pwa/` folder on any static server (GitHub Pages, Netlify, Vercel, etc.)
2. Open the URL in Chrome on your phone and tap **"Add to Home Screen"**
3. ToneGuard appears in your Android **Share menu**
4. In any messaging app, **select your text** → **Share** → **ToneGuard**
5. ToneGuard analyzes the text and shows a suggestion with a diff
6. Tap **Copy suggestion** → switch back to your app and paste

This isn't fully automatic like the Chrome extension, but it works across every app on the phone — Slack, WhatsApp, Gmail, Messages, etc.

### Running the PWA locally

```bash
# Any static server works
npx serve .
# Then open http://localhost:3000/pwa/ on your phone
```

## License

[ISC](LICENSE)
