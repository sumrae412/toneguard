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
    truncate,
    extractMentions,
    hashApiKey
  };
}
