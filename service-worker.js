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
  chrome.contextMenus.create({
    id: "toneguard-analyze",
    title: "Check tone with ToneGuard",
    contexts: ["selection"]
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "toneguard-analyze") return;
  if (!tab?.id || !info.selectionText) return;

  // Inject content + overlay scripts if not already present, then send message
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["overlay.js", "content.js"]
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
      js: ["overlay.js", "content.js"],
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
        files: ["overlay.js", "content.js"]
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
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody
      });

      if (response.status === 401 || response.status === 400 || response.status === 403) break;
      if (response.ok || response.status < 500) break;

      const delay = Math.pow(2, attempt) * 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    if (!response.ok) {
      const errBody = await response.text();
      const friendlyError = getFriendlyApiError(response.status, errBody);
      console.error("ToneGuard API error:", response.status, errBody);
      return { flagged: false, error: friendlyError };
    }

    const data = await response.json();
    const rawContent = data.content[0]?.text || "";

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("ToneGuard: no JSON found in response:", rawContent);
      return { flagged: false };
    }

    // Strip control characters (tabs, newlines, etc.) inside JSON string values
    // that Claude may produce, which cause JSON.parse to fail.
    const sanitized = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, (ch) =>
      ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : ""
    );
    const result = JSON.parse(sanitized);

    await trackStats(result.flagged, result.mode);

    if (!result.flagged) {
      await saveVoiceSample(text);
    }

    return result;

  } catch (err) {
    console.error("ToneGuard analysis error:", err);
    if (err.message && err.message.includes("Failed to fetch")) {
      return { flagged: false, error: "Network error — check your internet connection and try again." };
    }
    return { flagged: false, error: err.message };
  }
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

async function saveVoiceSample(text) {
  if (!text || text.length < 30) return;

  const { tg_voice_samples: existing } = await chrome.storage.local.get(["tg_voice_samples"]);
  const samples = existing || [];

  samples.push({
    text: text.slice(0, 300),
    timestamp: new Date().toISOString()
  });

  if (samples.length > 30) {
    samples.splice(0, samples.length - 30);
  }

  await chrome.storage.local.set({ tg_voice_samples: samples });

  if (syncManager) syncManager.schedulePush("voice_samples");
}

async function getVoiceContext() {
  const { tg_voice_samples: samples } = await chrome.storage.local.get(["tg_voice_samples"]);
  if (!samples || samples.length < 5) return "";

  const picked = samples.slice(-5);
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
