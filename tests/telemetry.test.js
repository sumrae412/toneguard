import { describe, it, expect } from "vitest";
import { sanitizeTelemetryEvent } from "./lib-exports.mjs";

describe("sanitizeTelemetryEvent", () => {
  it("accepts allowlisted local telemetry fields", () => {
    const result = sanitizeTelemetryEvent({
      event: "analysis_completed",
      timestamp: "2026-04-27T00:00:00.000Z",
      platform: "chrome",
      site_profile: "slack",
      route: "standard",
      model: "claude-haiku-4-5-20251001",
      latency_bucket: "1_3s",
      issue_categories: ["tone"],
      outcome: "accepted"
    });

    expect(result.ok).toBe(true);
    expect(result.event.event).toBe("analysis_completed");
  });

  it("rejects raw message-like and prompt fields by key", () => {
    expect(sanitizeTelemetryEvent({
      event: "analysis_completed",
      timestamp: "2026-04-27T00:00:00.000Z",
      message: "Please review this private draft."
    })).toEqual({ ok: false, error: "disallowed_field:message" });

    expect(sanitizeTelemetryEvent({
      event: "analysis_completed",
      timestamp: "2026-04-27T00:00:00.000Z",
      prompt: "system prompt"
    })).toEqual({ ok: false, error: "disallowed_field:prompt" });
  });

  it("rejects private-looking string values", () => {
    const privateValues = [
      ["model", "sk-ant-secret"],
      ["platform", "person@example.com"],
      ["site_profile", "https://example.com/path"],
      ["failure_diagnostic_code", "555-123-4567"]
    ];

    for (const [field, value] of privateValues) {
      const result = sanitizeTelemetryEvent({
        event: "analysis_failed",
        timestamp: "2026-04-27T00:00:00.000Z",
        [field]: value
      });
      expect(result.ok, field).toBe(false);
    }
  });
});
