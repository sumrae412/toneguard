import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const jsFiles = ["content.js", "service-worker.js", "panel.js", "popup.js", "options.js", "lib.js"];

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
  const htmlFiles = ["panel.html", "popup.html", "options.html"];

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

describe("CSS files exist", () => {
  it("panel.css exists and has content", () => {
    const filePath = path.join(root, "panel.css");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });
});
