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
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.permissions).toContain("scripting");
  });

  it("has Anthropic API in host_permissions", () => {
    expect(manifest.host_permissions).toContain("https://api.anthropic.com/*");
  });

  it("declares service worker", () => {
    expect(manifest.background.service_worker).toBe("service-worker.js");
  });

  it("declares content scripts for all built-in sites", () => {
    const matches = manifest.content_scripts[0].matches;
    expect(matches).toContain("https://app.slack.com/*");
    expect(matches).toContain("https://mail.google.com/*");
    expect(matches).toContain("https://www.linkedin.com/*");
    expect(matches).toContain("https://*.turbotenant.com/*");
  });

  it("declares side panel", () => {
    expect(manifest.side_panel.default_path).toBe("panel.html");
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

  it("references files that exist", () => {
    const root = path.join(__dirname, "..");
    const filesToCheck = [
      manifest.background.service_worker,
      manifest.content_scripts[0].js[0],
      manifest.side_panel.default_path,
      manifest.action.default_popup,
      manifest.options_page
    ];

    for (const file of filesToCheck) {
      expect(fs.existsSync(path.join(root, file)), "Missing: " + file).toBe(true);
    }
  });

  it("references icon files that exist", () => {
    const root = path.join(__dirname, "..");
    for (const iconPath of Object.values(manifest.icons)) {
      expect(fs.existsSync(path.join(root, iconPath)), "Missing icon: " + iconPath).toBe(true);
    }
  });
});
