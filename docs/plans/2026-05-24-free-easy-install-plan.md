# Free + Easy Install Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ToneGuard installable by non-technical outside users on Chrome desktop (Web Store) and phones (PWA hosted on existing Railway sync-server).

**Architecture:** Two independent streams shipped as separate PRs. Stream B (PWA install fix) is concrete code + verification work. Stream A (CWS listing) is mostly content + a manifest scrub + submission. Stream B should ship first because it unblocks phone-install testing and is mostly already understood; Stream A's CWS review takes 1-3 days of waiting, so we kick it off after B is verified live.

**Tech Stack:** Chrome Extension MV3 (existing), PWA (vanilla HTML/JS/SW), Express 4 sync-server on Railway (ESM, Node ≥20), vitest for unit tests.

**Design doc:** [`2026-05-24-free-easy-install-design.md`](2026-05-24-free-easy-install-design.md)

**Pre-staged in repo (this session, not yet wired):**
- `icons/icon180.png` (180×180) — apple-touch-icon
- `icons/icon192.png` (192×192) — Android install prompt requirement
- `icons/icon512.png` (512×512) — Android install prompt requirement + maskable

**Gates that must stay green** (per [CLAUDE.md](../../CLAUDE.md)):
- `node node_modules/.bin/vitest run` (494 passing baseline)
- `node scripts/parity_scan.mjs --check`
- `node scripts/generate_shared_artifacts.mjs --check`
- Manifest version bump in `manifest.json` if extension code changed (Stream A only)
- `cp CLAUDE.md AGENTS.md` in same commit if CLAUDE.md changed (neither stream expects this)

---

## Stream B — PWA installable on Railway

Ship as one PR. Estimated 6-8 tasks, ~1-2 hours of focused work plus production verification.

### Task B0: Confirm Railway build context for sync-server

**Why:** The plan branches on whether Railway builds from `sync-server/` subdirectory or repo root. We need to know before deciding how the PWA files reach the deploy.

**Step 1:** Check Railway service config.

```bash
# Either via Railway dashboard (Service → Settings → Source → Root Directory),
# or via CLI:
railway status 2>&1 | head -20
railway variables 2>&1 | grep -i 'root\|directory' | head
```

**Step 2:** Decide branch.

- **Branch A (Railway builds from repo root):** `pwa/` is already in the deploy. Task B5 uses `path.resolve(__dirname, "../../pwa")`.
- **Branch B (Railway builds from `sync-server/` only):** `pwa/` is NOT in the deploy. Task B5 adds a build-time copy from `../pwa` to `sync-server/public/` via a postinstall hook OR we reconfigure Railway Root Directory to repo root.

**Step 3:** Note the branch choice in a comment on the PR description. Subsequent tasks reference it.

**Commit:** None (info-gathering).

---

### Task B1: Move icons into self-contained `pwa/icons/`

**Files:**
- Create: `pwa/icons/icon48.png`, `pwa/icons/icon128.png`, `pwa/icons/icon180.png`, `pwa/icons/icon192.png`, `pwa/icons/icon512.png`

**Step 1:** Copy.

```bash
mkdir -p pwa/icons
cp icons/icon48.png icons/icon128.png icons/icon180.png icons/icon192.png icons/icon512.png pwa/icons/
ls -la pwa/icons/
```

**Step 2:** Verify all five exist with correct sizes.

```bash
for f in pwa/icons/icon{48,128,180,192,512}.png; do
  sips -g pixelWidth -g pixelHeight "$f" | tail -2
done
```

Expected: each prints `pixelWidth: N` and `pixelHeight: N` matching the filename.

**Step 3:** Commit.

```bash
git add pwa/icons/
git commit -m "feat(pwa): vendor icons into pwa/icons/ for self-contained hosting"
```

---

### Task B2: Add failing test for PWA install criteria

**Files:**
- Create: `tests/pwa-install.test.js`

**Why TDD:** Without this test, future edits could regress the manifest icons (192/512) that Android Chrome requires for the install prompt. Same shape as `tests/manifest.test.js` (extension-side).

**Step 1:** Write the test.

```javascript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PWA_DIR = resolve(__dirname, "..", "pwa");
const readPwa = (rel) => readFileSync(resolve(PWA_DIR, rel), "utf8");

describe("PWA install criteria", () => {
  const manifest = JSON.parse(readPwa("manifest.json"));

  it("declares a 192x192 PNG icon (Android Chrome install prompt requirement)", () => {
    const has192 = manifest.icons.some(
      (i) => i.sizes === "192x192" && i.type === "image/png"
    );
    expect(has192).toBe(true);
  });

  it("declares a 512x512 PNG icon (Android Chrome install prompt requirement)", () => {
    const has512 = manifest.icons.some(
      (i) => i.sizes === "512x512" && i.type === "image/png"
    );
    expect(has512).toBe(true);
  });

  it("declares a maskable icon (Android adaptive-icon support)", () => {
    const hasMaskable = manifest.icons.some(
      (i) => typeof i.purpose === "string" && i.purpose.includes("maskable")
    );
    expect(hasMaskable).toBe(true);
  });

  it("uses self-contained icon paths (no '..' escape)", () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("..")).toBe(false);
    }
    const indexHtml = readPwa("index.html");
    expect(indexHtml).not.toMatch(/href=["']\.\.\/icons\//);
    expect(indexHtml).not.toMatch(/src=["']\.\.\/icons\//);
    const sw = readPwa("sw.js");
    expect(sw).not.toMatch(/['"]\.\.\/icons\//);
  });

  it("apple-touch-icon points at a 180px asset", () => {
    const indexHtml = readPwa("index.html");
    expect(indexHtml).toMatch(/apple-touch-icon["'][^>]*icon180\.png/);
  });
});
```

**Step 2:** Run, expect failure.

```bash
node node_modules/.bin/vitest run tests/pwa-install.test.js
```

Expected: 5 tests, 5 failures (current manifest has no 192/512/maskable; paths still use `../icons/`).

**Step 3:** Commit the failing test.

```bash
git add tests/pwa-install.test.js
git commit -m "test(pwa): assert install-prompt criteria + self-contained paths"
```

---

### Task B3: Update `pwa/manifest.json` icons array

**Files:**
- Modify: `pwa/manifest.json:10-13`

**Step 1:** Replace the icons array. New array:

```json
"icons": [
  { "src": "icons/icon48.png",  "sizes": "48x48",   "type": "image/png" },
  { "src": "icons/icon128.png", "sizes": "128x128", "type": "image/png" },
  { "src": "icons/icon180.png", "sizes": "180x180", "type": "image/png" },
  { "src": "icons/icon192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "icons/icon512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "icons/icon512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

**Step 2:** Run the PWA-install test — manifest-related assertions should pass; HTML/SW assertions still fail.

```bash
node node_modules/.bin/vitest run tests/pwa-install.test.js
```

Expected: 3 pass (192, 512, maskable, self-contained-paths-for-manifest), 2 fail (HTML + SW still reference `../icons/`).

**Step 3:** Commit.

```bash
git add pwa/manifest.json
git commit -m "feat(pwa): add 192/512 icons + maskable + self-contained paths in manifest"
```

---

### Task B4: Update `pwa/index.html` icon references

**Files:**
- Modify: `pwa/index.html:11` (favicon), `pwa/index.html:12` (apple-touch-icon), `pwa/index.html:508` (inline `<img>`)

**Step 1:** Three string replacements.

Line 11 — favicon, change href from `../icons/icon48.png` to `icons/icon48.png`.
Line 12 — apple-touch-icon, change href from `../icons/icon128.png` to `icons/icon180.png` (also bump from 128 → 180 for retina sharpness).
Line 508 — inline `<img>` src, change from `../icons/icon48.png` to `icons/icon48.png`.

**Step 2:** Verify no `../icons/` references remain.

```bash
grep -n '\.\./icons/' pwa/index.html && echo "STILL HAS REFS" || echo "CLEAN"
```

Expected: `CLEAN`.

**Step 3:** Run test — apple-touch-icon + self-contained-paths-for-HTML assertions pass; SW still fails.

```bash
node node_modules/.bin/vitest run tests/pwa-install.test.js
```

Expected: 4 pass, 1 fail (SW).

**Step 4:** Commit.

```bash
git add pwa/index.html
git commit -m "feat(pwa): self-contained icon paths in index.html; apple-touch-icon → 180px"
```

---

### Task B5: Update `pwa/sw.js` cache list

**Files:**
- Modify: `pwa/sw.js:8-15`

**Step 1:** Replace the `cache.addAll([...])` array.

```javascript
cache.addAll([
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon48.png",
  "./icons/icon128.png",
  "./icons/icon180.png",
  "./icons/icon192.png",
  "./icons/icon512.png"
])
```

**Step 2:** Bump the cache name to invalidate stale SW caches on existing installs.

Change `const CACHE_NAME = "toneguard-pwa-v2";` to `const CACHE_NAME = "toneguard-pwa-v3";`.

**Step 3:** Run the PWA-install test — all 5 should pass.

```bash
node node_modules/.bin/vitest run tests/pwa-install.test.js
```

Expected: `5 passed`.

**Step 4:** Run full vitest baseline to confirm no regressions.

```bash
node node_modules/.bin/vitest run
```

Expected: `499 passed` (494 + 5 new).

**Step 5:** Commit.

```bash
git add pwa/sw.js
git commit -m "feat(pwa): self-contained cache paths in service worker; bump CACHE_NAME to v3"
```

---

### Task B6: Add Express static serving to sync-server

**Files:**
- Modify: `sync-server/src/index.js` (add static middleware)
- Conditional: `sync-server/package.json` (postinstall copy step, only if Task B0 branch B)

**Step 1 (Branch A — Railway builds from repo root):**

Add to `sync-server/src/index.js`, near the top after the imports:

```javascript
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWA_DIR = path.resolve(__dirname, "../../pwa");
```

After the CORS middleware block (around line 37) and BEFORE any route handlers, add:

```javascript
// Serve PWA static files. Self-contained under pwa/ (icons live in pwa/icons/).
app.use(express.static(PWA_DIR));
```

**Step 1 (Branch B — Railway builds from sync-server/ only):**

Two sub-edits.

(i) Create `sync-server/scripts/copy-pwa.js`:

```javascript
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../../pwa");
const dest = path.resolve(__dirname, "../public");

if (!existsSync(src)) {
  console.error(`copy-pwa: source ${src} not found (expected at build time, not at runtime)`);
  process.exit(0); // soft-exit so runtime starts don't fail
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-pwa: ${src} → ${dest}`);
```

(ii) Add `"postinstall": "node scripts/copy-pwa.js"` to `sync-server/package.json` scripts.

(iii) In `sync-server/src/index.js`, serve from local `public/`:

```javascript
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWA_DIR = path.resolve(__dirname, "../public");
```

And the same `app.use(express.static(PWA_DIR));` line as Branch A.

**Step 2:** Local smoke-test (either branch).

```bash
cd sync-server
JWT_SECRET=test DATABASE_URL=postgres://test@localhost/test node --watch src/index.js &
SERVER_PID=$!
sleep 2
curl -sS -o /dev/null -w "GET / → %{http_code}\n" http://localhost:8080/
curl -sS -o /dev/null -w "GET /manifest.json → %{http_code}\n" http://localhost:8080/manifest.json
curl -sS -o /dev/null -w "GET /icons/icon192.png → %{http_code}\n" http://localhost:8080/icons/icon192.png
kill $SERVER_PID
cd ..
```

Expected: each route returns `200`. (DB connection errors are tolerable for this smoke-test; only the static-serving paths matter. If the server refuses to start without a real DB, set `DATABASE_URL` to a reachable Postgres or temporarily comment out the `pool` connection check.)

**Step 3:** Commit.

```bash
git add sync-server/
git commit -m "feat(sync-server): serve PWA static files (Branch <A|B from Task B0>)"
```

---

### Task B7: Add install-instruction copy to PWA

**Files:**
- Modify: `pwa/index.html` — add an `<aside>` or collapsible section near the API-key setup view

**Step 1:** Decide placement. The PWA's first-run view is the API-key-setup state (per `pwa/app.js:62` `apiKeyInput`). Add the install-instruction block ABOVE that section so the user sees install guidance before they're asked for an API key.

**Step 2:** Insert this block (adjust selectors to match existing CSS).

```html
<aside class="install-help" id="install-help">
  <h2>Install ToneGuard on your phone</h2>

  <details>
    <summary><strong>Android (Chrome) — 2 taps</strong></summary>
    <p>1. When the "Install ToneGuard" prompt appears at the bottom, tap <strong>Install</strong>.</p>
    <p>2. If the prompt doesn't appear, tap the ⋮ menu in Chrome → <strong>Add to Home Screen</strong> → <strong>Install</strong>.</p>
  </details>

  <details>
    <summary><strong>iPhone (Safari) — 4 taps</strong></summary>
    <p>1. Tap the <strong>Share</strong> button (square with arrow up) at the bottom of Safari.</p>
    <p>2. Scroll down, tap <strong>Add to Home Screen</strong>.</p>
    <p>3. Confirm the name, tap <strong>Add</strong>.</p>
    <p>4. Open ToneGuard from your home screen.</p>
  </details>

  <p><small>Already installed? <a href="javascript:void(0)" onclick="document.getElementById('install-help').style.display='none'">Hide this</a>.</small></p>
</aside>
```

**Step 3:** Style the block minimally (one CSS rule near the existing styles around line 14):

```css
.install-help { padding: 16px; margin: 16px 0; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
.install-help details { margin: 8px 0; }
.install-help summary { cursor: pointer; padding: 4px 0; }
```

**Step 4:** Smoke-test locally — open `pwa/index.html` in a browser, confirm the install block renders and the `<details>` toggles work.

**Step 5:** Commit.

```bash
git add pwa/index.html
git commit -m "feat(pwa): add Android + iOS install instructions to first-run view"
```

---

### Task B8: Ship Stream B PR

**Step 1:** Open PR from `feat/pwa-install-fix` (or whatever branch the worktree is on) to `main`.

```bash
env -u GH_TOKEN gh pr create --title "feat(pwa): make PWA installable on Railway" --body "$(cat <<'EOF'
## Summary
Ships Stream B of [`2026-05-24-free-easy-install-design.md`](../docs/plans/2026-05-24-free-easy-install-design.md). Makes the PWA actually installable on phones by:

- Adding 192×192 + 512×512 PNG icons (required by Android Chrome's auto-install prompt)
- Self-containing all icon paths under `pwa/icons/` (no more `../icons/`)
- Bumping apple-touch-icon to 180px for retina sharpness
- Serving PWA static files from the Railway sync-server (Branch <A|B from Task B0>)
- Adding Android + iOS install instructions to the first-run view

Bumps SW `CACHE_NAME` from `v2` → `v3` to invalidate stale caches on existing installs.

## Test plan
- [x] `node node_modules/.bin/vitest run tests/pwa-install.test.js` → 5 passed
- [x] `node node_modules/.bin/vitest run` → 499 passed (494 baseline + 5 new)
- [x] `node scripts/parity_scan.mjs --check` → exit 0
- [x] `node scripts/generate_shared_artifacts.mjs --check` → exit 0
- [x] Local smoke test: GET /, /manifest.json, /icons/icon192.png all → 200
- [ ] Post-deploy verify on Android Chrome — "Install ToneGuard" prompt fires
- [ ] Post-deploy verify on iOS Safari — home-screen icon renders sharp
EOF
)"
```

**Step 2:** Wait for CI green. Resolve any CodeRabbit findings (filter to authored files only per [CLAUDE.md](../../CLAUDE.md) `coderabbit --base main` note).

**Step 3:** Squash-merge.

```bash
env -u GH_TOKEN gh pr merge --squash --delete-branch
```

---

### Task B9: Verify in production

**Step 1:** Wait for Railway redeploy (auto-deploys on `main` push; check Railway dashboard or `railway logs` for "Listening on port 8080").

**Step 2:** Probe production URL.

```bash
URL="https://sync-server-production-3a24.up.railway.app"
curl -sS -o /dev/null -w "GET / → %{http_code} | %{content_type}\n" "$URL/"
curl -sS -o /dev/null -w "GET /manifest.json → %{http_code} | %{content_type}\n" "$URL/manifest.json"
curl -sS -o /dev/null -w "GET /icons/icon192.png → %{http_code} | %{content_type}\n" "$URL/icons/icon192.png"
curl -sS -o /dev/null -w "GET /icons/icon512.png → %{http_code} | %{content_type}\n" "$URL/icons/icon512.png"
curl -sS -o /dev/null -w "GET /sw.js → %{http_code} | %{content_type}\n" "$URL/sw.js"
curl -sS -o /dev/null -w "GET /healthz → %{http_code} | %{content_type}\n" "$URL/healthz"
```

Expected:
- `/` → `200`, `text/html`
- `/manifest.json` → `200`, `application/json` (or `application/manifest+json`)
- `/icons/icon192.png` → `200`, `image/png`
- `/icons/icon512.png` → `200`, `image/png`
- `/sw.js` → `200`, `application/javascript`
- `/healthz` → `200`, `application/json`

**Step 3:** Phone test (manual).

- Open Railway URL on Android Chrome → "Install ToneGuard" prompt should appear within a few seconds.
- Open on iOS Safari → tap Share → confirm "Add to Home Screen" is available and the icon renders sharp.

**Step 4:** If both verifications pass, Stream B is done. Update the PR description's unchecked boxes to `[x]` via `gh pr edit` (or just close the loop in a comment).

---

## Stream A — Chrome Web Store listing

Ship as second PR after Stream B is verified live. Estimated ~1 week calendar (most of it CWS review wait).

### Task A1: Add failing test for manifest scrub

**Files:**
- Create: `tests/manifest-cws-ready.test.js`

**Step 1:** Write the test.

```javascript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "..", "manifest.json"), "utf8")
);

describe("manifest CWS-readiness", () => {
  it("does not declare personal/SaaS host_permissions", () => {
    const banned = ["turbotenant"];
    for (const pattern of manifest.host_permissions || []) {
      for (const b of banned) {
        expect(pattern.includes(b)).toBe(false);
      }
    }
  });

  it("only declares the canonical public-surface host_permissions", () => {
    const allowed = new Set([
      "https://api.anthropic.com/*",
      "https://*.slack.com/*",
      "https://mail.google.com/*",
      "https://www.linkedin.com/*",
    ]);
    for (const pattern of manifest.host_permissions || []) {
      expect(allowed.has(pattern)).toBe(true);
    }
  });
});
```

**Step 2:** Run, expect 1 failure (turbotenant still present).

```bash
node node_modules/.bin/vitest run tests/manifest-cws-ready.test.js
```

**Step 3:** Commit failing test.

```bash
git add tests/manifest-cws-ready.test.js
git commit -m "test: assert manifest is CWS-review-ready (no personal host_permissions)"
```

---

### Task A2: Scrub `manifest.json` host_permissions

**Files:**
- Modify: `manifest.json:14-19`

**Step 1:** Remove `"https://*.turbotenant.com/*"` from the `host_permissions` array. Final array:

```json
"host_permissions": [
  "https://api.anthropic.com/*",
  "https://*.slack.com/*",
  "https://mail.google.com/*",
  "https://www.linkedin.com/*"
]
```

**Step 2:** Bump `version` field (`0.3.9` → `0.4.0`) — required by repo convention ([CLAUDE.md "Chrome Extension Dev Loop"](../../CLAUDE.md)).

**Step 3:** Run tests.

```bash
node node_modules/.bin/vitest run tests/manifest-cws-ready.test.js
node node_modules/.bin/vitest run  # full baseline
```

Expected: both pass.

**Step 4:** Commit.

```bash
git add manifest.json
git commit -m "feat(ext): scrub turbotenant host_permission; bump v0.3.9 → v0.4.0"
```

---

### Task A3: Rewrite first-run BYOK copy in popup

**Files:**
- Modify: `popup.html` (first-run / no-API-key state)
- Optional: `popup.js` if copy is rendered dynamically

**Step 1:** Read current popup first-run state.

```bash
grep -n -i 'api.key\|anthropic\|setup\|onboard\|first.run\|no.key' popup.html popup.js | head -20
```

**Step 2:** Replace with non-technical copy. New block (adapt to existing CSS classes):

```html
<section class="setup-step">
  <h2>One-time setup</h2>
  <p>ToneGuard uses Anthropic's Claude to check your messages. You'll need a free Anthropic account and an API key. ToneGuard never sees your key — it stays in this browser.</p>

  <ol>
    <li>Open <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a> and create an account.</li>
    <li>Go to <strong>Settings → API Keys</strong>, click <strong>Create Key</strong>, and copy it.</li>
    <li>Paste it below. Most users spend $1–3/month.</li>
  </ol>

  <label for="apiKeyInput">Your Anthropic API key</label>
  <input id="apiKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off">

  <button id="saveKey">Save key</button>
  <p class="muted small">Your key is stored locally and sent only to Anthropic when checking messages.</p>
</section>
```

**Step 3:** Manual test — load extension in `chrome://extensions` (unpacked), confirm the popup first-run state renders with the new copy.

**Step 4:** Commit.

```bash
git add popup.html popup.js
git commit -m "feat(ext): non-technical BYOK onboarding copy in popup first-run state"
```

---

### Task A4: Polish `STORE_DESCRIPTION.md` for submission

**Files:**
- Modify: `STORE_DESCRIPTION.md`
- Add: `docs/store-assets/screenshot-{1,2,3,4,5}.png`, `docs/store-assets/promo-tile.png` (or `STORE_ASSETS_TODO.md` if assets are produced outside Claude)

**Step 1:** Review current `STORE_DESCRIPTION.md`. Add missing pieces:

- A **privacy policy URL** (CWS requires this). Either host a standalone privacy page or use the GitHub raw URL of `PRIVACY.md`.
- A **support / contact URL** (CWS requires this). Use the GitHub issues URL.
- **Permissions justification** — 1-2 sentences per host_permission explaining why the extension needs it. CWS reviewers ask for this.

**Step 2:** Add a small section near the bottom listing the required CWS submission assets:

```markdown
## CWS Submission Assets

- [ ] Promo tile 440×280 or 1400×560 PNG
- [ ] 1-5 screenshots, 1280×800 or 640×400 PNG
- [ ] Privacy policy URL: <fill in>
- [ ] Support contact URL: https://github.com/sumrae412/toneguard/issues
- [ ] Permissions justification (paste in CWS form):
  - storage — store user's API key and settings locally
  - activeTab + scripting — read and modify the message being composed on Slack/Gmail/LinkedIn
  - contextMenus — provide right-click "Check this message" shortcut
  - host_permissions — call Anthropic API; intercept sends on Slack/Gmail/LinkedIn
```

**Step 3:** Commit.

```bash
git add STORE_DESCRIPTION.md
git commit -m "docs: polish STORE_DESCRIPTION for CWS submission"
```

---

### Task A5: Ship Stream A PR

**Step 1:** Open PR.

```bash
env -u GH_TOKEN gh pr create --title "feat(ext): CWS submission readiness" --body "$(cat <<'EOF'
## Summary
Ships Stream A of [`2026-05-24-free-easy-install-design.md`](../docs/plans/2026-05-24-free-easy-install-design.md). Makes the Chrome extension ready for Chrome Web Store submission:

- Scrubs personal `turbotenant` host_permission (would be questioned in review)
- Rewrites first-run popup with non-technical BYOK onboarding copy
- Polishes `STORE_DESCRIPTION.md` with privacy/support URLs + permissions justification + asset checklist
- Bumps manifest version `0.3.9` → `0.4.0`

## Test plan
- [x] `node node_modules/.bin/vitest run tests/manifest-cws-ready.test.js` → 2 passed
- [x] `node node_modules/.bin/vitest run` → all green
- [x] Manual load in `chrome://extensions` — popup renders new first-run copy
- [ ] Store assets produced (screenshots, promo tile) — TODO before CWS submit, tracked in `STORE_DESCRIPTION.md`
EOF
)"
```

**Step 2:** Resolve CI / CodeRabbit, squash-merge.

```bash
env -u GH_TOKEN gh pr merge --squash --delete-branch
```

---

### Task A6: Submit to CWS

This task happens outside Claude (requires the Chrome Web Store dashboard, screenshots, and a $5 dev account). Plan-level checklist:

1. Pay $5 dev account fee (one-time) at `https://chrome.google.com/webstore/devconsole`.
2. Produce 1-5 screenshots (1280×800 or 640×400 PNG) — use Claude's `mcp__computer-use__screenshot` if helpful, or capture manually.
3. Produce a promo tile (440×280 PNG).
4. Build the zip: `npm run build` (creates `toneguard-0.4.0.zip` per `package.json`).
5. Upload zip + assets + paste content from `STORE_DESCRIPTION.md` into CWS dashboard.
6. Submit for review. Typical wait: 1-3 days.
7. On approval, update `README.md`'s "install from source" section to point at the CWS listing URL. Ship that as a doc-only commit direct to main (per repo convention).

---

## Plan complete

Plan saved to `docs/plans/2026-05-24-free-easy-install-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — open a new session in a worktree with `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
