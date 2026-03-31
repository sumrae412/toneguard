// ToneGuard Service Worker
// Handles Claude API calls and message routing between content script and side panel.

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are ToneGuard, a writing assistant that checks messages for tone and clarity issues. You review messages before they are sent in Slack and email.

Your job has three parts:
1. TONE: Catch messages that sound harsh, accusatory, passive-aggressive, defensive, guilt-trippy, negative, or venting. Phrases like "what the heck," "what the hell," "why would you," "are you serious," "I can't believe" are red flags. Even mild negativity like "that's weird" or "what's up with that" directed at someone's work should be flagged
2. CLARITY: Catch messages that are vague, ambiguous, or could be misread. Flag if:
   - Missing context or unclear references ("the channel," "the thing," "it")
   - The reader would have to guess what you mean
   - A sentence could be interpreted two different ways. Example: "first do slides, then just the notebooks" could mean "only notebooks" or "notebooks come after slides." If a word like "just" or "then" creates ambiguity, flag it
   - Descriptions of a process or sequence aren't explicit enough. "Like we did with Nvidia" is vague if the reader might not know or remember that process
   - No clear ask when one is needed
   - Rambling, over-qualified, or roundabout phrasing. If a message has phrases like "what I mean to say is," "I suspect that's where," "I don't think that," "I have not been understanding" stacked together, it needs simplifying. The reader shouldn't have to untangle nested qualifications to get the point
   - Hedging that buries the actual point. "I think maybe we should possibly consider" when you mean "let's do X"
   - Key information or commitments buried at the end of a long message
   When rewriting for clarity: one idea per sentence, lead with the main point, state commitments clearly, cut hedging language. Remove words that create ambiguity ("just," "basically," "sort of") unless they add real meaning
3. PROFESSIONALISM: Catch messages that are sloppy, incoherent, or would make the sender look unprofessional. This includes gibberish, excessive slang that obscures meaning, random capitalizations, venting/complaining, and messages that wouldn't make sense to the recipient

IMPORTANT: When in doubt, FLAG IT. It's better to suggest a cleaner version the user can dismiss than to let a bad message through. The user can always click "Send as-is" if they disagree.

CONVERSATION CONTEXT: You may receive recent conversation messages for context. Use them to judge whether the message being sent makes sense in context, is clear enough given what was discussed, and doesn't introduce ambiguity. The context is for your analysis only. Do NOT reference the other messages in your suggestion. Only rewrite the message being sent.

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

CLEAR IS KIND (Brené Brown principles — apply these when rewriting):
- Being clear IS being kind. Being vague or indirect to avoid discomfort is unkind. Flag messages that dance around the point to spare feelings — rewrite them to be direct and compassionate at the same time
- "Paint done." When asking someone to do something, be explicit about what the end result looks like. Don't leave them guessing what success means. "Handle the lease renewal" is vague. "Send the renewal letter to the Johnsons by Friday with the updated rent amount" is clear
- Name the issue directly. Don't hint, don't soften to the point of confusion. Use specific, constructive language. "I'd like you to work on X" is clearer than "maybe we could think about possibly adjusting the approach"
- Don't talk around people. If the message is clearly about someone but addressed vaguely to avoid naming them, flag it. Say it to them, not about them
- Unspoken expectations are unfair. If a message implies an expectation without stating it, flag it. The reader shouldn't have to decode what you actually need
- Half-truths dressed as kindness are unkind. Rewrites should be honest AND compassionate, not one at the expense of the other
- Good communication requires tolerating discomfort. If a message avoids saying the hard thing, that's a flag. Rewrite it to say the hard thing kindly, not to avoid it
- "The story I'm making up is..." When a message assumes the worst about someone's intent, rewrite it to own the assumption. Instead of "You clearly don't care about the deadline," try "The story I'm making up is that the deadline isn't a priority for you, and I want to check that"
- Use empathy phrases when the situation calls for it:
  * "It sounds like what's most important to you here is..." (validates their priority)
  * "It makes sense that you feel that way." (validates without agreeing)
  * "I want to make sure I understand." (shows genuine curiosity, not interrogation)
- Don't use text/chat for conversations that need tone and nuance. If a message is trying to resolve a complex emotional situation over Slack, flag it and suggest taking it to a call
- Mean what you say. Every word matters. If a rewrite includes filler that doesn't add meaning, cut it

CLARITY AND EXPLANATION RULES (especially when the message explains something):
- Replace jargon with intuitive phrases when meaning is preserved. If a term requires prior knowledge, replace it or define it inline. Never leave it implicit
- Explain the mechanism, not just the label. "Store, reuse, skip recomputation" is better than just naming a concept
- Don't collapse different concepts into one vague idea ("it makes things faster"). If things differ, say how
- Progressively simplify: start correct, remove unnecessary abstraction, replace with concrete mental models
- Expand technical terms inline rather than requiring separate explanations. "Attention computations" becomes "comparing words to determine which ones matter most"
- Lead with the main point, then add nuance. Don't make the reader wade through qualifications to find the takeaway

COMMUNICATION PRINCIPLES (apply when rewriting):
- Lead with why it matters to the reader. Don't bury the relevance. Open with the thing that makes them care, not background context
- One or two main points max. If a message tries to say five things, it says nothing. Cut to what matters most
- Substitute complex ideas with simpler, concrete ones. Instead of abstract process descriptions, use a vivid comparison or specific example the reader can picture
- Make it memorable. A short story or specific detail ("remember when the tenant called at 2am about the leak") lands harder than a list of facts
- When addressing resistance or pushback: validate their concern first ("I hear you, the timeline is tight"), reframe it toward a shared goal ("we both want this to ship clean"), then offer one concrete next step ("here's what I can do by Friday"). Never skip the validation step
- Strong openings. The first sentence should make the reader want to read the second one. Don't start with throat-clearing ("I just wanted to reach out about..." "Per our earlier discussion...")

DO NOT FLAG:
- Casual greetings, emoji reactions, quick acknowledgments
- Messages that are already clear, warm, and professional
- Short responses like "sounds good", "thanks!", "got it"
- Casual tone is fine as long as the message is understandable and coherent

RECIPIENT CONTEXT: If the message includes an @mention or is clearly directed at someone, factor in the relationship dynamic. A message to your boss needs more polish than a message to a close teammate. If conversation context is provided, use it to infer the relationship.

POLISH-ONLY MODE: If the tone is fine but the writing is messy (grammar, clarity, structure), set mode to "polish". This means: fix the writing without changing the voice or intent. Only restructure, don't soften or reframe.

Respond with ONLY valid JSON in this exact format:
{
  "flagged": true or false,
  "confidence": 0.0 to 1.0 (how confident you are this needs fixing. 0.9+ = definitely needs work, 0.5-0.8 = could be better, below 0.5 = probably fine),
  "mode": "tone" or "polish" or "both" (what type of fix is needed),
  "red_flags": ["specific phrase 1", "specific phrase 2"] (the exact phrases in the original that triggered the flag),
  "reasoning": "Brief explanation of what was caught",
  "suggestion": "The rewritten message"
}

If the message is fine, respond with:
{"flagged": false, "confidence": 0.0, "mode": "", "red_flags": [], "reasoning": "", "suggestion": ""}`;

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
  if (message.type === "OPEN_PANEL") {
    // Called synchronously during user gesture (Send click/Enter)
    // so sidePanel.open() is allowed
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId });
    }
    return false;
  }

  if (message.type === "ANALYZE") {
    handleAnalyze(message.text, sender.tab?.id, message.context)
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

async function handleAnalyze(text, tabId, context) {
  // Skip very short messages
  if (!text || text.trim().length < 10) {
    return { flagged: false };
  }

  // Get settings
  const { tg_api_key: apiKey, tg_enabled: enabled, tg_strictness: strictness } =
    await chrome.storage.sync.get(["tg_api_key", "tg_enabled", "tg_strictness"]);

  if (enabled === false) {
    return { flagged: false };
  }

  if (!apiKey) {
    return { error: "No API key set. Click the ToneGuard icon to add one." };
  }

  // Build dynamic prompt with learned examples and strictness
  const learnedExamples = await getLearnedExamples();
  const customRules = await getCustomRules();
  let fullPrompt = SYSTEM_PROMPT;

  const strictLevel = strictness || 2;
  if (strictLevel === 1) {
    fullPrompt += "\n\nSTRICTNESS: GENTLE. Only flag messages that are clearly problematic — harsh tone, offensive language, or truly incoherent. Let borderline messages through. When in doubt, don't flag.";
  } else if (strictLevel === 3) {
    fullPrompt += "\n\nSTRICTNESS: STRICT. Flag anything that could be improved — even slightly unclear phrasing, minor tone issues, or messages that are fine but could be better. Be thorough. The user wants to catch everything.";
  }
  // Level 2 (Balanced) = default behavior, no modifier needed

  if (customRules) {
    fullPrompt += `\n\nUSER-ADDED RULES:\n${customRules}`;
  }

  if (learnedExamples) {
    fullPrompt += `\n\nLEARNED FROM PAST DECISIONS (use these to calibrate):\n${learnedExamples}`;
  }

  const voiceContext = await getVoiceContext();
  if (voiceContext) {
    fullPrompt += "\n\n" + voiceContext;
  }

  const relationshipContext = await getRelationshipContext(text);
  if (relationshipContext) {
    fullPrompt += "\n\n" + relationshipContext;
  }

  // Track this interaction for relationship memory
  await saveRecipientInteraction(text, context);

  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    system: fullPrompt,
    messages: [
      {
        role: "user",
        content: context
          ? `${context}\n\nMESSAGE TO REVIEW (about to be sent):\n${text}`
          : `Review this message before sending:\n\n${text}`
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
    // Retry with exponential backoff (max 3 attempts)
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody
      });

      // Don't retry on auth errors or bad requests
      if (response.status === 401 || response.status === 400) break;

      // Success or non-retryable error
      if (response.ok || response.status < 500) break;

      // Server error: wait and retry
      const delay = Math.pow(2, attempt) * 500; // 500ms, 1s, 2s
      await new Promise((r) => setTimeout(r, delay));
    }

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

    // Track stats for weekly digest
    await trackStats(result.flagged, result.mode);

    // Learn from passed messages (voice samples)
    if (!result.flagged) {
      await saveVoiceSample(text);
    }

    if (result.flagged && tabId) {
      // Store result for the panel to pick up
      // (panel is already open — it was opened during the user gesture)
      await chrome.storage.session.set({
        tg_latest_result: {
          original: text,
          suggestion: result.suggestion,
          reasoning: result.reasoning,
          confidence: result.confidence || 0,
          mode: result.mode || "tone",
          red_flags: result.red_flags || [],
          tabId: tabId
        }
      });
    }

    return result;

  } catch (err) {
    console.error("ToneGuard analysis error:", err);
    // On error, let the message through (don't block sends)
    return { flagged: false, error: err.message };
  }
}

// Build learned examples from past decisions for prompt injection
async function getLearnedExamples() {
  const { tg_decisions: decisions } = await chrome.storage.local.get(["tg_decisions"]);
  if (!decisions || decisions.length === 0) return "";

  const examples = [];

  // "Sent as-is" = false positive (ToneGuard flagged but user disagreed)
  const falsePositives = decisions
    .filter((d) => d.action === "sent_original")
    .slice(-3);

  for (const d of falsePositives) {
    examples.push(`FALSE POSITIVE (flagged but user sent as-is, so do NOT flag similar messages):\n  Message: "${d.original}"`);
  }

  // "Used edited" = catch was right but rewrite needed work
  const edited = decisions
    .filter((d) => d.action === "used_edited")
    .slice(-3);

  for (const d of edited) {
    examples.push(`GOOD CATCH, BETTER REWRITE (user edited the suggestion, learn from their version):\n  Original: "${d.original}"\n  Your suggestion: "${d.suggestion}"\n  User's preferred version: "${d.finalText}"`);
  }

  // "Used suggestion" = both catch and rewrite were good
  const accepted = decisions
    .filter((d) => d.action === "used_suggestion")
    .slice(-3);

  for (const d of accepted) {
    examples.push(`GOOD EXAMPLE (user accepted this suggestion):\n  Original: "${d.original}"\n  Rewrite: "${d.suggestion}"`);
  }

  return examples.join("\n\n");
}

// Get user-added custom rules
async function getCustomRules() {
  const { tg_custom_rules: rules } = await chrome.storage.sync.get(["tg_custom_rules"]);
  return rules || "";
}

// Voice learning: save messages that passed as examples of good writing
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
}

// Build voice description from passed message samples
async function getVoiceContext() {
  const { tg_voice_samples: samples } = await chrome.storage.local.get(["tg_voice_samples"]);
  if (!samples || samples.length < 5) return "";

  const picked = samples.slice(-5);
  const voiceExamples = picked.map((s) => '  "' + s.text + '"').join("\n");

  return "VOICE SAMPLES (messages the user sent that were fine. Match this writing style in rewrites):\n" + voiceExamples;
}

// Relationship memory: track tone patterns per recipient
async function saveRecipientInteraction(text, context) {
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
}

// Build relationship context for the prompt
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

// Weekly stats tracking
async function trackStats(flagged, mode) {
  const { tg_stats: existing } = await chrome.storage.local.get(["tg_stats"]);
  const stats = existing || { weekStart: new Date().toISOString(), checked: 0, flagged: 0, accepted: 0, dismissed: 0, edited: 0, byMode: {} };

  // Reset if week has rolled over (7 days)
  const weekStart = new Date(stats.weekStart);
  const now = new Date();
  const daysSince = (now - weekStart) / (1000 * 60 * 60 * 24);
  if (daysSince >= 7) {
    // Archive the old week
    const { tg_stats_history: history } = await chrome.storage.local.get(["tg_stats_history"]);
    const weeks = history || [];
    weeks.push(stats);
    if (weeks.length > 12) weeks.splice(0, weeks.length - 12); // keep 12 weeks
    await chrome.storage.local.set({ tg_stats_history: weeks });

    // Reset
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
}
