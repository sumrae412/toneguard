import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const jsFiles = [
  "content.js",
  "service-worker.js",
  "overlay.js",
  "popup.js",
  "options.js",
  "lib.js",
  "pwa/app.js",
  "pwa/generated-prompts.js"
];

describe("JavaScript syntax validation", () => {
  for (const file of jsFiles) {
    it(file + " has valid syntax", () => {
      const filePath = path.join(root, file);
      expect(fs.existsSync(filePath), "File missing: " + file).toBe(true);

      // node --check validates syntax without executing
      execFileSync("node", ["--check", filePath], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
    });
  }
});

describe("HTML files are well-formed", () => {
  const htmlFiles = ["popup.html", "options.html", "overlay.html", "pwa/index.html"];

  for (const file of htmlFiles) {
    it(file + " exists and has basic HTML structure", () => {
      const filePath = path.join(root, file);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain("<html");
      expect(content).toContain("</html>");
      expect(content).toContain("<head");
      expect(content).toContain("<body");
    });
  }
});

describe("Model output rendering safety", () => {
  it("does not use innerHTML in overlay or PWA renderers", () => {
    for (const file of ["overlay-frame.js", "pwa/app.js"]) {
      const content = fs.readFileSync(path.join(root, file), "utf-8");
      expect(content).not.toContain(".innerHTML");
      expect(content).not.toContain("innerHTML =");
    }
  });
});

describe("Prompt files", () => {
  it("base.txt exists and has content", () => {
    const filePath = path.join(root, "prompts", "base.txt");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content.length).toBeGreaterThan(500);
    expect(content).toContain("ToneGuard");
    expect(content).toContain("flagged");
  });

  it("landing.txt exists and has content", () => {
    const filePath = path.join(root, "prompts", "landing.txt");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content.length).toBeGreaterThan(500);
    expect(content).toContain("message landing");
    expect(content).toContain("takeaway");
  });
});
