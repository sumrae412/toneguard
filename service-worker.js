// ToneGuard Service Worker
// Handles Claude API calls and message routing between content script and side panel.

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are ToneGuard, a writing assistant that checks messages for tone and clarity issues. You review messages before they are sent in Slack and email.

Your job has three parts:
1. TONE: Catch messages that sound harsh, accusatory, passive-aggressive, defensive, or guilt-trippy
2. CLARITY: Simplify wordy or confusing messages so the reader understands quickly
3. PROFESSIONALISM: Catch messages that are sloppy, incoherent, or would make the sender look unprofessional. This includes gibberish, excessive slang that obscures meaning, random capitalizations, and messages that wouldn't make sense to the recipient

IMPORTANT: Most messages are fine. Only flag ones that genuinely need improvement. Silent pass-through is the default. Casual tone is fine. Unprofessional or unclear is not.

When you DO rewrite, follow these rules exactly:

SENTENCE STRUCTURE:
- One idea per sentence. If you have to read it twice, split it up
- Put what happened first, then why. Cause and effect in that order
- Short sentences over long ones. When in doubt, break it apart

THINGS TO AVOID IN REWRITES:
- Em dashes. They read as AI-generated. Use periods or commas instead
- "Would you mind..." combined with "next time." Sounds passive-aggressive. Make it a casual statement
- Singling out what someone did wrong. Guilt-trippy. Keep asks general
- "It made me feel..." Puts the other person on the defensive. State what happened and what you need
- "Even though I..." Sounds like building a case. Weave context in naturally
- "Is everything okay?" when you mean "what's going on?" Just ask directly
- "I noticed you [did thing]." Has "I'm watching you" energy. Use passive framing
- Packing two unrelated ideas into one sentence. If they don't connect, separate them
- Questions when you mean statements. "Would you mind checking with me?" becomes "Going forward, just loop me in and I'll get right on it"

THINGS TO DO IN REWRITES:
- Assume good intent. Frame things as miscommunication, not mistakes
- Make clear requests. Say what you want going forward, not what went wrong
- Use "going forward" instead of "next time." Forward-looking, not finger-pointing
- Reassure when asking for change. Pair the ask with something positive
- Split complex context into simple steps: what you did, what happened, what you need

DO NOT FLAG:
- Casual greetings, emoji reactions, quick acknowledgments
- Messages that are already clear, warm, and professional
- Short responses like "sounds good", "thanks!", "got it"
- Casual tone is fine as long as the message is understandable and coherent

Respond with ONLY valid JSON in this exact format:
{
  "flagged": true or false,
  "reasoning": "Brief explanation of what was caught (only if flagged)",
  "suggestion": "The rewritten message (only if flagged)"
}

If the message is fine, respond with:
{"flagged": false, "reasoning": "", "suggestion": ""}`;

// On install/startup, register content scripts for custom sites
chrome.runtime.onInstalled.addListener(() => registerCustomSites());
chrome.runtime.onStartup.addListener(() => registerCustomSites());

async function registerCustomSites() {
  const { tg_custom_sites: sites } = await chrome.storage.sync.get(["tg_custom_sites"]);
  if (!sites || sites.length === 0) return;

  // Unregister old dynamic scripts first
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["tg-custom-sites"] });
  } catch (_) {
    // May not exist yet, that's fine
  }

  const patterns = sites.map((site) => {
    // Convert "example.com" to "https://*.example.com/*" and "https://example.com/*"
    return [`https://${site}/*`, `https://*.${site}/*`];
  }).flat();

  try {
    await chrome.scripting.registerContentScripts([{
      id: "tg-custom-sites",
      matches: patterns,
      js: ["content.js"],
      runAt: "document_idle"
    }]);
  } catch (err) {
    console.error("ToneGuard: failed to register custom sites", err);
  }
}

// Listen for messages from content script and panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE") {
    handleAnalyze(message.text, sender.tab?.id)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === "GET_RESULT") {
    // Panel requesting the latest analysis result
    chrome.storage.session.get("tg_latest_result", (data) => {
      sendResponse(data.tg_latest_result || null);
    });
    return true;
  }

  if (message.type === "REGISTER_SITE" || message.type === "UNREGISTER_SITE") {
    // Re-register all custom sites (handles both add and remove)
    registerCustomSites().then(() => {
      // If adding, also request permission for the new site
      if (message.type === "REGISTER_SITE" && message.site) {
        chrome.permissions.request({
          origins: [`https://${message.site}/*`, `https://*.${message.site}/*`]
        });
      }
    });
    return false;
  }

  if (message.type === "PANEL_ACTION") {
    // Panel sent a decision, forward to the content script tab
    const tabId = message.tabId;
    chrome.tabs.sendMessage(tabId, {
      type: "PANEL_DECISION",
      action: message.action,       // "use_suggestion" or "send_original"
      suggestion: message.suggestion
    });
    return false;
  }
});

async function handleAnalyze(text, tabId) {
  // Skip very short messages
  if (!text || text.trim().length < 10) {
    return { flagged: false };
  }

  // Get API key
  const { tg_api_key: apiKey, tg_enabled: enabled } =
    await chrome.storage.sync.get(["tg_api_key", "tg_enabled"]);

  if (enabled === false) {
    return { flagged: false };
  }

  if (!apiKey) {
    return { error: "No API key set. Click the ToneGuard icon to add one." };
  }

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
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Review this message before sending:\n\n${text}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const rawContent = data.content[0]?.text || "";

    // Extract the JSON object — handles raw JSON, markdown code blocks,
    // or any wrapper text around the JSON
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("ToneGuard: no JSON found in response:", rawContent);
      return { flagged: false };
    }

    const result = JSON.parse(jsonMatch[0]);

    if (result.flagged && tabId) {
      // Store result for the panel to pick up
      await chrome.storage.session.set({
        tg_latest_result: {
          original: text,
          suggestion: result.suggestion,
          reasoning: result.reasoning,
          tabId: tabId
        }
      });

      // Open the side panel
      await chrome.sidePanel.open({ tabId });
    }

    return result;

  } catch (err) {
    console.error("ToneGuard analysis error:", err);
    // On error, let the message through (don't block sends)
    return { flagged: false, error: err.message };
  }
}
