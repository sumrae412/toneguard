import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PWA_DIR = resolve(__dirname, "..", "pwa");
const readPwa = (rel) => readFileSync(resolve(PWA_DIR, rel), "utf8");

describe("PWA install criteria", () => {
  const manifest = JSON.parse(readPwa("manifest.json"));

  it("declares a 192x192 PNG icon (Android Chrome install prompt requirement)", () => {
    const has192 = manifest.icons.some(
      (i) => i.sizes === "192x192" && i.type === "image/png"
    );
    expect(has192).toBe(true);
  });

  it("declares a 512x512 PNG icon (Android Chrome install prompt requirement)", () => {
    const has512 = manifest.icons.some(
      (i) => i.sizes === "512x512" && i.type === "image/png"
    );
    expect(has512).toBe(true);
  });

  it("declares a maskable icon at >=192px (Android adaptive-icon support)", () => {
    const hasMaskable = manifest.icons.some(
      (i) =>
        typeof i.purpose === "string" &&
        i.purpose.includes("maskable") &&
        i.type === "image/png" &&
        parseInt(i.sizes, 10) >= 192
    );
    expect(hasMaskable).toBe(true);
  });

  it("uses self-contained icon paths (no '..' escape)", () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("..")).toBe(false);
    }
    const indexHtml = readPwa("index.html");
    expect(indexHtml).not.toMatch(/href=["']\.\.\/icons\//);
    expect(indexHtml).not.toMatch(/src=["']\.\.\/icons\//);
    const sw = readPwa("sw.js");
    expect(sw).not.toMatch(/['"]\.\.\/icons\//);
  });

  it("apple-touch-icon points at a 180px asset", () => {
    const indexHtml = readPwa("index.html");
    expect(indexHtml).toMatch(/apple-touch-icon["'][^>]*icon180\.png/);
  });
});
