// ToneGuard PWA — Android share target + manual paste
// Talks directly to the Anthropic API using a locally-stored key.

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const STORAGE_KEY = "toneguard_api_key";

// Sync manager (initialized when API key is available)
let pwaSyncManager = null;

async function initPwaSync() {
  const apiKey = localStorage.getItem(STORAGE_KEY);
  if (!apiKey || pwaSyncManager) return;

  try {
    const storage = new globalThis.__toneGuardStorage.WebStorageAdapter();
    const supabase = new globalThis.__toneGuardSupabase.ToneGuardSupabase();
    const merge = globalThis.__toneGuardMerge;

    pwaSyncManager = new globalThis.__toneGuardSync.SyncManager(storage, supabase, merge);
    await pwaSyncManager.init(apiKey);
  } catch (err) {
    console.warn("ToneGuard PWA: sync init failed", err.message);
  }
}

async function logPwaDecision(decision) {
  decision.timestamp = new Date().toISOString();

  try {
    const raw = localStorage.getItem("tg_decisions");
    const decisions = raw ? JSON.parse(raw) : [];
    decisions.push(decision);
    if (decisions.length > 100) decisions.splice(0, decisions.length - 100);
    localStorage.setItem("tg_decisions", JSON.stringify(decisions));

    if (pwaSyncManager) pwaSyncManager.schedulePush("decisions");
  } catch (err) {
    console.warn("ToneGuard PWA: failed to log decision", err);
  }
}

async function savePwaVoiceSample(text) {
  if (!text || text.length < 30) return;

  try {
    const raw = localStorage.getItem("tg_voice_samples");
    const samples = raw ? JSON.parse(raw) : [];
    samples.push({ text: text.slice(0, 300), timestamp: new Date().toISOString() });
    if (samples.length > 30) samples.splice(0, samples.length - 30);
    localStorage.setItem("tg_voice_samples", JSON.stringify(samples));

    if (pwaSyncManager) pwaSyncManager.schedulePush("voice_samples");
  } catch (err) {
    console.warn("ToneGuard PWA: failed to save voice sample", err);
  }
}

// ── Elements ──
const setupView = document.getElementById("setupView");
const mainView = document.getElementById("mainView");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");

const messageInput = document.getElementById("messageInput");
const checkBtn = document.getElementById("checkBtn");
const inputArea = document.getElementById("inputArea");
const loading = document.getElementById("loading");
const passed = document.getElementById("passed");
const result = document.getElementById("result");
const badge = document.getElementById("badge");

const reasoning = document.getElementById("reasoning");
const confidenceFill = document.getElementById("confidenceFill");
const metaRow = document.getElementById("metaRow");
const readability = document.getElementById("readability");
const categories = document.getElementById("categories");
const redFlags = document.getElementById("redFlags");
const flagsList = document.getElementById("flagsList");
const diffSection = document.getElementById("diffSection");
const diffView = document.getElementById("diffView");
const originalSection = document.getElementById("originalSection");
const originalText = document.getElementById("originalText");
const suggestionText = document.getElementById("suggestionText");

const copyBtn = document.getElementById("copyBtn");
const copyOriginalBtn = document.getElementById("copyOriginalBtn");
const newCheckBtn = document.getElementById("newCheckBtn");
const copyFeedback = document.getElementById("copyFeedback");

// ── Init ──
function init() {
  const apiKey = localStorage.getItem(STORAGE_KEY);

  if (apiKey) {
    showMain();
  } else {
    showSetup();
  }

  // Check if launched via share target
  const params = new URLSearchParams(window.location.search);
  const sharedText = params.get("text") || "";
  if (sharedText && apiKey) {
    messageInput.value = sharedText;
    // Auto-check when opened via share
    setTimeout(() => analyze(), 100);
  }

  // Clean URL
  if (window.location.search) {
    history.replaceState(null, "", window.location.pathname);
  }
}

// ── Views ──
function showSetup() {
  setupView.style.display = "block";
  mainView.style.display = "none";
}

function showMain() {
  setupView.style.display = "none";
  mainView.style.display = "flex";
  mainView.style.flexDirection = "column";
}

function showInput() {
  inputArea.style.display = "flex";
  loading.classList.remove("visible");
  passed.classList.remove("visible");
  result.classList.remove("visible");
  badge.style.display = "none";
}

function showLoading() {
  inputArea.style.display = "none";
  loading.classList.add("visible");
  passed.classList.remove("visible");
  result.classList.remove("visible");
  badge.style.display = "none";
}

function showPassed() {
  loading.classList.remove("visible");
  inputArea.style.display = "none";
  passed.classList.add("visible");
  result.classList.remove("visible");

  setTimeout(() => {
    showInput();
    messageInput.value = "";
    messageInput.focus();
  }, 2500);
}

function showResult(data) {
  loading.classList.remove("visible");
  inputArea.style.display = "none";
  passed.classList.remove("visible");
  result.classList.add("visible");

  // Badge
  if (data.mode === "polish") {
    badge.textContent = "Polish";
    badge.className = "badge polish";
  } else if (data.mode === "both") {
    badge.textContent = "Tone + Polish";
    badge.className = "badge both";
  } else {
    badge.textContent = "Tone";
    badge.className = "badge tone";
  }

  // Reasoning
  reasoning.textContent = data.reasoning || "";

  // Confidence
  const conf = data.confidence || 0;
  confidenceFill.style.width = (conf * 100) + "%";
  confidenceFill.className = "confidence-fill " +
    (conf >= 0.9 ? "high" : conf >= 0.6 ? "medium" : "low");

  // Readability + categories
  categories.textContent = "";
  if (data.readability || (data.categories && data.categories.length)) {
    metaRow.classList.add("visible");
    if (data.readability) {
      const g = data.readability;
      readability.textContent = "Grade " + g;
      readability.className = "readability-chip " +
        (g <= 9 ? "good" : g <= 12 ? "medium" : "hard");
      readability.style.display = "inline-block";
    } else {
      readability.style.display = "none";
    }
    if (data.categories) {
      for (const cat of data.categories) {
        const chip = document.createElement("span");
        chip.className = "category-chip";
        chip.textContent = cat;
        categories.appendChild(chip);
      }
    }
  } else {
    metaRow.classList.remove("visible");
  }

  // Red flags
  flagsList.textContent = "";
  if (data.red_flags && data.red_flags.length) {
    redFlags.classList.add("visible");
    for (const flag of data.red_flags) {
      const chip = document.createElement("span");
      chip.className = "flag-chip";
      chip.textContent = flag;
      flagsList.appendChild(chip);
    }
  } else {
    redFlags.classList.remove("visible");
  }

  // Diff view
  const original = data._original;
  const suggestion = data.suggestion || "";
  diffView.textContent = "";
  if (original && suggestion && original !== suggestion) {
    const segments = wordDiff(original, suggestion);
    for (const seg of segments) {
      const span = document.createElement("span");
      span.textContent = seg.text;
      if (seg.type === "removed") span.className = "diff-removed";
      else if (seg.type === "added") span.className = "diff-added";
      diffView.appendChild(span);
    }
    diffSection.style.display = "block";
    originalSection.style.display = "none";
  } else {
    diffSection.style.display = "none";
    originalSection.style.display = "block";
  }

  originalText.textContent = original;
  suggestionText.textContent = suggestion;
}

// ── API Key ──
saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Please enter an API key.";
    keyStatus.className = "key-status error";
    return;
  }
  if (!key.startsWith("sk-ant-")) {
    keyStatus.textContent = "API keys start with sk-ant-.";
    keyStatus.className = "key-status error";
    return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  keyStatus.textContent = "Saved!";
  keyStatus.className = "key-status saved";
  showMain();
  messageInput.focus();
  initPwaSync();
});

// ── Check ──
checkBtn.addEventListener("click", analyze);
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyze();
});

async function analyze() {
  const text = messageInput.value.trim();
  if (!text || text.length < 10) return;

  const apiKey = localStorage.getItem(STORAGE_KEY);
  if (!apiKey) { showSetup(); return; }

  showLoading();

  try {
    const systemPrompt = getSystemPrompt();

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: "Review this message before sending:\n\n" + text }]
        })
      });

      if (response.status === 401 || response.status === 400 || response.status === 403) break;
      if (response.ok || response.status < 500) break;

      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    if (!response.ok) {
      const errBody = await response.text();
      showInput();
      alert(getFriendlyError(response.status, errBody));
      return;
    }

    const data = await response.json();
    const rawContent = data.content[0]?.text || "";
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      showPassed();
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.flagged) {
      savePwaVoiceSample(text);
      showPassed();
      return;
    }

    parsed._original = text;
    showResult(parsed);

    // Store the original text for decision logging
    window._lastAnalyzedText = text;

  } catch (err) {
    showInput();
    if (err.message && err.message.includes("Failed to fetch")) {
      alert("Network error. Check your internet connection.");
    } else {
      alert("Error: " + err.message);
    }
  }
}

// ── Copy buttons ──
copyBtn.addEventListener("click", () => {
  const text = suggestionText.textContent;
  copyToClipboard(text, "Suggestion copied! Switch back to your app and paste.");

  logPwaDecision({
    action: "used_suggestion",
    original: window._lastAnalyzedText || "",
    suggestion: text,
    finalText: ""
  });
});

copyOriginalBtn.addEventListener("click", () => {
  const text = originalText.textContent;
  copyToClipboard(text, "Original copied!");

  logPwaDecision({
    action: "sent_original",
    original: text,
    suggestion: suggestionText.textContent || "",
    finalText: ""
  });
});

newCheckBtn.addEventListener("click", () => {
  showInput();
  messageInput.value = "";
  messageInput.focus();
});

function copyToClipboard(text, message) {
  navigator.clipboard.writeText(text).then(() => {
    copyFeedback.textContent = message;
    setTimeout(() => { copyFeedback.textContent = ""; }, 3000);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    copyFeedback.textContent = message;
    setTimeout(() => { copyFeedback.textContent = ""; }, 3000);
  });
}

// ── Word diff (same algorithm as overlay.js) ──
function wordDiff(oldText, newText) {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);
  const m = oldWords.length;
  const n = newWords.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const stack = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      stack.push({ type: "same", text: oldWords[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "added", text: newWords[j - 1] });
      j--;
    } else {
      stack.push({ type: "removed", text: oldWords[i - 1] });
      i--;
    }
  }
  stack.reverse();

  const segments = [];
  for (const seg of stack) {
    if (segments.length > 0 && segments[segments.length - 1].type === seg.type) {
      segments[segments.length - 1].text += seg.text;
    } else {
      segments.push({ type: seg.type, text: seg.text });
    }
  }
  return segments;
}

// ── System prompt (condensed version of prompts/base.txt) ──
function getSystemPrompt() {
  return `You are ToneGuard, a writing assistant that checks messages for tone and clarity issues before sending.

Your job has three parts:
1. TONE: Catch messages that sound harsh, accusatory, passive-aggressive, defensive, guilt-trippy, or negative.
2. CLARITY: Catch messages that are vague, ambiguous, or could be misread. Flag missing context, unclear references, hedging that buries the point, and rambling phrasing.
3. PROFESSIONALISM: Catch messages that are sloppy, incoherent, or would make the sender look unprofessional.

IMPORTANT: When in doubt, FLAG IT. The user can always dismiss your suggestion.

When you DO rewrite:
- One idea per sentence
- Put what happened first, then why
- Short sentences over long ones
- No em dashes (use periods or commas)
- Assume good intent. Frame things as miscommunication, not mistakes
- Make clear requests — say what you want going forward
- Be direct and compassionate at the same time

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "flagged": boolean,
  "confidence": number 0-1,
  "mode": "tone" | "polish" | "both",
  "readability": number (grade level),
  "red_flags": ["quoted phrases from the message that are problematic"],
  "categories": ["short labels for issue types found"],
  "reasoning": "1-2 sentence explanation of what's wrong",
  "suggestion": "the rewritten message"
}

If the message is fine, return: {"flagged": false}`;
}

// ── Friendly errors ──
function getFriendlyError(status, body) {
  switch (status) {
    case 401: return "Invalid API key. Tap the header to update it.";
    case 403: return "API key doesn't have permission. Check console.anthropic.com.";
    case 429: return "Rate limit reached. Wait a moment and try again.";
    case 400:
      if (body && body.includes("credit")) return "No API credits remaining.";
      return "Bad request. The message may be too long.";
    case 500: case 502: case 503:
      return "Anthropic's API is temporarily unavailable. Try again shortly.";
    default:
      return "API error (" + status + "). Try again.";
  }
}

// ── Register service worker ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ── Start ──
init();
initPwaSync();
