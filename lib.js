// ToneGuard shared library — pure functions extracted for testing.
// Used by service-worker.js and content.js at runtime,
// and imported directly in tests.

/**
 * Detect which platform we're on based on hostname.
 */
function detectPlatform(hostname) {
  if (hostname.includes("slack")) return "slack";
  if (hostname.includes("mail.google")) return "gmail";
  if (hostname.includes("linkedin")) return "linkedin";
  if (hostname.includes("turbotenant")) return "turbotenant";
  return "generic";
}

/**
 * Escape unescaped control characters (tabs, newlines, CR) that appear
 * INSIDE string literals. Leaves structural whitespace alone.
 *
 * JSON.parse rejects literal newlines/tabs/CR inside string values. Claude
 * occasionally emits them in long rewrites. This walks the string tracking
 * whether we're inside a "..." literal, escaping only in-string control chars.
 *
 * @param {string} s - Raw (possibly invalid) JSON text.
 * @returns {string} JSON text safe to pass to JSON.parse.
 */
function escapeControlCharsInStrings(s) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") result += "\\n";
      else if (ch === "\r") result += "\\r";
      else if (ch === "\t") result += "\\t";
      else if (ch < "\x20" || ch === "\x7F") {
        // Other control chars — hex-encode
        result += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
      } else {
        result += ch;
      }
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Detect text-format tool-call markup in an extracted tool-input value.
 * Anthropic's legacy/fallback text format wraps tool arguments in
 * `<function_calls>` / `<invoke>` / `<parameter>` / `<...>` tags. When
 * the model emits one of these tags inside a string field of a forced
 * tool_use response (or inside a fallback-parsed text-format JSON), the user
 * ends up seeing raw markup appended to the rewrite. Treat any such payload
 * as corrupted so the caller's escalation path can surface a clean failure.
 */
const TOOL_CALL_XML_LEAK_RE = /<\/?(?:function_calls|invoke|parameter\b|antml:)/i;

function hasToolCallXmlLeak(value) {
  if (typeof value === "string") return TOOL_CALL_XML_LEAK_RE.test(value);
  if (Array.isArray(value)) return value.some(hasToolCallXmlLeak);
  if (value && typeof value === "object") {
    for (const key in value) {
      if (hasToolCallXmlLeak(value[key])) return true;
    }
  }
  return false;
}

/**
 * Pass a tool input through if it's clean, otherwise return null.
 * Public so callers/tests can validate parsed structures directly.
 */
function validateToolInput(input) {
  if (!input || typeof input !== "object") return input;
  return hasToolCallXmlLeak(input) ? null : input;
}

/**
 * Extract JSON object from Claude API response text.
 * Handles raw JSON, markdown code blocks, or any wrapper text.
 * Tolerates literal control chars inside string values (Claude sometimes
 * emits unescaped \n in long rewrites).
 * Returns parsed object or null (also null when tool-call XML leaks in).
 */
function parseApiResponse(rawContent) {
  if (!rawContent) return null;
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  // Fast path: valid JSON parses directly
  try {
    return validateToolInput(JSON.parse(jsonMatch[0]));
  } catch {
    // Fall through — try repairing in-string control chars
  }
  try {
    return validateToolInput(JSON.parse(escapeControlCharsInStrings(jsonMatch[0])));
  } catch {
    return null;
  }
}

/**
 * Extract the analysis result from an Anthropic Messages API response.
 *
 * With forced tool use, the result arrives as the already-parsed `input` of a
 * tool_use content block — no free-text JSON to parse, which is what eliminates
 * the stray-quote / control-char / markdown-fence parse failures (TG_PARSE_001).
 * Falls back to parsing a text block (defensive: a non-tool reply or older path).
 *
 * Tool input is validated for text-format tool-call XML leaks
 * (`<parameter>` / `<invoke>` / `<function_calls>` / `<*>`) — when the
 * model occasionally emits those tags inside a string field of an otherwise
 * structured response, return null so the caller's escalation path surfaces
 * a clean failure instead of rendering the leak.
 *
 * @param {object} data - Parsed API response body.
 * @param {string} [toolName] - Expected tool name; any tool_use accepted if omitted.
 * @returns {object|null} The analysis object, or null if none could be extracted.
 */
function extractToolResult(data, toolName) {
  if (!data || !Array.isArray(data.content)) return null;
  const toolBlock = data.content.find(
    (b) =>
      b &&
      b.type === "tool_use" &&
      (!toolName || b.name === toolName) &&
      b.input &&
      typeof b.input === "object"
  );
  if (toolBlock) return validateToolInput(toolBlock.input);
  const textBlock = data.content.find((b) => b && b.type === "text" && b.text);
  return textBlock ? parseApiResponse(textBlock.text) : null;
}

/**
 * Clean a site input for storage (strip protocol, trailing slashes).
 * Returns cleaned domain or null if invalid.
 */
function cleanSiteInput(input) {
  if (!input) return null;
  let site = input.trim().toLowerCase();
  site = site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!site.includes(".")) return null;
  return site;
}

/**
 * Validate a Claude API key format.
 * Returns { valid: boolean, error?: string }
 */
function validateApiKey(key) {
  if (!key || !key.trim()) {
    return { valid: false, error: "Please enter an API key" };
  }
  if (!key.startsWith("sk-ant-")) {
    return { valid: false, error: "Key should start with sk-ant-" };
  }
  return { valid: true };
}

/**
 * Get strictness label from numeric value.
 */
function getStrictnessLabel(value) {
  const labels = { 1: "Gentle", 2: "Balanced", 3: "Strict" };
  return labels[value] || "Balanced";
}

/**
 * Determine readability class from grade level.
 */
function getReadabilityClass(grade) {
  if (!grade || grade <= 0) return "";
  if (grade <= 9) return "good";
  if (grade <= 12) return "medium";
  return "hard";
}

/**
 * Determine confidence class from score.
 */
function getConfidenceClass(confidence) {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/**
 * Check if text is long enough to bother analyzing.
 */
function shouldAnalyze(text) {
  return text && text.trim().length >= 10;
}

const PRECHECK_RULES = {
  local_pass_max_words: 4,
  local_pass_phrases: [
    "sounds good",
    "thanks",
    "thank you",
    "got it",
    "ok",
    "okay",
    "will do"
  ],
  escalation_phrases: [
    "what the heck",
    "what the hell",
    "are you serious",
    "i can't believe",
    "per my last email",
    "as i already said",
    "why this is so hard"
  ],
  high_stakes_intent_modes: ["deescalating", "boundary"]
};

function normalizeForPrecheck(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conservative deterministic analysis routing.
 *
 * This does not rewrite or classify tone. It only passes obvious short
 * acknowledgments locally and marks high-risk messages for deeper analysis.
 */
function precheckAnalysis(text, options = {}) {
  if (options.error) {
    return {
      route: "blocked_error",
      precheck_hits: ["error:" + options.error],
      should_call_model: false
    };
  }

  const normalized = normalizeForPrecheck(text);
  const words = normalized ? normalized.split(" ") : [];
  if (!normalized) {
    return {
      route: "local_pass",
      precheck_hits: ["empty"],
      should_call_model: false
    };
  }

  const escalationHits = PRECHECK_RULES.escalation_phrases
    .filter((phrase) => normalized.includes(phrase))
    .map((phrase) => "phrase:" + phrase);
  const mode = options.intent_mode || options.intentMode || "";
  if (PRECHECK_RULES.high_stakes_intent_modes.includes(mode)) {
    escalationHits.push("intent:" + mode);
  }
  if (escalationHits.length > 0) {
    return {
      route: "deep",
      precheck_hits: escalationHits,
      should_call_model: true
    };
  }

  const isShortSafePhrase =
    words.length <= PRECHECK_RULES.local_pass_max_words &&
    PRECHECK_RULES.local_pass_phrases.includes(normalized);
  if (isShortSafePhrase) {
    return {
      route: "local_pass",
      precheck_hits: ["phrase:" + normalized],
      should_call_model: false
    };
  }

  return {
    route: "standard",
    precheck_hits: [],
    should_call_model: true
  };
}

const ANALYSIS_ERROR_MAP = {
  missing_api_key: {
    type: "auth_error",
    message: "No API key set. Open ToneGuard settings to add one.",
    retryable: false,
    diagnostic_code: "TG_AUTH_001"
  },
  invalid_api_key: {
    type: "auth_error",
    message: "Invalid API key. Open ToneGuard settings and check your key.",
    retryable: false,
    diagnostic_code: "TG_AUTH_002"
  },
  usage_limit: {
    type: "usage_limit_error",
    message: "Anthropic usage limit reached. Raise your limit at console.anthropic.com or wait until it resets.",
    retryable: false,
    diagnostic_code: "TG_LIMIT_001"
  },
  parse: {
    type: "parse_error",
    message: "ToneGuard could not read the model response.",
    retryable: true,
    diagnostic_code: "TG_PARSE_001"
  },
  truncated: {
    type: "truncated_error",
    message: "The analysis was too long and got cut off. Try a shorter message, then retry.",
    retryable: true,
    diagnostic_code: "TG_TRUNC_001"
  },
  network: {
    type: "network_error",
    message: "Network error. Check your connection and try again.",
    retryable: true,
    diagnostic_code: "TG_NET_001"
  },
  runtime: {
    type: "runtime_error",
    message: "ToneGuard hit an unexpected error.",
    retryable: true,
    diagnostic_code: "TG_RUNTIME_001"
  }
};

// Quota-class API errors (HTTP 400) that mean the KEY itself is exhausted, not
// that the message was bad: credit balance depleted, or a configured spend/usage
// limit hit. These are NOT content-specific — every call fails until the user
// tops up or the limit resets — so ToneGuard auto-pauses (fails open, letting
// sends through unchecked) rather than blocking every send with a cryptic error.
// See service-worker.js handleAnalyze + content.js paused branch.
const QUOTA_PAUSE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // re-probe the API 6h after pausing

/**
 * Classify a 400 response as a quota-class (key-exhausted) error, or null if it
 * isn't one. Mirrors the body-sniffing in getFriendlyApiError, but returns a
 * structured verdict so the pause logic and tests share one source of truth.
 */
function classifyQuotaError(status, body) {
  if (status !== 400 || typeof body !== "string") return null;
  if (/usage.?limit|usage_limit|reached your specified API usage limits/i.test(body)) {
    return {
      reason: "usage_limit",
      diagnostic_code: "TG_LIMIT_001",
      message:
        "Anthropic usage limit reached — ToneGuard paused. Your messages now send " +
        "unchecked. Raise your limit at console.anthropic.com, then resume in ToneGuard settings."
    };
  }
  if (/credit/i.test(body)) {
    return {
      reason: "credit_balance",
      diagnostic_code: "TG_CREDIT_001",
      message:
        "No Anthropic API credits remaining — ToneGuard paused. Your messages now send " +
        "unchecked. Add credits at console.anthropic.com, then resume in ToneGuard settings."
    };
  }
  return null;
}

/**
 * Is a stored quota-pause still in effect? Auto-expires after the cooldown so
 * the next send re-probes the API — the user may have topped up credits without
 * visiting Settings. `paused` is the tg_quota_paused storage object (or null).
 */
function isQuotaPauseActive(paused, nowMs) {
  if (!paused || typeof paused.at !== "number") return false;
  return nowMs - paused.at < QUOTA_PAUSE_COOLDOWN_MS;
}

const SITE_PROFILES = {
  slack: {
    label: "Slack",
    issue_card_limit: 2,
    prompt: "Slack profile: keep feedback compact, prefer concise rewrites, and use numbered lists when they help replies."
  },
  gmail: {
    label: "Gmail",
    issue_card_limit: 3,
    prompt: "Gmail profile: check professionalism more strongly, preserve email formatting, and make reasoning complete enough for a longer message."
  },
  linkedin: {
    label: "LinkedIn",
    issue_card_limit: 2,
    prompt: "LinkedIn profile: keep public-facing rewrites concise, professional, and not overfamiliar."
  },
  turbotenant: {
    label: "TurboTenant",
    issue_card_limit: 3,
    prompt: "TurboTenant profile: keep landlord and tenant communication specific, professional, and action-oriented."
  },
  pwa: {
    label: "PWA",
    issue_card_limit: 3,
    prompt: "PWA profile: assume copy-first use with no auto-send behavior."
  },
  android: {
    label: "Android",
    issue_card_limit: 2,
    prompt: "Android profile: keep explanations short and overlay-friendly."
  },
  generic: {
    label: "Generic",
    issue_card_limit: 3,
    prompt: "Generic profile: use balanced default workplace guidance."
  }
};

function getSiteProfile(platform) {
  const key = SITE_PROFILES[platform] ? platform : "generic";
  return { id: key, ...SITE_PROFILES[key] };
}

const TELEMETRY_ALLOWED_FIELDS = new Set([
  "event",
  "timestamp",
  "platform",
  "site_profile",
  "route",
  "model",
  "latency_bucket",
  "token_estimate_bucket",
  "failure_diagnostic_code",
  "issue_categories",
  "outcome"
]);
const TELEMETRY_EVENTS = new Set([
  "analysis_started",
  "analysis_completed",
  "analysis_failed",
  "route_selected",
  "rewrite_accepted",
  "rewrite_edited",
  "send_as_is",
  "retry_clicked",
  "mode_changed",
  "voice_strength_changed"
]);
const TELEMETRY_PRIVATE_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]+/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /https?:\/\//i
];

function sanitizeTelemetryEvent(event) {
  if (!event || typeof event !== "object") {
    return { ok: false, error: "invalid_event" };
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(event)) {
    if (!TELEMETRY_ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: "disallowed_field:" + key };
    }
    if (typeof value === "string") {
      for (const pattern of TELEMETRY_PRIVATE_PATTERNS) {
        if (pattern.test(value)) {
          return { ok: false, error: "private_value:" + key };
        }
      }
    }
    sanitized[key] = value;
  }
  if (!TELEMETRY_EVENTS.has(sanitized.event)) {
    return { ok: false, error: "unknown_event" };
  }
  if (!sanitized.timestamp) {
    sanitized.timestamp = new Date().toISOString();
  }
  return { ok: true, event: sanitized };
}

function buildTelemetryClipboardPayload(summary, platform, now) {
  const generatedAt = now || new Date().toISOString();
  const base = { platform: platform || "unknown", generatedAt };
  if (!summary || typeof summary !== "object") {
    return JSON.stringify({ ...base, empty: true }, null, 2);
  }
  return JSON.stringify({ ...base, summary }, null, 2);
}

function makeAnalysisError(kind, details = {}) {
  const base = ANALYSIS_ERROR_MAP[kind] || ANALYSIS_ERROR_MAP.runtime;
  return {
    type: base.type,
    message: details.message || base.message,
    retryable: details.retryable ?? base.retryable,
    safe_to_send: "user_decides",
    diagnostic_code: details.diagnostic_code || base.diagnostic_code,
    status: details.status,
    phase: details.phase,
    route: details.route,
    model: details.model,
    stop_reason: details.stop_reason,
    content_length: details.content_length
  };
}

// Output-token budgets for the main analysis. The payload (rewrite + word-level
// diff + categories + explanations) scales with message length. ANALYSIS_MAX_TOKENS
// covers the vast majority; ANALYSIS_MAX_TOKENS_CEILING is the one-time escalation
// budget used when the model still truncates (stop_reason === "max_tokens").
const ANALYSIS_MAX_TOKENS = 4096;
const ANALYSIS_MAX_TOKENS_CEILING = 8192;

/**
 * Decide whether to retry the analysis at a higher token budget.
 *
 * Returns true only when the response failed to parse specifically because the
 * model hit its output cap (stop_reason === "max_tokens") AND we have headroom
 * below the ceiling. A null/empty parse from any other cause does NOT escalate
 * — retrying wouldn't help and would just double latency/cost.
 *
 * @param {{parsed: object|null, stopReason: string, currentMax: number, ceiling: number}} args
 * @returns {boolean}
 */
function shouldEscalateMaxTokens({ parsed, stopReason, currentMax, ceiling }) {
  return !parsed && stopReason === "max_tokens" && currentMax < ceiling;
}

/**
 * Decide whether to re-roll the analysis once at the same token budget.
 *
 * Returns true when the model returned a complete response (stop_reason is NOT
 * "max_tokens") yet extraction yielded nothing — the dominant cause is the
 * leak detector (validateToolInput / TOOL_CALL_XML_LEAK_RE) discarding a
 * tool_use result because Anthropic's text-format function-call markup bled
 * into a string field. That leak is intermittent (see PR #63), so a single
 * re-roll almost always returns clean output. Without this, a leak on a normal
 * tool_use stop has no recovery and the send just fails.
 *
 * Distinct from shouldEscalateMaxTokens: that path retries at a HIGHER budget
 * for truncation; this path retries at the SAME budget for a length-independent
 * glitch. The max_tokens case is explicitly excluded so the two never overlap.
 *
 * @param {{parsed: object|null, stopReason: string}} args
 * @returns {boolean}
 */
function shouldRetryDiscardedResult({ parsed, stopReason }) {
  return !parsed && stopReason !== "max_tokens";
}

/**
 * Decide whether to re-roll once because the model flagged the message but
 * returned an empty suggestion.
 *
 * Distinct from the two gates above: those fire when extraction yielded NOTHING
 * (`!parsed`). This one fires when extraction SUCCEEDED — we have a valid parsed
 * result with `flagged: true` — but `suggestion` is missing/blank. With no
 * recovery, that result renders the "No rewrite generated" dead-end in the
 * overlay (see overlay-frame.js applySuggestionAvailability). The model is the
 * variance source (base.txt requires a rewrite whenever it flags), so a single
 * same-budget re-roll usually returns a usable rewrite. max_tokens is excluded:
 * a truncated flag-with-empty-suggestion is the escalation path's job, and a
 * same-budget retry wouldn't fit the rewrite the first one couldn't.
 *
 * @param {{parsed: object|null, stopReason: string}} args
 * @returns {boolean}
 */
function shouldRetryEmptySuggestion({ parsed, stopReason }) {
  return !!(
    parsed &&
    parsed.flagged &&
    stopReason !== "max_tokens" &&
    !hasUsableSuggestion(parsed)
  );
}

/**
 * Anthropic's prompt-cache minimum prefix for Haiku 4.5 is 4096 tokens.
 * Approximating 4 chars/token, we only attempt caching when basePrompt is at
 * least ~16K chars. Below this, cache_control silently no-ops (no error,
 * cache_creation_input_tokens stays 0). See shared/prompt-caching.md.
 */
const PROMPT_CACHE_MIN_CHARS = 16000;

/**
 * Build the Anthropic `system` field as either a cache-enabled 2-block array
 * (when basePrompt is long enough to actually cache) or a plain string fallback.
 * The stable basePrompt becomes the cacheable prefix; whatever the caller has
 * appended to it (intent, site profile, custom rules, learned examples, voice,
 * relationship context) lands in an uncached suffix block. Returns a string
 * unchanged when caching would no-op anyway — keeps the request shape simple.
 *
 * @param {string} basePrompt - The stable system prefix to cache.
 * @param {string} fullPrompt - basePrompt + any appended volatile sections.
 * @returns {string | Array<{type: string, text: string, cache_control?: object}>}
 */
function buildSystemPayload(basePrompt, fullPrompt) {
  if (!basePrompt || basePrompt.length < PROMPT_CACHE_MIN_CHARS) {
    return fullPrompt;
  }
  const suffix = fullPrompt.slice(basePrompt.length);
  const blocks = [
    { type: "text", text: basePrompt, cache_control: { type: "ephemeral" } }
  ];
  if (suffix) blocks.push({ type: "text", text: suffix });
  return blocks;
}

/**
 * Truncate text for display.
 */
function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

/**
 * Cap for individual fields inside learned-decision examples (`original`,
 * `suggestion`, `finalText`). Roughly 50 tokens each; with 9 decisions × 3
 * fields, total worst-case is ~1350 tokens vs. unbounded prior to this cap.
 * The user's full decision history stays on disk untouched — only the prompt
 * is truncated.
 */
const LEARNED_FIELD_MAX_CHARS = 200;

/**
 * Cap for the user-provided custom-rules block (~500 tokens). Power users with
 * sprawling rule sheets get a single truncation marker telling them to shorten;
 * the full block remains in their settings storage.
 */
const CUSTOM_RULES_MAX_CHARS = 2000;

/**
 * Truncate a single learned-decision field. Marker is short on purpose — the
 * model needs to know the message was clipped without paying for explanatory
 * prose.
 */
function clampLearnedField(text) {
  if (!text) return "";
  if (text.length <= LEARNED_FIELD_MAX_CHARS) return text;
  return text.slice(0, LEARNED_FIELD_MAX_CHARS - 3) + "...";
}

/**
 * Truncate the user's custom-rules block. Marker tells the user where to shorten
 * (model doesn't need the prose; it's for human grep when reviewing telemetry).
 */
function clampCustomRules(rules) {
  if (!rules) return "";
  if (rules.length <= CUSTOM_RULES_MAX_CHARS) return rules;
  return rules.slice(0, CUSTOM_RULES_MAX_CHARS) +
    "\n\n[... rules truncated at " + CUSTOM_RULES_MAX_CHARS +
    " chars; shorten in extension options to send all rules]";
}

/**
 * Hash an API key using SHA-256. Returns hex string.
 * The raw key never leaves the device — only the hash is sent for sync identity.
 */
async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalize editor text for comparison.
 *
 * Strips zero-width chars, converts NBSPs to regular spaces, collapses
 * whitespace runs, and normalizes line endings. Used before comparing
 * inserted text against a target suggestion, since different editors
 * (Gmail contenteditable, Slack Quill fallback, LinkedIn) introduce
 * their own whitespace and invisible characters around inserted content.
 */
function normalizeEditorText(text) {
  if (!text) return "";
  return String(text)
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Verify that a suggestion was actually inserted into the editor.
 *
 * Returns true when normalized editor content changed from `before` AND
 * either equals the normalized suggestion or contains it (e.g. Gmail
 * signatures appended below the body). Returns false on silent no-op
 * (focus transfer failed, execCommand rejected) or when the suggestion
 * is absent.
 *
 * Keep the check tolerant to editor whitespace quirks so we don't nack
 * successful inserts and tell the user to paste manually — that was the
 * motivating bug. But still catch true no-ops so we don't lie about
 * success.
 */
function verifyInsertedText(before, after, suggestion) {
  const nBefore = normalizeEditorText(before);
  const nAfter = normalizeEditorText(after);
  const nSuggestion = normalizeEditorText(suggestion);
  if (!nSuggestion) return false;
  // Silent no-op (focus transfer failed, execCommand rejected).
  if (nAfter === nBefore) return false;
  // Exact match is always OK.
  if (nAfter === nSuggestion) return true;
  // Strip @mentions for the comparison. Slack's Quill editor expands plain
  // "@name" text into rendered mention tokens with the user's full display
  // name on insert (see [AUTOSLUG] events), so the suggestion text is no
  // longer a substring of the resulting editor content even though the
  // insert succeeded. Stripping mentions from both sides neutralizes that.
  // Also consume the display-name run after the handle so Slack's
  // "@sam" → "@Sam Rivera" expansion strips to the same shape on both sides.
  // The run is: capitalized words ([A-Z]…), plus name characters the
  // capitalized-word heuristic alone would strand — apostrophes/curly-quotes
  // and hyphens inside a token (O'Brien, Smith-Lee), and the common lowercase
  // particles (von, van, de/der/del, di, da, la, le, …). Without these the
  // after-side keeps a dangling "'Brien" / "von Trapp" and the compare
  // silently fails, nacking a successful insert. These tokens are consumed
  // symmetrically, so eating one that's really sentence text stays aligned on
  // both sides.
  const stripMentions = (s) =>
    s.replace(/@[\w.'’-]+(?:\s+(?:[A-Z][\w.'’-]*|von|van|de[rl]?|del|dos|das|la|le|di|da|du|bin|ben|al))*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const sBefore = stripMentions(nBefore);
  const sAfter = stripMentions(nAfter);
  const sSuggestion = stripMentions(nSuggestion);
  // Containment is the Gmail-signature-appended case. But if the ORIGINAL
  // draft already contained the suggestion as a substring, `includes` can
  // pass while the actual insert silently failed (cursor moved, ZWSP
  // inserted elsewhere). Require the suggestion to be *newly present* —
  // not in `before` but in `after`.
  if (nBefore.includes(nSuggestion)) return false;
  if (nAfter.includes(nSuggestion)) return true;
  if (sSuggestion && !sBefore.includes(sSuggestion) && sAfter.includes(sSuggestion)) return true;
  return false;
}

/**
 * Extract @mentions from text.
 */
function extractMentions(text) {
  if (!text) return [];
  const mentions = [];
  const pattern = /@([\w.-]+)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    mentions.push(m[1]);
  }
  return mentions;
}

// ===========================================================================
// Pattern extraction (Phase 5a — see docs/plans/2026-05-30-virtual-brain.md)
// ===========================================================================

const PATTERN_HEDGING_WORDS = [
  "maybe", "perhaps", "could", "would", "might", "may", "possibly",
  "potentially", "kind of", "sort of"
];

const PATTERN_SOFTENING_PHRASES = [
  "when you have a moment", "when you get a chance", "no rush",
  "if you have time", "no worries", "no pressure"
];

const PATTERN_CATEGORIES = ["softening", "hedging", "formality", "brevity", "other"];

/**
 * Tokenize on whitespace, preserving punctuation as glued to adjacent tokens.
 * Cheap; good enough for diffing typical chat/email messages.
 */
function tokenizeForPattern(text) {
  if (!text) return [];
  return text.match(/\S+/g) || [];
}

/**
 * Find the lengths of the longest common token prefix and suffix between two
 * token arrays. Used to isolate the "changed middle" — the most common edit
 * shape (a single substitution) is captured exactly this way.
 */
function commonPrefixSuffixLengths(a, b) {
  let prefixLen = 0;
  while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (
    suffixLen < a.length - prefixLen &&
    suffixLen < b.length - prefixLen &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }
  return { prefixLen, suffixLen };
}

/**
 * Extract the largest contiguous edit span from `suggestion` → `finalText`.
 * Returns `{from, to}` strings, or null when nothing meaningful changed.
 * For multi-edit messages, this collapses to the bounding diff (good enough
 * for v1; LCS-based refinement is a later phase if needed).
 */
function extractEditSpan(suggestion, finalText) {
  if (!suggestion || !finalText) return null;
  if (suggestion === finalText) return null;
  const a = tokenizeForPattern(suggestion);
  const b = tokenizeForPattern(finalText);
  const { prefixLen, suffixLen } = commonPrefixSuffixLengths(a, b);
  const fromTokens = a.slice(prefixLen, a.length - suffixLen);
  const toTokens = b.slice(prefixLen, b.length - suffixLen);
  if (fromTokens.length === 0 && toTokens.length === 0) return null;
  return { from: fromTokens.join(" "), to: toTokens.join(" ") };
}

/**
 * Categorize an edit span. Heuristic-based — sufficient for grouping; later
 * phases can swap in LLM-driven categorization if signal is too noisy.
 */
function categorizePattern(fromText, toText) {
  const fromLow = (fromText || "").toLowerCase();
  const toLow = (toText || "").toLowerCase();

  for (const phrase of PATTERN_SOFTENING_PHRASES) {
    if (toLow.includes(phrase)) return "softening";
  }
  for (const word of PATTERN_HEDGING_WORDS) {
    // Word-boundary check so "may" doesn't match "maybe"
    const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
    if (re.test(toLow) && !re.test(fromLow)) return "hedging";
  }
  const fromLen = fromText.length || 1;
  const toLen = toText.length;
  if (toLen > fromLen * 1.5) return "formality";
  if (toLen < fromLen * 0.5 && toLen > 0) return "brevity";
  return "other";
}

/**
 * Aggregate a flat list of `tg_decisions` into a deduped list of patterns.
 * Only `used_edited` decisions contribute (an edit reveals user preference);
 * `used_suggestion` and `sent_original` are ignored here — they're already
 * surfaced via the existing recency window in service-worker.js:getLearnedExamples.
 *
 * @param {Array<object>} decisions - tg_decisions[] from chrome.storage.local
 * @returns {Array<object>} Patterns sorted by occurrences (most frequent first).
 */
function extractPatterns(decisions) {
  if (!Array.isArray(decisions)) return [];
  const patternMap = new Map();

  for (const decision of decisions) {
    if (!decision || decision.action !== "used_edited") continue;
    const edit = extractEditSpan(decision.suggestion, decision.finalText);
    if (!edit) continue;

    const key = edit.from + " → " + edit.to;
    const recipients = extractMentions(decision.original || "");
    const ts = decision.timestamp || null;
    const existing = patternMap.get(key);

    if (existing) {
      existing.occurrences += 1;
      if (ts) existing.last_seen = ts;
      for (const r of recipients) {
        if (!existing.recipients.includes(r)) existing.recipients.push(r);
      }
    } else {
      patternMap.set(key, {
        from_token: edit.from,
        to_token: edit.to,
        category: categorizePattern(edit.from, edit.to),
        recipients: recipients.slice(),
        occurrences: 1,
        first_seen: ts,
        last_seen: ts
      });
    }
  }

  return Array.from(patternMap.values()).sort((a, b) => b.occurrences - a.occurrences);
}

// ===========================================================================
// memory.md renderer (Phase 5b — see docs/plans/2026-05-30-virtual-brain.md)
// ===========================================================================

function _formatPatternBullet(p) {
  const recipients = (p.recipients || []).map((r) => "@" + r).join(", ");
  const recPart = recipients ? `, with ${recipients}` : "";
  return `- **"${p.from_token}"** → **"${p.to_token}"** (${p.occurrences}×, ${p.category}${recPart})`;
}

/**
 * Render a deduped patterns array as a human-readable markdown document.
 * Sections: header → by category (most-frequent first) → by recipient.
 * Empty input still produces a valid (minimal) document.
 *
 * @param {Array<object>} patterns - output of extractPatterns()
 * @param {{generatedAt?: string, decisionCount?: number}} [opts]
 * @returns {string} markdown source
 */
function renderMemoryMd(patterns, opts) {
  const safe = Array.isArray(patterns) ? patterns : [];
  const options = opts || {};
  const generated = options.generatedAt || "(unknown timestamp)";
  const decisionCount = typeof options.decisionCount === "number"
    ? options.decisionCount
    : null;

  const lines = ["# ToneGuard Memory", ""];
  const subtitle = decisionCount !== null
    ? `_Generated ${generated} from ${decisionCount} decisions, ${safe.length} patterns._`
    : `_Generated ${generated} — ${safe.length} patterns._`;
  lines.push(subtitle, "");

  if (safe.length === 0) {
    lines.push(
      "No patterns learned yet. Edit a few suggestions in the overlay and they'll appear here."
    );
    return lines.join("\n");
  }

  // --- By category (most-frequent category first) ---
  lines.push("## Substitutions by category", "");

  const byCat = new Map();
  for (const p of safe) {
    const cat = p.category || "other";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }
  const cats = Array.from(byCat.entries())
    .map(([cat, ps]) => ({
      cat,
      ps,
      total: ps.reduce((sum, p) => sum + (p.occurrences || 0), 0)
    }))
    .sort((a, b) => b.total - a.total);

  for (const { cat, ps } of cats) {
    lines.push(`### ${cat[0].toUpperCase()}${cat.slice(1)} (${ps.length} pattern${ps.length === 1 ? "" : "s"})`, "");
    for (const p of ps) lines.push(_formatPatternBullet(p));
    lines.push("");
  }

  // --- By recipient ---
  const byRec = new Map();
  for (const p of safe) {
    for (const r of p.recipients || []) {
      if (!byRec.has(r)) byRec.set(r, []);
      byRec.get(r).push(p);
    }
  }
  if (byRec.size > 0) {
    lines.push("## By recipient", "");
    const recs = Array.from(byRec.entries())
      .map(([r, ps]) => ({ r, ps, total: ps.length }))
      .sort((a, b) => b.total - a.total);
    for (const { r, ps } of recs) {
      lines.push(`### @${r} (${ps.length} pattern${ps.length === 1 ? "" : "s"})`, "");
      for (const p of ps) lines.push(_formatPatternBullet(p));
      lines.push("");
    }
  }

  // Append the graph view (Phase 5e). Empty when patterns is empty.
  const graphMd = renderMemoryGraph(safe);
  if (graphMd) {
    lines.push(graphMd);
  }

  return lines.join("\n").replace(/\n+$/, "\n");
}

// ===========================================================================
// Memory graph view (Phase 5e — purpose-built, NOT a build_doc_graph.py reuse)
// ===========================================================================

/**
 * Lowercase, replace non-alphanumeric runs with hyphens, trim hyphens. Used
 * for stable markdown anchors (GitHub-flavored). Keeps the graph cross-links
 * functional both in rendered MD viewers and in the downloaded file.
 */
function _slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function _patternAnchor(p) {
  return "pattern-" + _slugify(p.from_token + "-to-" + p.to_token);
}
function _recipientAnchor(name) { return "recipient-" + _slugify(name); }
function _categoryAnchor(cat) { return "category-" + _slugify(cat); }
function _patternLabel(p) { return `"${p.from_token}" → "${p.to_token}"`; }

/**
 * Build a node/edge graph from the pattern store.
 *
 * Nodes:
 *   - pattern nodes (one per distinct from→to)
 *   - recipient nodes (one per @mention across all patterns)
 *   - category nodes (one per occupied category)
 *
 * Edges:
 *   - pattern ↔ recipient (pattern was used with recipient)
 *   - pattern ↔ category
 *   - recipient ↔ recipient (inferred — they share at least one pattern)
 *
 * Returns a structured graph object for direct rendering, plus rank metadata
 * (degree per node so the renderer can list hubs).
 *
 * @param {Array<object>} patterns
 * @returns {{patterns: Array, recipients: Array, categories: Array, recipientAffinity: Array, orphans: Array}}
 */
function buildMemoryGraph(patterns) {
  const safe = Array.isArray(patterns) ? patterns : [];

  // Index patterns and compute recipient counts
  const recipientToPatterns = new Map();
  const categoryToPatterns = new Map();
  const orphans = [];

  for (const p of safe) {
    if (!p || !p.from_token || !p.to_token) continue;
    const cat = p.category || "other";
    if (!categoryToPatterns.has(cat)) categoryToPatterns.set(cat, []);
    categoryToPatterns.get(cat).push(p);

    const recipients = Array.isArray(p.recipients) ? p.recipients : [];
    if (recipients.length === 0) {
      orphans.push(p);
      continue;
    }
    for (const r of recipients) {
      if (!recipientToPatterns.has(r)) recipientToPatterns.set(r, []);
      recipientToPatterns.get(r).push(p);
    }
  }

  // Recipient ↔ recipient affinity: any two recipients sharing >= 1 pattern
  const recipientList = Array.from(recipientToPatterns.keys()).sort();
  const affinity = [];
  for (let i = 0; i < recipientList.length; i++) {
    for (let j = i + 1; j < recipientList.length; j++) {
      const a = recipientList[i];
      const b = recipientList[j];
      const aSet = new Set(recipientToPatterns.get(a).map(_patternAnchor));
      const shared = recipientToPatterns.get(b).filter((p) => aSet.has(_patternAnchor(p)));
      if (shared.length > 0) {
        affinity.push({ a, b, sharedCount: shared.length, shared });
      }
    }
  }
  affinity.sort((x, y) => y.sharedCount - x.sharedCount);

  // Build pattern degree: edges = recipients + 1 (for category)
  const patternNodes = safe
    .filter((p) => p && p.from_token && p.to_token)
    .map((p) => {
      const recCount = (p.recipients || []).length;
      return { ...p, degree: recCount + 1 };
    })
    .sort((a, b) => b.degree - a.degree || b.occurrences - a.occurrences);

  const recipientNodes = recipientList
    .map((r) => ({ name: r, patterns: recipientToPatterns.get(r), degree: recipientToPatterns.get(r).length }))
    .sort((a, b) => b.degree - a.degree);

  const categoryNodes = Array.from(categoryToPatterns.entries())
    .map(([cat, ps]) => ({ name: cat, patterns: ps, degree: ps.length }))
    .sort((a, b) => b.degree - a.degree);

  return {
    patterns: patternNodes,
    recipients: recipientNodes,
    categories: categoryNodes,
    recipientAffinity: affinity,
    orphans
  };
}

/**
 * Render the graph as cross-linked markdown sections suitable for appending
 * to memory.md. Anchors are GitHub-flavored slugs so links work in any
 * markdown viewer that auto-anchors headings (including GitHub itself).
 *
 * @param {Array<object>} patterns
 * @returns {string}
 */
function renderMemoryGraph(patterns) {
  const graph = buildMemoryGraph(patterns);
  const lines = [];

  if (graph.patterns.length === 0) return "";

  lines.push("## Graph view", "");
  lines.push("_Patterns, recipients, and categories as a cross-linked graph. Click a link to jump._", "");

  // --- Hubs: most-connected pattern nodes (top 5) ---
  lines.push("### Hubs — most connected patterns", "");
  const hubs = graph.patterns.slice(0, 5);
  for (const p of hubs) {
    lines.push(`#### Pattern: ${_patternLabel(p)} <a id="${_patternAnchor(p)}"></a>`);
    lines.push("");
    lines.push(`- Occurrences: ${p.occurrences || 1}`);
    lines.push(`- Category: [${p.category}](#${_categoryAnchor(p.category)})`);
    if ((p.recipients || []).length > 0) {
      const recLinks = p.recipients.map((r) => `[@${r}](#${_recipientAnchor(r)})`).join(", ");
      lines.push(`- Recipients: ${recLinks}`);
    } else {
      lines.push(`- Recipients: _(none — orphan pattern)_`);
    }
    lines.push("");
  }

  // --- Recipients ---
  if (graph.recipients.length > 0) {
    lines.push("### Recipients", "");
    for (const r of graph.recipients) {
      lines.push(`#### @${r.name} <a id="${_recipientAnchor(r.name)}"></a> — ${r.degree} pattern${r.degree === 1 ? "" : "s"}`);
      lines.push("");
      for (const p of r.patterns) {
        lines.push(`- [${_patternLabel(p)}](#${_patternAnchor(p)}) (${p.occurrences || 1}×)`);
      }
      lines.push("");
    }
  }

  // --- Categories ---
  if (graph.categories.length > 0) {
    lines.push("### Categories", "");
    for (const c of graph.categories) {
      const label = c.name[0].toUpperCase() + c.name.slice(1);
      lines.push(`#### ${label} <a id="${_categoryAnchor(c.name)}"></a> — ${c.degree} pattern${c.degree === 1 ? "" : "s"}`);
      lines.push("");
      for (const p of c.patterns) {
        lines.push(`- [${_patternLabel(p)}](#${_patternAnchor(p)})`);
      }
      lines.push("");
    }
  }

  // --- Recipient affinity ---
  if (graph.recipientAffinity.length > 0) {
    lines.push("### Recipient affinity", "");
    lines.push("_Recipient pairs that share patterns — implicit communication-style clusters._", "");
    for (const a of graph.recipientAffinity) {
      lines.push(`- [@${a.a}](#${_recipientAnchor(a.a)}) ↔ [@${a.b}](#${_recipientAnchor(a.b)}) — ${a.sharedCount} shared pattern${a.sharedCount === 1 ? "" : "s"}`);
    }
    lines.push("");
  }

  // --- Orphan patterns ---
  if (graph.orphans.length > 0) {
    lines.push("### Orphan patterns", "");
    lines.push("_Patterns with no recipient connection — 1:1 messages or no @mentions in the original._", "");
    for (const p of graph.orphans) {
      lines.push(`- ${_patternLabel(p)} (${p.occurrences || 1}×, ${p.category})`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n+$/, "\n");
}

// ===========================================================================
// Pattern block for system prompt injection (Phase 5c)
// ===========================================================================

/**
 * Cap for the injected pattern block. ~600 tokens (~2400 chars at 4 chars/tok).
 * Comfortably small relative to the analysis prompt; large enough to carry
 * 10-15 substantial patterns. The block goes into the VOLATILE suffix (NOT
 * the cached basePrompt) — caching invariant preserved.
 */
const PATTERN_INJECT_MAX_CHARS = 2400;
const PATTERN_INJECT_MAX_COUNT = 10;

/**
 * Render top-N learned patterns as a system-prompt block ready to append to
 * the volatile suffix. Returns "" when there's nothing useful to inject.
 *
 * Format choices:
 *   - Header tells the model HOW to use the patterns (consistency, not just
 *     reference).
 *   - Each line is a single substitution with occurrence count, so the model
 *     has a usage-frequency signal.
 *   - Recipient hints attached for patterns dominated by a specific @mention.
 *
 * @param {Array<object>} patterns - output of extractPatterns()
 * @returns {string}
 */
function buildPatternBlock(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return "";

  const lines = [
    "PATTERNS LEARNED FROM PAST EDITS (apply consistently — prefer these over generic softeners):"
  ];

  let charBudget = PATTERN_INJECT_MAX_CHARS - lines[0].length;
  let used = 0;

  for (const p of patterns.slice(0, PATTERN_INJECT_MAX_COUNT)) {
    if (!p || !p.from_token || !p.to_token) continue;
    const recipients = Array.isArray(p.recipients) ? p.recipients : [];
    const recPart = recipients.length === 1
      ? ` (especially with @${recipients[0]})`
      : recipients.length > 1
        ? ` (with ${recipients.map((r) => "@" + r).join(", ")})`
        : "";
    const line = `- "${p.from_token}" → "${p.to_token}" (${p.occurrences || 1}×${recPart})`;
    if (line.length > charBudget) break;
    lines.push(line);
    charBudget -= line.length + 1; // +1 for newline
    used += 1;
  }

  if (used === 0) return "";
  return lines.join("\n");
}

// Build a dependency-free "extension was updated — reload this tab" banner.
//
// When the extension context is invalidated (extension reloaded/updated while
// the tab stayed open), chrome.runtime.getURL() throws, so overlay.js can never
// inject its extension-hosted iframe. Without a fallback the send is silently
// blocked with zero feedback — the user clicks Send, nothing happens, and they
// have no idea why. This banner uses ONLY plain DOM (no chrome.* APIs), so it
// can still render and tell the user their message was NOT sent and the tab
// needs a reload.
//
// Pure and injectable for tests: takes the document and a reload callback, and
// builds the node only. Idempotency and appending are the caller's job.
function buildStaleFallback(doc, onReload) {
  const root = doc.createElement("div");
  root.id = "toneguard-stale-fallback";
  root.setAttribute("role", "alert");
  root.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;" +
    "display:flex;gap:10px;align-items:flex-start;padding:12px 14px;" +
    "background:#1f2430;color:#fff;border-radius:10px;" +
    "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.32);";

  const msg = doc.createElement("div");
  msg.style.cssText = "flex:1;";
  msg.textContent =
    "ToneGuard was updated. Reload this tab to re-enable tone checks — " +
    "your last message was not sent.";

  const reload = doc.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.style.cssText =
    "flex:none;cursor:pointer;border:0;border-radius:6px;padding:6px 10px;" +
    "background:#4c8bf5;color:#fff;font:inherit;font-weight:600;";
  reload.addEventListener("click", () => {
    if (typeof onReload === "function") onReload();
  });

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.style.cssText =
    "flex:none;cursor:pointer;border:0;background:transparent;color:#fff;" +
    "font:inherit;font-size:16px;line-height:1;opacity:.7;padding:2px 4px;";
  dismiss.addEventListener("click", () => {
    if (typeof root.remove === "function") root.remove();
  });

  root.appendChild(msg);
  root.appendChild(reload);
  root.appendChild(dismiss);
  return root;
}

/**
 * A flagged result is only actionable if it carries a non-empty rewrite.
 * The model occasionally flags a message (red flags, categories, readability)
 * but returns an empty/whitespace `suggestion`. Accepting that empty rewrite
 * would overwrite the user's compose box with nothing — a silent data-loss
 * default. The overlay uses this to treat "flagged but no suggestion" as a
 * degraded result rather than a usable rewrite.
 *
 * @param {object} result - Analysis result (or null).
 * @returns {boolean} True when `result.suggestion` is a non-empty string.
 */
function hasUsableSuggestion(result) {
  return !!(result && typeof result.suggestion === "string" && result.suggestion.trim());
}

// True when a thrown error means the service worker was unreachable — the
// message never got a verdict, so the send MUST be blocked (never released).
// Chrome phrases SW-unavailable rejections a few ways; all mean the same
// thing from the content script's side: the analysis round-trip failed and
// the message is unchecked. Treated like context-invalidation: show the
// reload banner, do NOT auto-release the send. See content.js
// analyzeAndIntercept catch block and the "Never swallow parse errors into a
// destructive default" invariant in CLAUDE.md.
function isConnectionLostError(err) {
  const msg = err && typeof err.message === "string"
    ? err.message
    : typeof err === "string" ? err : "";
  return /could not establish connection|receiving end does not exist|message port closed|extension context invalidated/i.test(msg);
}

// Make functions available globally when loaded as a content script (non-module),
// and via the test wrapper (tests/lib-exports.mjs) for vitest.
if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardLib = {
    detectPlatform,
    buildStaleFallback,
    hasUsableSuggestion,
    isConnectionLostError,
    parseApiResponse,
    extractToolResult,
    validateToolInput,
    cleanSiteInput,
    validateApiKey,
    getStrictnessLabel,
    getReadabilityClass,
    getConfidenceClass,
    shouldAnalyze,
    precheckAnalysis,
    makeAnalysisError,
    classifyQuotaError,
    isQuotaPauseActive,
    QUOTA_PAUSE_COOLDOWN_MS,
    shouldEscalateMaxTokens,
    shouldRetryDiscardedResult,
    shouldRetryEmptySuggestion,
    buildSystemPayload,
    PROMPT_CACHE_MIN_CHARS,
    clampLearnedField,
    clampCustomRules,
    LEARNED_FIELD_MAX_CHARS,
    CUSTOM_RULES_MAX_CHARS,
    ANALYSIS_MAX_TOKENS,
    ANALYSIS_MAX_TOKENS_CEILING,
    getSiteProfile,
    sanitizeTelemetryEvent,
    buildTelemetryClipboardPayload,
    truncate,
    extractMentions,
    tokenizeForPattern,
    commonPrefixSuffixLengths,
    extractEditSpan,
    categorizePattern,
    extractPatterns,
    renderMemoryMd,
    buildMemoryGraph,
    renderMemoryGraph,
    buildPatternBlock,
    PATTERN_INJECT_MAX_CHARS,
    PATTERN_INJECT_MAX_COUNT,
    PATTERN_CATEGORIES,
    hashApiKey,
    normalizeEditorText,
    verifyInsertedText
  };
}
