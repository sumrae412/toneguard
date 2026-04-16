import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  parseApiResponse,
  cleanSiteInput,
  validateApiKey,
  getStrictnessLabel,
  getReadabilityClass,
  getConfidenceClass,
  shouldAnalyze,
  truncate,
  extractMentions
} from "./lib-exports.mjs";

describe("detectPlatform", () => {
  it("detects Slack", () => {
    expect(detectPlatform("app.slack.com")).toBe("slack");
  });

  it("detects Gmail", () => {
    expect(detectPlatform("mail.google.com")).toBe("gmail");
  });

  it("detects LinkedIn", () => {
    expect(detectPlatform("www.linkedin.com")).toBe("linkedin");
  });

  it("detects TurboTenant", () => {
    expect(detectPlatform("app.turbotenant.com")).toBe("turbotenant");
  });

  it("returns generic for unknown sites", () => {
    expect(detectPlatform("www.notion.so")).toBe("generic");
    expect(detectPlatform("example.com")).toBe("generic");
  });
});

describe("parseApiResponse", () => {
  it("parses raw JSON", () => {
    const result = parseApiResponse('{"flagged": true, "suggestion": "test"}');
    expect(result).toEqual({ flagged: true, suggestion: "test" });
  });

  it("parses JSON wrapped in markdown code blocks", () => {
    const raw = '```json\n{"flagged": false, "reasoning": ""}\n```';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ flagged: false, reasoning: "" });
  });

  it("parses JSON with surrounding text", () => {
    const raw = 'Here is the result:\n{"flagged": true}\nEnd.';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ flagged: true });
  });

  it("returns null for empty input", () => {
    expect(parseApiResponse("")).toBeNull();
    expect(parseApiResponse(null)).toBeNull();
    expect(parseApiResponse(undefined)).toBeNull();
  });

  it("returns null for text with no JSON", () => {
    expect(parseApiResponse("no json here")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseApiResponse("{not valid json}")).toBeNull();
  });

  // Regression: Claude Haiku 4.5 pretty-prints JSON responses with literal
  // newlines in structural whitespace. Prior sanitizer (service-worker.js)
  // escaped \n globally, producing \n (backslash-n) in structural positions
  // which JSON.parse rejects at "position 1 column 2".
  it("parses pretty-printed JSON with structural newlines", () => {
    const raw = '{\n  "flagged": true,\n  "suggestion": "test"\n}';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ flagged: true, suggestion: "test" });
  });

  it("parses JSON with literal newlines INSIDE string values", () => {
    // Raw Claude response — literal \n inside the suggestion string
    // (technically invalid JSON, but Claude sometimes emits it). The
    // sanitizer must escape only the in-string newlines, not structural.
    const raw = '{\n  "flagged": true,\n  "suggestion": "Line 1\nLine 2"\n}';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ flagged: true, suggestion: "Line 1\nLine 2" });
  });

  it("parses pretty-printed JSON wrapped in markdown fences", () => {
    const raw = '```json\n{\n  "flagged": false\n}\n```';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ flagged: false });
  });

  it("handles tabs and carriage returns in structural positions", () => {
    const raw = '{\r\n\t"flagged": true\r\n}';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ flagged: true });
  });

  it("preserves escaped newlines inside strings (already-escaped)", () => {
    const raw = '{"suggestion": "line 1\\nline 2"}';
    const result = parseApiResponse(raw);
    expect(result).toEqual({ suggestion: "line 1\nline 2" });
  });
});

describe("cleanSiteInput", () => {
  it("strips https protocol", () => {
    expect(cleanSiteInput("https://example.com")).toBe("example.com");
  });

  it("strips http protocol", () => {
    expect(cleanSiteInput("http://example.com")).toBe("example.com");
  });

  it("strips trailing slashes", () => {
    expect(cleanSiteInput("example.com///")).toBe("example.com");
  });

  it("lowercases", () => {
    expect(cleanSiteInput("Example.COM")).toBe("example.com");
  });

  it("handles full URL with path", () => {
    expect(cleanSiteInput("https://app.slack.com/")).toBe("app.slack.com");
  });

  it("returns null for invalid domains", () => {
    expect(cleanSiteInput("nodot")).toBeNull();
    expect(cleanSiteInput("")).toBeNull();
    expect(cleanSiteInput(null)).toBeNull();
  });
});

describe("validateApiKey", () => {
  it("accepts valid key", () => {
    expect(validateApiKey("sk-ant-abc123")).toEqual({ valid: true });
  });

  it("rejects empty key", () => {
    const result = validateApiKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects null key", () => {
    expect(validateApiKey(null).valid).toBe(false);
  });

  it("rejects key with wrong prefix", () => {
    const result = validateApiKey("sk-wrong-prefix");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sk-ant-");
  });
});

describe("getStrictnessLabel", () => {
  it("returns Gentle for 1", () => {
    expect(getStrictnessLabel(1)).toBe("Gentle");
  });

  it("returns Balanced for 2", () => {
    expect(getStrictnessLabel(2)).toBe("Balanced");
  });

  it("returns Strict for 3", () => {
    expect(getStrictnessLabel(3)).toBe("Strict");
  });

  it("defaults to Balanced for unknown", () => {
    expect(getStrictnessLabel(99)).toBe("Balanced");
    expect(getStrictnessLabel(undefined)).toBe("Balanced");
  });
});

describe("getReadabilityClass", () => {
  it("returns good for grade 9 and below", () => {
    expect(getReadabilityClass(5)).toBe("good");
    expect(getReadabilityClass(9)).toBe("good");
  });

  it("returns medium for grade 10-12", () => {
    expect(getReadabilityClass(10)).toBe("medium");
    expect(getReadabilityClass(12)).toBe("medium");
  });

  it("returns hard for grade 13+", () => {
    expect(getReadabilityClass(13)).toBe("hard");
    expect(getReadabilityClass(16)).toBe("hard");
  });

  it("returns empty for 0 or null", () => {
    expect(getReadabilityClass(0)).toBe("");
    expect(getReadabilityClass(null)).toBe("");
  });
});

describe("getConfidenceClass", () => {
  it("returns high for 0.9+", () => {
    expect(getConfidenceClass(0.9)).toBe("high");
    expect(getConfidenceClass(1.0)).toBe("high");
  });

  it("returns medium for 0.6-0.89", () => {
    expect(getConfidenceClass(0.6)).toBe("medium");
    expect(getConfidenceClass(0.8)).toBe("medium");
  });

  it("returns low for below 0.6", () => {
    expect(getConfidenceClass(0.3)).toBe("low");
    expect(getConfidenceClass(0.0)).toBe("low");
  });
});

describe("shouldAnalyze", () => {
  it("returns true for text 10+ chars", () => {
    expect(shouldAnalyze("hello world")).toBe(true);
  });

  it("returns false for short text", () => {
    expect(shouldAnalyze("hi")).toBe(false);
  });

  it("returns false for empty/null", () => {
    expect(shouldAnalyze("")).toBeFalsy();
    expect(shouldAnalyze(null)).toBeFalsy();
    expect(shouldAnalyze(undefined)).toBeFalsy();
  });

  it("trims whitespace before checking", () => {
    expect(shouldAnalyze("   hi   ")).toBe(false);
    expect(shouldAnalyze("   hello world   ")).toBe(true);
  });
});

describe("truncate", () => {
  it("returns full text if under max", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  it("truncates with ellipsis if over max", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("handles empty/null", () => {
    expect(truncate("", 10)).toBe("");
    expect(truncate(null, 10)).toBe("");
  });
});

describe("extractMentions", () => {
  it("extracts single mention", () => {
    expect(extractMentions("hey @alice check this")).toEqual(["alice"]);
  });

  it("extracts multiple mentions", () => {
    expect(extractMentions("@alice and @bob please review")).toEqual(["alice", "bob"]);
  });

  it("handles mentions with dots and dashes", () => {
    expect(extractMentions("cc @john.doe and @jane-smith")).toEqual(["john.doe", "jane-smith"]);
  });

  it("returns empty for no mentions", () => {
    expect(extractMentions("no mentions here")).toEqual([]);
  });

  it("returns empty for null/undefined", () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions(undefined)).toEqual([]);
  });
});
