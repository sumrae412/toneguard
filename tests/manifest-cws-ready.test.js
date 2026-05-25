import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "..", "manifest.json"), "utf8")
);

describe("manifest CWS-readiness", () => {
  it("does not declare personal/SaaS host_permissions", () => {
    const banned = ["turbotenant"];
    for (const pattern of manifest.host_permissions || []) {
      for (const b of banned) {
        expect(pattern.includes(b)).toBe(false);
      }
    }
  });

  it("only declares the canonical public-surface host_permissions", () => {
    const allowed = new Set([
      "https://api.anthropic.com/*",
      "https://*.slack.com/*",
      "https://mail.google.com/*",
      "https://www.linkedin.com/*",
    ]);
    for (const pattern of manifest.host_permissions || []) {
      expect(allowed.has(pattern)).toBe(true);
    }
  });

  it("does not reference personal/SaaS sites in onboarding", () => {
    const welcomeHtml = readFileSync(
      resolve(__dirname, "..", "welcome.html"),
      "utf8"
    );
    expect(welcomeHtml).not.toMatch(/turbotenant/i);
  });
});
