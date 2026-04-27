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
 * Extract JSON object from Claude API response text.
 * Handles raw JSON, markdown code blocks, or any wrapper text.
 * Tolerates literal control chars inside string values (Claude sometimes
 * emits unescaped \n in long rewrites).
 * Returns parsed object or null.
 */
function parseApiResponse(rawContent) {
  if (!rawContent) return null;
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  // Fast path: valid JSON parses directly
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    // Fall through — try repairing in-string control chars
  }
  try {
    return JSON.parse(escapeControlCharsInStrings(jsonMatch[0]));
  } catch {
    return null;
  }
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
  parse: {
    type: "parse_error",
    message: "ToneGuard could not read the model response.",
    retryable: true,
    diagnostic_code: "TG_PARSE_001"
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
    model: details.model
  };
}

/**
 * Truncate text for display.
 */
function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
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
  // Containment is the Gmail-signature-appended case. But if the ORIGINAL
  // draft already contained the suggestion as a substring, `includes` can
  // pass while the actual insert silently failed (cursor moved, ZWSP
  // inserted elsewhere). Require the suggestion to be *newly present* —
  // not in `before` but in `after`.
  if (nBefore.includes(nSuggestion)) return false;
  return nAfter.includes(nSuggestion);
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

// Make functions available globally when loaded as a content script (non-module),
// and via the test wrapper (tests/lib-exports.mjs) for vitest.
if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardLib = {
    detectPlatform,
    parseApiResponse,
    cleanSiteInput,
    validateApiKey,
    getStrictnessLabel,
    getReadabilityClass,
    getConfidenceClass,
    shouldAnalyze,
    precheckAnalysis,
    makeAnalysisError,
    getSiteProfile,
    sanitizeTelemetryEvent,
    truncate,
    extractMentions,
    hashApiKey,
    normalizeEditorText,
    verifyInsertedText
  };
}
