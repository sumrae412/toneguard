# ToneGuard

**Checks your messages for tone and clarity before sending. Only interrupts when it matters.**

ToneGuard is a Chrome extension that uses Claude to analyze messages on Slack, Gmail, LinkedIn, and other sites before you send them. If a message has tone or clarity issues, you see a suggestion. If it looks good, it sends instantly — you won't even notice ToneGuard is there.

---

## Quick Start (5 minutes)

You'll need a **Claude API key** ([get one here](https://console.anthropic.com)) and **Chrome**.

```bash
# 1. Clone
git clone https://github.com/sumrae412/toneguard.git
cd toneguard

# 2. (optional) install dev deps if you want to run tests
npm install
```

**3. Load the extension in Chrome:**
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `toneguard` folder you just cloned

**4. Add your API key:**
1. Click the ToneGuard icon in the Chrome toolbar
2. Paste your Claude API key (`sk-ant-...`)
3. Click **Save**

That's it. Open Slack, Gmail, or LinkedIn and start writing — ToneGuard runs silently until something is worth flagging.

> Chrome Web Store listing is coming soon. For now, install from source as above.

---

## What it does

- **Smart interception** — catches tone, clarity, and professionalism issues before send
- **Word-level diffs** — see exactly what changed in the suggestion
- **Explainable issue cards** — the phrase, the rule, the reason
- **Intent modes** — professional, warm, direct, de-escalating, boundary, concise
- **Voice preservation** — choose how much the rewrite is allowed to deviate from your voice
- **Per-site strictness** — Gentle, Balanced, or Strict per site
- **Custom rules** — plain English ("never use the word 'urgent'")
- **Custom sites** — add any domain you want monitored
- **Learns your style** — adapts to your voice over time
- **Smart local routing** — short acknowledgments skip the API
- **Weekly stats** — messages checked, flagged, accept rate
- **Recoverable failures** — never silently sends on error; retry or send-as-is
- **Privacy first** — your API key, your data, no intermediary server

---

## Using ToneGuard

1. Write a message on Slack, Gmail, LinkedIn, or TurboTenant
2. Hit Send as normal
3. If it's fine → it sends. You see nothing.
4. If it's flagged → a drawer appears with:
   - Your original message
   - A suggested rewrite (with highlighted changes)
   - Issue cards explaining what was flagged
5. Choose **Use suggestion**, **Send as-is**, or **Edit suggestion**

### Add a custom site
Click the ToneGuard icon → scroll to **Active sites** → type a domain (e.g. `teams.microsoft.com`) → **Add** → grant the permission.

### Adjust strictness
- **Gentle** — only clearly problematic messages
- **Balanced** (default) — meaningful issues
- **Strict** — anything that could be improved

Set globally in the popup, or override per site.

### Add custom rules
Right-click the ToneGuard icon → **Options** → add plain-English rules:
```
- Never use the word "urgent" unless it truly is
- Always include a greeting in emails
- Don't use exclamation marks more than once per message
```

---

## For developers

### Run tests
```bash
npm test
```

### Build a distributable zip
```bash
npm run build
```
Creates `toneguard-<version>.zip` in the project root, ready for Chrome Web Store upload. Version is read from `manifest.json` (currently `0.3.7`).

### Regenerate shared artifacts
Prompts and analysis contracts live in `shared/`. After editing them:
```bash
node scripts/generate_shared_artifacts.mjs
```
`npm test` fails if generated artifacts are stale.

### Detailed product spec
A full PRD with architecture diagrams lives at [docs/superpowers/specs/2026-05-22-toneguard-prd.md](docs/superpowers/specs/2026-05-22-toneguard-prd.md).

---

## How it works (short version)

1. **Content scripts** (`content.js`, `overlay.js`) inject into supported sites
2. On Send, the script intercepts and forwards the text to the **service worker**
3. The service worker calls Claude with a detailed system prompt (tone + clarity + professionalism)
4. A local precheck skips the API for obvious safe messages
5. If flagged → overlay shows results. If not → send proceeds silently.
6. Your decisions (accepted/dismissed/edited) feed back into future analyses
7. Local telemetry stores routes and diagnostics only — never raw messages, prompts, recipients, API keys, emails, phone numbers, or URLs

---

## Other surfaces

### Native Android app
Native Kotlin app in `android/`. Runs as an Accessibility + overlay service: watches supported messaging apps, checks the active compose field on Send, and surfaces an overlay only on feedback or error.

Build & install:
```bash
cd android
export JAVA_HOME=/usr/local/opt/openjdk@17
export ANDROID_HOME=/usr/local/share/android-commandlinetools
./gradlew testDebugUnitTest assembleDebug --no-daemon --no-parallel
```
APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. After sideloading:
1. Open ToneGuard, paste your Anthropic API key
2. Enable ToneGuard in Android Accessibility settings
3. Grant **Display over other apps** permission
4. Tap **Test ToneGuard** to verify
5. Toggle the apps you want monitored

Supported apps: Google Messages, Samsung Messages, Gmail, Chrome-family browsers, Firefox, Edge, Brave, Slack, LinkedIn, WhatsApp, Messenger, Telegram, Discord, Teams. Diagnostics mode records metadata only (package, event type, view class, button label) — never raw text.

### Mobile PWA (share sheet)
PWA lives at `sync-server/pwa/` and ships from the Railway sync-server at `https://sync-server-production-3a24.up.railway.app/`.

1. Open the URL in mobile Chrome (Android) — tap **Install ToneGuard** when prompted, or ⋮ → **Add to Home Screen**.
2. iOS Safari: tap **Share** → **Add to Home Screen** (no auto-prompt — Apple's choice).
3. ToneGuard appears in the system **Share** menu.
4. In any app: select text → **Share** → **ToneGuard**.
5. Read the suggestion → tap **Copy suggestion** → paste back in your app.

Run locally (for development on the PWA itself):
```bash
cd sync-server
JWT_SECRET=dev DATABASE_URL=postgres://test@localhost/test node src/index.js
# then open http://localhost:8080/ on your phone (same Wi-Fi)
```

---

## Cross-device sync

Same API key on two devices = automatic pairing. ToneGuard syncs decisions, voice samples, relationships, custom rules, and stats across the Chrome extension, PWA, and Android app via a small Railway-hosted service.

- Your API key is SHA-256 hashed client-side — the raw key never leaves your device
- The hash is your identity; the sync server stores opaque JSON blobs
- Short-lived JWT scopes each session; pushes/pulls over HTTPS, realtime updates via WebSocket
- 5-minute fallback poll for missed events
- Fully offline-tolerant — sync is opportunistic

Backend config and deploy steps: [`sync-server/README.md`](sync-server/README.md). Stack: Node/Express + Postgres + `ws`, ~$5/month on Railway Hobby.

---

## Privacy

ToneGuard uses **your** Claude API key. There is no ToneGuard server in the middle of an analysis — messages go directly from your browser to the Anthropic API. Settings, learning history, and voice samples are stored locally. When sync is enabled, learning data is mirrored to the Railway sync server, isolated per user by the JWT-scoped hash.

Full policy: [PRIVACY.md](PRIVACY.md).

---

## Requirements

- Chrome (Manifest v3)
- A Claude API key from [Anthropic Console](https://console.anthropic.com)
- For Android: Android 8.0+, Accessibility + overlay permissions
- For dev work: Node 18+

## License

[ISC](LICENSE)
