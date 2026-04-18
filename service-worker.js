// ToneGuard Service Worker
// Handles Claude API calls for message analysis.
// Prompt loaded from prompts/base.txt + dynamic runtime sections.

importScripts(
  "lib.js",
  "src/sync/merge.js",
  "src/sync/storage-adapter.js",
  "src/sync/supabase-client.js",
  "src/sync/sync-manager.js"
);

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

// Cache the base prompt after first load
let basePromptCache = null;

// Sync manager (initialized once API key is available)
let syncManager = null;

async function initSync() {
  if (syncManager) return;

  const { tg_api_key: apiKey } = await chrome.storage.sync.get(["tg_api_key"]);
  if (!apiKey) return;

  const storage = new globalThis.__toneGuardStorage.ChromeStorageAdapter();
  const supabase = new globalThis.__toneGuardSupabase.ToneGuardSupabase();
  const merge = globalThis.__toneGuardMerge;

  syncManager = new globalThis.__toneGuardSync.SyncManager(storage, supabase, merge);
  syncManager.onConflict = (type, msg) => {
    console.log("ToneGuard sync conflict:", type, msg);
  };

  await syncManager.init(apiKey);
}

async function loadBasePrompt() {
  if (basePromptCache) return basePromptCache;

  try {
    const url = chrome.runtime.getURL("prompts/base.txt");
    const response = await fetch(url);
    basePromptCache = await response.text();
  } catch (err) {
    console.error("ToneGuard: failed to load base prompt", err);
    // Don't cache the fallback — allow retry on next call
    return "You are ToneGuard, a writing assistant. Check messages for tone and clarity. Respond with JSON: {flagged, confidence, mode, readability, red_flags, categories, reasoning, suggestion, has_questions, questions}.";
  }
  return basePromptCache;
}

// On install/startup, register content scripts for custom sites + context menu
chrome.runtime.onInstalled.addListener((details) => {
  registerCustomSites();
  createContextMenu();

  // Show welcome page on first install
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});
chrome.runtime.onStartup.addListener(() => {
  registerCustomSites();
  createContextMenu();
  initSync();
});

// Permission grants from the popup can race with the popup closing (Chrome
// dismisses the popup when the native permission dialog opens, destroying
// the popup's JS context before its .then() can send REGISTER_SITE).
// Re-register here so newly granted host permissions always take effect.
chrome.permissions.onAdded.addListener(() => {
  registerCustomSites();
});

// --- Context Menu (Step 7) ---

function createContextMenu() {
  // removeAll() before create() — on extension reload, the menu item from the
  // previous install may still exist. Without this, re-registering throws:
  //   "Cannot create item with duplicate id toneguard-analyze"
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "toneguard-analyze",
      title: "Check tone with ToneGuard",
      contexts: ["selection"]
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "toneguard-analyze") return;
  if (!tab?.id || !info.selectionText) return;

  // Inject content + overlay scripts if not already present, then send message
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib.js", "overlay.js", "content.js"]
    });
  } catch (_) {
    // Scripts may already be injected — that's fine
  }

  chrome.tabs.sendMessage(tab.id, {
    type: "ANALYZE_SELECTION",
    text: info.selectionText
  });
});

async function registerCustomSites() {
  const { tg_custom_sites: sites } = await chrome.storage.sync.get(["tg_custom_sites"]);

  // Always try to unregister first (Step 8: wrap in try-catch so failure doesn't block re-register)
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["tg-custom-sites"] });
  } catch (_) {
    // No existing scripts registered — that's fine, proceed
  }

  if (!sites || sites.length === 0) return;

  const patterns = sites.flatMap((site) => [
    "https://" + site + "/*",
    "https://*." + site + "/*"
  ]);

  try {
    await chrome.scripting.registerContentScripts([{
      id: "tg-custom-sites",
      matches: patterns,
      js: ["lib.js", "overlay.js", "content.js"],
      runAt: "document_idle"
    }]);
  } catch (err) {
    console.error("ToneGuard: failed to register custom sites", err);
    return;
  }

  // Step 8: Inject into already-open tabs that match the new patterns
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib.js", "overlay.js", "content.js"]
      }).catch(() => {
        // Tab may not be injectable (e.g., chrome:// pages)
      });
    }
  } catch (_) {
    // tabs.query may fail if patterns are invalid — non-fatal
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ANALYZE") {
    handleAnalyze(message.text, message.context, message.site)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "REFINE") {
    handleRefine(message.original, message.answers)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SYNC_PUSH") {
    if (syncManager) syncManager.schedulePush(message.dataType);
    return false;
  }

  if (message.type === "SYNC_STATUS") {
    sendResponse({
      connected: !!syncManager,
      lastSyncAt: syncManager?.lastSyncAt || null
    });
    return true;
  }

  if (message.type === "SYNC_PULL") {
    if (syncManager) {
      syncManager.pull()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: err.message }));
    } else {
      initSync()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: err.message }));
    }
    return true;
  }

  if (message.type === "REGISTER_SITE" || message.type === "UNREGISTER_SITE") {
    // Re-register content scripts for custom sites.
    // chrome.permissions.request() is called from the popup (user gesture context),
    // not here — service workers can't request permissions.
    registerCustomSites()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (message.type === "TRAIN_VOICE") {
    // Batch-insert pasted samples as source="trained". Called from
    // options.js when the user hits "Save training samples".
    (async () => {
      const samples = Array.isArray(message.samples) ? message.samples : [];
      let accepted = 0;
      let rejected = 0;
      for (const text of samples) {
        if (typeof text !== "string") { rejected++; continue; }
        const ok = await saveVoiceSample(text, "trained");
        if (ok) accepted++; else rejected++;
      }
      const stored = await getVoiceSamples();
      const trainedTotal = stored.filter((s) => s.source === "trained").length;
      sendResponse({ accepted, rejected, trained_total: trainedTotal });
    })();
    return true;
  }

  if (message.type === "GET_VOICE_PROFILE") {
    (async () => {
      const samples = await getVoiceSamples();
      const { tg_voice_fingerprint: fingerprint } = await chrome.storage.local.get([
        "tg_voice_fingerprint"
      ]);
      sendResponse({
        trained_samples: samples.filter((s) => s.source === "trained"),
        auto_samples: samples.filter((s) => s.source !== "trained"),
        fingerprint: fingerprint || null
      });
    })();
    return true;
  }

  if (message.type === "DELETE_VOICE_SAMPLE") {
    deleteVoiceSample(message.timestamp)
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "REGENERATE_FINGERPRINT") {
    regenerateVoiceFingerprint()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function handleAnalyze(text, context, site) {
  if (!text || text.trim().length < 10) {
    return { flagged: false };
  }

  const { tg_api_key: apiKey, tg_enabled: enabled, tg_strictness: strictness } =
    await chrome.storage.sync.get(["tg_api_key", "tg_enabled", "tg_strictness"]);

  if (enabled === false) {
    return { flagged: false };
  }

  if (!apiKey) {
    return { error: "No API key set. Click the ToneGuard icon to add one." };
  }

  // Build full prompt: base file + dynamic sections
  const basePrompt = await loadBasePrompt();
  const learnedExamples = await getLearnedExamples();
  const customRules = await getCustomRules();
  let fullPrompt = basePrompt;

  // Per-site strictness: supports { default: 2, slack: 3, gmail: 1 } or plain number (backward compat)
  let strictLevel = 2;
  if (typeof strictness === "object" && strictness !== null) {
    strictLevel = (site && strictness[site]) ?? strictness.default ?? 2;
  } else {
    strictLevel = strictness || 2;
  }
  if (strictLevel === 1) {
    fullPrompt += "\n\nSTRICTNESS: GENTLE. Only flag messages that are clearly problematic. Let borderline messages through. When in doubt, don't flag.";
  } else if (strictLevel === 3) {
    fullPrompt += "\n\nSTRICTNESS: STRICT. Flag anything that could be improved. Be thorough. The user wants to catch everything.";
  }

  if (customRules) {
    fullPrompt += "\n\nUSER-ADDED RULES:\n" + customRules;
  }

  if (learnedExamples) {
    fullPrompt += "\n\nLEARNED FROM PAST DECISIONS (use these to calibrate):\n" + learnedExamples;
  }

  const voiceContext = await getVoiceContext();
  if (voiceContext) {
    fullPrompt += "\n\n" + voiceContext;
  }

  const relationshipContext = await getRelationshipContext(text);
  if (relationshipContext) {
    fullPrompt += "\n\n" + relationshipContext;
  }

  await saveRecipientInteraction(text);

  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    system: fullPrompt,
    messages: [
      {
        role: "user",
        content: context
          ? context + "\n\nMESSAGE TO REVIEW (about to be sent):\n" + text
          : "Review this message before sending:\n\n" + text
      }
    ]
  });

  const requestHeaders = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  };

  try {
    // Run the main tone/clarity analysis and the landing critic in parallel.
    // Landing is descriptive ("how this reads on a skim"), Haiku-tier, and
    // must NOT block the main result — a landing failure returns null and
    // the rewrite path keeps working.
    const [response, landing] = await Promise.all([
      (async () => {
        let r;
        for (let attempt = 0; attempt < 3; attempt++) {
          r = await fetch(CLAUDE_API_URL, {
            method: "POST",
            headers: requestHeaders,
            body: requestBody
          });
          if (r.status === 401 || r.status === 400 || r.status === 403) break;
          if (r.ok || r.status < 500) break;
          const delay = Math.pow(2, attempt) * 500;
          await new Promise((rs) => setTimeout(rs, delay));
        }
        return r;
      })(),
      callLandingCritic(text, context, apiKey).catch((err) => {
        console.warn("ToneGuard landing critic failed:", err && err.message ? err.message : err);
        return null;
      })
    ]);

    if (!response.ok) {
      const errBody = await response.text();
      const friendlyError = getFriendlyApiError(response.status, errBody);
      console.error("ToneGuard API error:", response.status, errBody);
      return { flagged: false, error: friendlyError };
    }

    const data = await response.json();
    const rawContent = data.content[0]?.text || "";

    // parseApiResponse (from lib.js) handles markdown fences, surrounding
    // text, and literal control chars inside string values. Returns null on
    // unrecoverable parse failure — don't silently pass through.
    const result = parseApiResponse(rawContent);
    if (!result) {
      console.error("ToneGuard: could not parse JSON from response:", rawContent);
      return { flagged: false, error: "Response parse error — message sent without checking." };
    }

    await trackStats(result.flagged, result.mode);

    if (!result.flagged) {
      await saveVoiceSample(text);
    }

    // Attach landing view. Null when the call failed or the message was
    // too short — the overlay hides the panel in both cases.
    if (landing) result.landing = landing;

    return result;

  } catch (err) {
    console.error("ToneGuard analysis error:", err);
    if (err.message && err.message.includes("Failed to fetch")) {
      return { flagged: false, error: "Network error — check your internet connection and try again." };
    }
    return { flagged: false, error: err.message };
  }
}

// Landing critic — descriptive "how does this read on a skim" analysis.
// Runs in parallel with handleAnalyze's main Claude call. Haiku-tier,
// ~$0.002 per call. Returns {takeaway, tone_felt, next_action} (any
// may be null) or null on failure / short message.
//
// The prompt mirrors critics/landing.md in the MCP server — keep them
// in sync if this one changes.
const LANDING_SYSTEM_PROMPT = (
  "You are a 'message landing' analyst. Read a message as if you were the " +
  "recipient skimming it once — no re-reads, no charitable interpretation — " +
  "and report what they'd actually walk away with.\n\n" +
  "This is NOT a rewrite or critique. You do NOT flag issues.\n\n" +
  "Return JSON with exactly three fields:\n" +
  "- takeaway: one short sentence (<=20 words), the single idea the " +
  "recipient would carry away\n" +
  "- tone_felt: 2-3 words (e.g. 'rushed and curt', 'warm but vague')\n" +
  "- next_action: what the recipient would think they're being asked to do " +
  "next, OR null if nothing is being asked. Phrase as an imperative from " +
  "their POV ('approve the PR', 'reply with a time', 'just read it').\n\n" +
  "Rules: Report how it LANDS, not how it was INTENDED. Do not praise. " +
  "Do not suggest improvements. For messages <10 words, return " +
  '{"takeaway": null, "tone_felt": null, "next_action": null}.\n\n' +
  "Return ONLY the JSON object, no prefatory text, no markdown fences."
);

async function callLandingCritic(text, context, apiKey) {
  if (!text || text.trim().split(/\s+/).length < 10) {
    return { takeaway: null, tone_felt: null, next_action: null };
  }

  const userContent =
    "## Message\n\n" + text + (context ? "\n\n## Context\n\n" + context : "");

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: LANDING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    })
  });

  if (!response.ok) {
    throw new Error("landing api " + response.status);
  }

  const data = await response.json();
  const raw = (data.content && data.content[0] && data.content[0].text) || "";
  const parsed = parseApiResponse(raw);
  if (!parsed) return null;
  // Normalize: only keep the three known fields
  return {
    takeaway: parsed.takeaway || null,
    tone_felt: parsed.tone_felt || null,
    next_action: parsed.next_action || null
  };
}

function getFriendlyApiError(status, body) {
  switch (status) {
    case 401:
      return "Invalid API key. Open ToneGuard settings and check your key.";
    case 403:
      return "API key doesn't have permission. Check your key's access level at console.anthropic.com.";
    case 429:
      return "Rate limit reached. Wait a moment and try again, or check your Anthropic usage limits.";
    case 400: {
      if (body && body.includes("credit")) {
        return "No API credits remaining. Add credits at console.anthropic.com.";
      }
      return "Bad request — the message may be too long. Try shortening it.";
    }
    case 500:
    case 502:
    case 503:
      return "Anthropic's API is temporarily unavailable. Your message was sent without checking.";
    default:
      return "API error (" + status + "). Your message was sent without checking.";
  }
}

// Build learned examples from past decisions
async function getLearnedExamples() {
  const { tg_decisions: decisions } = await chrome.storage.local.get(["tg_decisions"]);
  if (!decisions || decisions.length === 0) return "";

  const examples = [];

  const falsePositives = decisions
    .filter((d) => d.action === "sent_original")
    .slice(-3);

  for (const d of falsePositives) {
    examples.push('FALSE POSITIVE (do NOT flag similar messages):\n  Message: "' + d.original + '"');
  }

  const edited = decisions
    .filter((d) => d.action === "used_edited")
    .slice(-3);

  for (const d of edited) {
    examples.push('GOOD CATCH, BETTER REWRITE (learn from user version):\n  Original: "' + d.original + '"\n  Your suggestion: "' + d.suggestion + '"\n  User preferred: "' + d.finalText + '"');
  }

  const accepted = decisions
    .filter((d) => d.action === "used_suggestion")
    .slice(-3);

  for (const d of accepted) {
    examples.push('GOOD EXAMPLE (user accepted):\n  Original: "' + d.original + '"\n  Rewrite: "' + d.suggestion + '"');
  }

  return examples.join("\n\n");
}

async function getCustomRules() {
  const { tg_custom_rules: rules } = await chrome.storage.sync.get(["tg_custom_rules"]);
  return rules || "";
}

// Voice sample storage with per-source caps.
//
// Two sources:
//   - "auto": silently collected from user's accepted messages (background call)
//   - "trained": pasted via the options-page "Train your voice" section
// Trained samples take precedence in the rewriter's context (see
// getVoiceContext below and the MCP analyzer's _build_voice_section).
const VOICE_SAMPLE_MIN_CHARS = 30;
const VOICE_SAMPLE_CAP_TRAINED = 15;
const VOICE_SAMPLE_CAP_AUTO = 30;

async function saveVoiceSample(text, source = "auto") {
  if (!text || text.length < VOICE_SAMPLE_MIN_CHARS) return false;
  if (source !== "trained") source = "auto";

  const { tg_voice_samples: existing } = await chrome.storage.local.get(["tg_voice_samples"]);
  const samples = existing || [];

  // Dedupe on text content. Trained upgrades over auto; same-source just
  // refreshes the timestamp.
  const trimmed = text.slice(0, 300).trim();
  const existingSample = samples.find((s) => (s.text || "").trim() === trimmed);
  const now = new Date().toISOString();
  if (existingSample) {
    if (source === "trained" || existingSample.source === "trained") {
      existingSample.source = "trained";
    } else if (!existingSample.source) {
      existingSample.source = "auto";
    }
    existingSample.timestamp = now;
  } else {
    samples.push({ text: trimmed, source, timestamp: now });
  }

  // Per-source eviction (oldest-first within each source bucket). Keeps
  // trained samples safe from auto-collection churn.
  const trained = samples.filter((s) => s.source === "trained");
  const auto = samples.filter((s) => s.source !== "trained");
  trained.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  auto.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  const keptTrained = trained.slice(-VOICE_SAMPLE_CAP_TRAINED);
  const keptAuto = auto.slice(-VOICE_SAMPLE_CAP_AUTO);
  const merged = [...keptTrained, ...keptAuto].sort(
    (a, b) => (a.timestamp || "").localeCompare(b.timestamp || "")
  );

  await chrome.storage.local.set({ tg_voice_samples: merged });

  if (syncManager) syncManager.schedulePush("voice_samples");
  return true;
}

async function getVoiceSamples() {
  const { tg_voice_samples: samples } = await chrome.storage.local.get(["tg_voice_samples"]);
  return samples || [];
}

async function deleteVoiceSample(timestamp) {
  const samples = await getVoiceSamples();
  const filtered = samples.filter((s) => s.timestamp !== timestamp);
  await chrome.storage.local.set({ tg_voice_samples: filtered });
  if (syncManager) syncManager.schedulePush("voice_samples");
  return filtered.length !== samples.length;
}

// Generate a compressed style fingerprint from the user's trained samples.
// Sonnet-tier (one-shot summarization called infrequently, so cost is low).
// Mirrors toneguard-mcp/analyzer.py:generate_fingerprint — keep the prompt
// in sync between the two if this one changes.
async function regenerateVoiceFingerprint() {
  const { tg_api_key: apiKey } = await chrome.storage.sync.get(["tg_api_key"]);
  if (!apiKey) return { ok: false, error: "No API key set. Open the popup to add one." };

  const samples = await getVoiceSamples();
  const trained = samples
    .filter((s) => s.source === "trained" && s.text && s.text.trim().length >= 10)
    .map((s) => s.text.trim());
  if (trained.length < 3) {
    return {
      ok: false,
      error: "Add at least 3 trained samples before generating a style profile (currently " + trained.length + ")."
    };
  }

  const samplesBlock = trained.map((t) => "---\n" + t + "\n---").join("\n\n");
  const prompt =
    "You are a writing coach analyzing samples of one person's writing " +
    "to extract their personal style. Produce a compact, reusable style " +
    "fingerprint that another writer could follow to sound like this person.\n\n" +
    "## Samples\n\n" + samplesBlock + "\n\n" +
    "## Your Task\n\n" +
    "Return ONLY a markdown block with these exact section headings, each " +
    "filled with 1-3 bullet observations grounded in the samples. No preamble, " +
    "no explanations, no hedging. If a section genuinely has no signal from " +
    "the samples, write `- (no clear pattern)` \u2014 don't invent patterns.\n\n" +
    "### Tone defaults\n### Preferred phrasings\n### Avoided phrasings\n" +
    "### Formality register\n### Opening and closing patterns";

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: "API error " + response.status + ": " + body.slice(0, 200) };
    }

    const data = await response.json();
    const text = ((data.content && data.content[0] && data.content[0].text) || "").trim();
    if (!text) return { ok: false, error: "Empty fingerprint response" };

    const fingerprint = {
      text,
      updatedAt: new Date().toISOString(),
      sample_count: trained.length
    };
    await chrome.storage.local.set({ tg_voice_fingerprint: fingerprint });
    if (syncManager) syncManager.schedulePush("voice_fingerprint");

    return { ok: true, fingerprint: text, sample_count: trained.length };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function getVoiceContext() {
  const samples = await getVoiceSamples();
  if (!samples.length) return "";

  // If a derived fingerprint exists and the user has ≥3 trained samples,
  // prefer the fingerprint (sharper signal, ~200 tokens) over raw samples.
  const { tg_voice_fingerprint: fingerprint } = await chrome.storage.local.get([
    "tg_voice_fingerprint"
  ]);
  const trainedCount = samples.filter((s) => s.source === "trained").length;
  if (fingerprint && fingerprint.text && trainedCount >= 3) {
    return "VOICE FINGERPRINT (match this style in rewrites):\n" + fingerprint.text;
  }

  // Trained samples take priority up to 5; fill with auto from the tail.
  const trained = samples.filter((s) => s.source === "trained");
  const auto = samples.filter((s) => s.source !== "trained");
  const pickedTrained = trained.slice(-5);
  const remaining = Math.max(0, 5 - pickedTrained.length);
  const pickedAuto = remaining ? auto.slice(-remaining) : [];
  const picked = [...pickedTrained, ...pickedAuto];

  // Fall back to the old "need 5" threshold for auto-only users.
  if (pickedTrained.length === 0 && picked.length < 5) return "";

  const voiceExamples = picked.map((s) => '  "' + s.text + '"').join("\n");
  return "VOICE SAMPLES (match this writing style in rewrites):\n" + voiceExamples;
}

async function saveRecipientInteraction(text) {
  const mentions = [];
  const pattern = /@([\w.-]+)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    mentions.push(m[1]);
  }

  if (mentions.length === 0) return;

  const { tg_relationships: existing } = await chrome.storage.local.get(["tg_relationships"]);
  const relationships = existing || {};

  for (const name of mentions) {
    if (!relationships[name]) {
      relationships[name] = { messageCount: 0, lastSeen: null };
    }
    relationships[name].messageCount++;
    relationships[name].lastSeen = new Date().toISOString();
  }

  await chrome.storage.local.set({ tg_relationships: relationships });

  if (syncManager) syncManager.schedulePush("relationships");
}

async function getRelationshipContext(text) {
  const { tg_relationships: relationships } = await chrome.storage.local.get(["tg_relationships"]);
  if (!relationships) return "";

  const mentions = [];
  const pattern = /@([\w.-]+)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    mentions.push(m[1]);
  }

  if (mentions.length === 0) return "";

  const lines = [];
  for (const name of mentions) {
    const rel = relationships[name];
    if (rel && rel.messageCount > 3) {
      lines.push("@" + name + ": frequent contact (" + rel.messageCount + " messages). Use a familiar, comfortable tone.");
    } else if (rel) {
      lines.push("@" + name + ": infrequent contact (" + rel.messageCount + " messages). Keep it professional and clear.");
    }
  }

  return lines.length > 0
    ? "RECIPIENT CONTEXT (based on message history):\n" + lines.join("\n")
    : "";
}

async function trackStats(flagged, mode) {
  const { tg_stats: existing } = await chrome.storage.local.get(["tg_stats"]);
  const stats = existing || { weekStart: new Date().toISOString(), checked: 0, flagged: 0, accepted: 0, dismissed: 0, edited: 0, byMode: {} };

  const weekStart = new Date(stats.weekStart);
  const now = new Date();
  const daysSince = (now - weekStart) / (1000 * 60 * 60 * 24);
  if (daysSince >= 7) {
    const { tg_stats_history: history } = await chrome.storage.local.get(["tg_stats_history"]);
    const weeks = history || [];
    weeks.push(stats);
    if (weeks.length > 12) weeks.splice(0, weeks.length - 12);
    await chrome.storage.local.set({ tg_stats_history: weeks });

    stats.weekStart = now.toISOString();
    stats.checked = 0;
    stats.flagged = 0;
    stats.accepted = 0;
    stats.dismissed = 0;
    stats.edited = 0;
    stats.byMode = {};
  }

  stats.checked++;
  if (flagged) {
    stats.flagged++;
    const m = mode || "tone";
    stats.byMode[m] = (stats.byMode[m] || 0) + 1;
  }

  await chrome.storage.local.set({ tg_stats: stats });

  if (syncManager) syncManager.schedulePush("stats_history");
}

async function handleRefine(original, answers) {
  const { tg_api_key: apiKey } = await chrome.storage.sync.get(["tg_api_key"]);
  if (!apiKey) return { error: "No API key" };

  const answersText = answers.map((a) => "Q: " + a.question + "\nA: " + a.answer).join("\n\n");

  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    system: "You are ToneGuard. The user wrote a message that needed improvement. You asked clarifying questions and now have the answers. Rewrite the original message incorporating the answers. Follow all the same tone, clarity, and communication rules. Return ONLY the rewritten message text, no JSON, no explanation, no markdown.",
    messages: [
      {
        role: "user",
        content: "ORIGINAL MESSAGE:\n" + original + "\n\nCLARIFYING ANSWERS:\n" + answersText + "\n\nRewrite the original message incorporating these answers. Return only the rewritten message."
      }
    ]
  });

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: requestBody
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error("API error " + response.status + ": " + errBody);
    }

    const data = await response.json();
    const refinedText = data.content[0]?.text || "";

    return { suggestion: refinedText.trim() };

  } catch (err) {
    console.error("ToneGuard refine error:", err);
    return { error: err.message };
  }
}
