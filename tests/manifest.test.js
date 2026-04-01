import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, "..", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

describe("manifest.json", () => {
  it("is valid JSON with required fields", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("ToneGuard");
    expect(manifest.version).toBeTruthy();
  });

  it("has required permissions", () => {
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.permissions).toContain("scripting");
  });

  it("does not require sidePanel permission", () => {
    expect(manifest.permissions).not.toContain("sidePanel");
  });

  it("has Anthropic API in host_permissions", () => {
    expect(manifest.host_permissions).toContain("https://api.anthropic.com/*");
  });

  it("declares service worker", () => {
    expect(manifest.background.service_worker).toBe("service-worker.js");
  });

  it("declares content scripts with overlay.js before content.js", () => {
    const js = manifest.content_scripts[0].js;
    expect(js).toContain("overlay.js");
    expect(js).toContain("content.js");
    expect(js.indexOf("overlay.js")).toBeLessThan(js.indexOf("content.js"));
  });

  it("declares content scripts for all built-in sites", () => {
    const matches = manifest.content_scripts[0].matches;
    expect(matches).toContain("https://app.slack.com/*");
    expect(matches).toContain("https://mail.google.com/*");
    expect(matches).toContain("https://www.linkedin.com/*");
    expect(matches).toContain("https://*.turbotenant.com/*");
  });

  it("declares options page", () => {
    expect(manifest.options_page).toBe("options.html");
  });

  it("declares popup", () => {
    expect(manifest.action.default_popup).toBe("popup.html");
  });

  it("has optional_host_permissions for custom sites", () => {
    expect(manifest.optional_host_permissions).toContain("https://*/*");
  });

  it("has web_accessible_resources for prompts", () => {
    const resources = manifest.web_accessible_resources;
    expect(resources).toBeTruthy();
    const promptResource = resources.find((r) => r.resources.includes("prompts/base.txt"));
    expect(promptResource).toBeTruthy();
  });

  it("references files that exist", () => {
    const root = path.join(__dirname, "..");
    const filesToCheck = [
      manifest.background.service_worker,
      ...manifest.content_scripts[0].js,
      manifest.action.default_popup,
      manifest.options_page
    ];

    for (const file of filesToCheck) {
      expect(fs.existsSync(path.join(root, file)), "Missing: " + file).toBe(true);
    }
  });

  it("web_accessible_resources files exist", () => {
    const root = path.join(__dirname, "..");
    for (const group of manifest.web_accessible_resources) {
      for (const resource of group.resources) {
        expect(fs.existsSync(path.join(root, resource)), "Missing: " + resource).toBe(true);
      }
    }
  });

  it("references icon files that exist", () => {
    const root = path.join(__dirname, "..");
    for (const iconPath of Object.values(manifest.icons)) {
      expect(fs.existsSync(path.join(root, iconPath)), "Missing icon: " + iconPath).toBe(true);
    }
  });
});
