import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseApiResponse, precheckAnalysis } from "./lib-exports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const corpus = readJson("tests/fixtures/analysis-corpus.json");
const schema = readJson("shared/analysis/schema.json");
const modes = readJson("shared/analysis/modes.json");
const categories = readJson("shared/analysis/categories.json");
const allowedResponseModes = new Set(modes.response_modes.map((mode) => mode.id));
const allowedCategories = new Set(categories.categories.map((category) => category.id));
const forbiddenPrivacyPatterns = [
  /sk-ant-[A-Za-z0-9_-]+/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /https?:\/\//i,
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/
];

function validateAnalysisResult(result) {
  expect(result).toHaveProperty("flagged");
  expect(typeof result.flagged).toBe("boolean");

  if (Object.hasOwn(result, "confidence")) {
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  }

  if (Object.hasOwn(result, "mode")) {
    expect(allowedResponseModes.has(result.mode)).toBe(true);
  }

  if (Object.hasOwn(result, "categories")) {
    expect(Array.isArray(result.categories)).toBe(true);
    for (const category of result.categories) {
      expect(allowedCategories.has(category), "Unknown category: " + category).toBe(true);
    }
  }

  if (Object.hasOwn(result, "questions")) {
    expect(Array.isArray(result.questions)).toBe(true);
    expect(result.questions.length).toBeLessThanOrEqual(3);
  }

  if (Object.hasOwn(result, "issues")) {
    expect(Array.isArray(result.issues)).toBe(true);
    for (const issue of result.issues) {
      expect(typeof issue.explanation, "Issue explanation is required").toBe("string");
      if (Object.hasOwn(issue, "category")) {
        expect(allowedCategories.has(issue.category), "Unknown issue category: " + issue.category).toBe(true);
      }
      if (Object.hasOwn(issue, "severity")) {
        expect(["low", "medium", "high"]).toContain(issue.severity);
      }
      if (Object.hasOwn(issue, "quote_confidence")) {
        expect(["exact", "approximate", "missing"]).toContain(issue.quote_confidence);
      }
    }
  }
}

describe("analysis fixture corpus", () => {
  it("is explicitly synthetic and privacy-safe", () => {
    expect(corpus.privacy.source).toBe("synthetic");
    expect(corpus.privacy.contains_real_user_text).toBe(false);

    for (const fixture of corpus.fixtures) {
      expect(fixture.synthetic, fixture.id).toBe(true);
      for (const pattern of forbiddenPrivacyPatterns) {
        expect(pattern.test(fixture.message), fixture.id + " contains private-looking text").toBe(false);
      }
    }
  });

  it("covers the planned Phase 2 fixture categories", () => {
    expect(corpus.fixtures.map((fixture) => fixture.id)).toEqual([
      "safe_short_ack",
      "passive_aggressive",
      "defensive",
      "unclear_ask",
      "hedged",
      "high_stakes_conflict",
      "boundary_setting",
      "parse_edge",
      "non_issue_casual"
    ]);
  });

  it("keeps expected outputs schema-compatible", () => {
    expect(schema.required).toContain("flagged");
    for (const fixture of corpus.fixtures) {
      validateAnalysisResult(fixture.expected);
    }
  });
});

describe("analysis parser contract", () => {
  it("parses every fixture model response into schema-compatible output", () => {
    for (const fixture of corpus.fixtures) {
      const parsed = parseApiResponse(fixture.model_response);
      expect(parsed, fixture.id).not.toBeNull();
      validateAnalysisResult(parsed);
      expect(parsed.flagged, fixture.id).toBe(fixture.expected.flagged);
      expect(parsed.mode ?? "", fixture.id).toBe(fixture.expected.mode);
    }
  });

  it("accepts legacy and structured issue objects", () => {
    const legacy = {
      flagged: true,
      issues: [{ rule: "unclear", quote: "the thing", explanation: "This is vague." }]
    };
    const structured = {
      flagged: true,
      issues: [{
        quote: "the thing",
        category: "clarity",
        severity: "medium",
        explanation: "This is vague.",
        suggested_fix: "Name the task.",
        quote_confidence: "exact"
      }]
    };

    validateAnalysisResult(legacy);
    validateAnalysisResult(structured);
  });
});

describe("analysis precheck contract", () => {
  it("routes corpus fixtures conservatively", () => {
    const routesByFixture = Object.fromEntries(
      corpus.fixtures.map((fixture) => [
        fixture.id,
        precheckAnalysis(fixture.message).route
      ])
    );

    expect(routesByFixture.safe_short_ack).toBe("local_pass");
    expect(routesByFixture.passive_aggressive).toBe("standard");
    expect(routesByFixture.defensive).toBe("deep");
    expect(routesByFixture.unclear_ask).toBe("standard");
    expect(routesByFixture.hedged).toBe("standard");
    expect(routesByFixture.high_stakes_conflict).toBe("standard");
    expect(routesByFixture.boundary_setting).toBe("standard");
    expect(routesByFixture.parse_edge).toBe("standard");
    expect(routesByFixture.non_issue_casual).toBe("standard");
  });
});
