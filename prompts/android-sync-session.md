# Session Prompt: Complete ToneGuard Android App with Sync

## Context

ToneGuard is a tone/clarity checker with three platforms: Chrome extension, PWA, and native Android app. A cross-platform sync system was just built (PR #7, branch `feat/cross-platform-sync`) using Supabase as the backend. The Chrome extension and PWA are fully wired up. The Android app needs the same treatment.

**Repo:** https://github.com/sumrae412/toneguard
**Branch:** `feat/cross-platform-sync` (work on this branch)

## What already exists in the Android app

The Android app (`android/`) is a **fully functional native Kotlin app** — not a WebView wrapper. It has:

- `MainActivity.kt` — settings UI (API key, strictness slider, permission setup)
- `ToneGuardAccessibilityService.kt` — intercepts send buttons across Slack, Gmail, LinkedIn, WhatsApp, Messenger, Telegram, Discord, Teams
- `ClaudeApiClient.kt` — direct Anthropic API calls with retry logic
- `OverlayManager.kt` — system overlay drawer with word-level diffs, red flags, confidence bar, copy-to-clipboard
- `Prefs.kt` — encrypted SharedPreferences (API key, strictness, enabled toggle)
- Full layouts (`activity_main.xml`, `overlay_drawer.xml`) and drawables

**What works:** The app can intercept messages, analyze them via Claude, show results in an overlay, and let users copy suggestions. It does NOT store any learning data or sync.

## What needs to be added

### 1. Learning storage in Prefs.kt

Add storage for the same learning data the extension tracks:

- **Decisions** (`tg_decisions`): Array of `{action, original, suggestion, finalText, timestamp}`, capped at 100
- **Voice samples** (`tg_voice_samples`): Array of `{text, timestamp}`, capped at 30
- **Relationships** (`tg_relationships`): Map of `contactName -> {messageCount, lastSeen}`
- **Custom rules** (`tg_custom_rules`): String
- **Stats** (`tg_stats`, `tg_stats_history`): Weekly usage stats, 12-week history

Store as JSON strings in SharedPreferences (the data is small, ~250KB max).

### 2. Log decisions after user actions

In `OverlayManager.kt`, after the user taps "Use suggestion" or "Dismiss":
- Log the decision to SharedPreferences
- Trigger a sync push

### 3. Save voice samples

In `ToneGuardAccessibilityService.kt`, after a message passes analysis (not flagged):
- Save the message text as a voice sample (cap at 30, max 300 chars)

### 4. Feed learning data into prompts

In `ClaudeApiClient.kt`:
- Add learned examples (last 3 false positives, accepted, edited) to the system prompt — same as the Chrome extension's `getLearnedExamples()`
- Add voice context (last 5 samples) — same as `getVoiceContext()`
- Add relationship context for @mentions — same as `getRelationshipContext()`

### 5. Integrate Supabase sync

Port the sync module from JavaScript to Kotlin. The JS implementation is at `src/sync/`:

- **`merge.js`** — merge strategies (union-dedup-trim for arrays, per-key max for maps, LWW for custom rules)
- **`sync-manager.js`** — orchestrator (pull on startup, debounced push after writes, Realtime subscription, 5-min poll fallback)
- **`supabase-client.js`** — lightweight HTTP client (no SDK needed, just fetch/OkHttp to Supabase REST API)

Key details:
- **Supabase URL:** `https://jimjfaaaccqtcbbxsrys.supabase.co`
- **Publishable key:** `sb_publishable_NyUr9I9amTiVVWT5H8ysvg_lB054qK0`
- **Auth:** POST to `/functions/v1/auth-by-hash` with `{"hash": SHA256(apiKey)}`, get back a JWT
- **Pull:** GET `/rest/v1/sync_data?user_hash=eq.{hash}`
- **Push:** POST `/rest/v1/sync_data` with `Prefer: resolution=merge-duplicates`
- **Table:** `sync_data` with columns: `user_hash`, `data_type`, `payload` (JSONB), `version`, `updated_at`
- **Data types:** `decisions`, `voice_samples`, `relationships`, `custom_rules`, `stats_history`

Use OkHttp (already a dependency) for HTTP calls. Use `java.security.MessageDigest` for SHA-256 hashing.

### 6. Sync status in MainActivity

Add a sync status indicator to the settings screen showing connection state and last sync time.

## Architecture notes

- The Android app uses **EncryptedSharedPreferences** for the API key — keep using it for sensitive data, but regular SharedPreferences is fine for learning data (it's not sensitive)
- The accessibility service runs in the background — sync init should happen there too, not just in MainActivity
- OkHttp is already in `build.gradle.kts` — use it for Supabase calls, no new dependencies needed
- Keep the sync module as a separate Kotlin class (`SyncManager.kt`) that mirrors the JS `SyncManager`

## Merge strategies (must match exactly)

These must produce identical results to the JS versions (cross-platform data will be merged):

- **Decisions:** Union by `(timestamp, action)`, sort newest-first, trim to 100
- **Voice samples:** Deduplicate by text content, sort newest-first, trim to 30
- **Relationships:** Per-key: `max(messageCount)`, latest `lastSeen`
- **Custom rules:** Last-write-wins by `updatedAt` timestamp
- **Stats history:** Union by `weekStart`, take max per counter field, trim to 12 weeks

## Testing

- Unit test all merge strategies in Kotlin to verify they match the JS output
- Test with the Chrome extension: make a decision on Android, verify it appears in the extension's options page history
- Test offline: make decisions with airplane mode on, reconnect, verify sync

## Files to create

- `android/app/src/main/java/com/toneguard/SyncManager.kt`
- `android/app/src/main/java/com/toneguard/MergeStrategies.kt`
- `android/app/src/main/java/com/toneguard/LearningStore.kt`
- `android/app/src/test/java/com/toneguard/MergeStrategiesTest.kt`

## Files to modify

- `android/app/src/main/java/com/toneguard/ClaudeApiClient.kt` — add learning context to prompts
- `android/app/src/main/java/com/toneguard/ToneGuardAccessibilityService.kt` — init sync, save voice samples
- `android/app/src/main/java/com/toneguard/OverlayManager.kt` — log decisions, trigger sync push
- `android/app/src/main/java/com/toneguard/MainActivity.kt` — sync status UI
- `android/app/src/main/res/layout/activity_main.xml` — add sync status section
