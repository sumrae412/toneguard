import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import {
  scanParity,
  extractObjectKeys,
  extractPythonDictKeys,
  extractStringList,
  renderParityMarkdown
} from "../scripts/parity_scan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

describe("parity_scan extractors", () => {
  it("extracts JS object keys from a multi-line const block", () => {
    const src = [
      "const INTENT_MODE_LABELS = {",
      "  professional: \"Professional\",",
      "  warm: \"Warm\",",
      "  direct: \"Direct\",",
      "  deescalating: \"De-escalating\",",
      "  boundary: \"Boundary\",",
      "  concise: \"Concise\"",
      "};"
    ].join("\n");
    expect(extractObjectKeys(src, /const INTENT_MODE_LABELS = \{([\s\S]*?)\};/)).toEqual([
      "professional",
      "warm",
      "direct",
      "deescalating",
      "boundary",
      "concise"
    ]);
  });

  it("extracts Python dict keys from a multi-line dict literal", () => {
    const src = [
      "VOICE_STRENGTH_LABELS = {",
      "    \"preserve\": \"Keep the user's words and rhythm unless a phrase is the problem.\",",
      "    \"balanced\": \"Preserve style, but prioritize clarity and tone safety.\",",
      "    \"polish\": \"Edit more freely for clarity while keeping the user's intent.\",",
      "    \"rewrite\": \"Rewrite aggressively when the draft is rough.\",",
      "}"
    ].join("\n");
    expect(extractPythonDictKeys(src, /VOICE_STRENGTH_LABELS\s*=\s*\{([\s\S]*?)\}/)).toEqual([
      "preserve",
      "balanced",
      "polish",
      "rewrite"
    ]);
  });

  it("extracts a quoted string list (JS array or Kotlin listOf)", () => {
    const js = 'const allowed = ["professional", "warm", "direct", "deescalating", "boundary", "concise"];';
    expect(extractStringList(js, /const allowed = \[("professional"[^\]]*)\]/)).toEqual([
      "professional",
      "warm",
      "direct",
      "deescalating",
      "boundary",
      "concise"
    ]);
    const kotlin = 'private val voiceStrengths = listOf("preserve", "balanced", "polish", "rewrite")';
    expect(extractStringList(kotlin, /private val voiceStrengths = listOf\(([^)]+)\)/)).toEqual([
      "preserve",
      "balanced",
      "polish",
      "rewrite"
    ]);
  });

  it("returns null when pattern does not match", () => {
    expect(extractObjectKeys("nothing here", /MISSING/)).toBeNull();
    expect(extractPythonDictKeys("nothing here", /MISSING/)).toBeNull();
    expect(extractStringList("nothing here", /MISSING/)).toBeNull();
  });
});

describe("parity_scan against live source tree", () => {
  let result;

  beforeAll(() => {
    result = scanParity(root);
  });

  it("reads canonical taxonomies from shared/analysis/*.json", () => {
    expect(result.canonical.intent_modes).toEqual([
      "professional",
      "warm",
      "direct",
      "deescalating",
      "boundary",
      "concise"
    ]);
    expect(result.canonical.voice_strengths).toEqual([
      "preserve",
      "balanced",
      "polish",
      "rewrite"
    ]);
    expect(result.canonical.response_modes).toEqual(["", "tone", "polish", "both"]);
    expect(result.canonical.categories.length).toBeGreaterThanOrEqual(12);
  });

  it("finds every client probe match on the live tree (no missing constants)", () => {
    const missing = [];
    for (const client of result.clients) {
      for (const probe of client.probes) {
        if (probe.status === "passthrough") continue;
        if (probe.extracted === null) {
          missing.push(`${client.id}.${probe.axis} (file: ${probe.file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has zero taxonomy drift across all clients", () => {
    const drift = [];
    for (const client of result.clients) {
      for (const probe of client.probes) {
        if (probe.status === "drift") {
          drift.push(`${client.id}.${probe.axis}: ${JSON.stringify(probe.extracted)} != canonical ${JSON.stringify(probe.canonical)}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("marks MCP intent_modes as passthrough (does not enumerate locally)", () => {
    const mcp = result.clients.find((c) => c.id === "mcp");
    const probe = mcp.probes.find((p) => p.axis === "intent_modes");
    expect(probe.status).toBe("passthrough");
  });

  it("renders a deterministic markdown table", () => {
    const md = renderParityMarkdown(result);
    expect(md).toContain("Generated from");
    expect(md).toContain("| Capability |");
    expect(md).toContain("| Chrome |");
    expect(md).toContain("| MCP |");
    expect(md).toContain("| PWA |");
    expect(md).toContain("| Android |");
    expect(md).toContain("preserve");
    expect(md).toContain("balanced");
  });
});

describe("parity_scan drift detection (synthetic)", () => {
  it("flags drift when a client uses a stale taxonomy value", () => {
    const result = scanParity(root, {
      overrideSources: {
        "android/app/src/main/java/com/toneguard/MainActivity.kt":
          'private val intentModes = listOf("professional", "warm", "direct", "deescalating", "boundary", "concise")\n' +
          'private val voiceStrengths = listOf("light", "balanced", "strong")\n'
      }
    });
    const android = result.clients.find((c) => c.id === "android");
    const voice = android.probes.find((p) => p.axis === "voice_strengths");
    expect(voice.status).toBe("drift");
    expect(voice.extracted).toEqual(["light", "balanced", "strong"]);
  });

  it("flags missing when a client refactors a constant the manifest does not know about", () => {
    const result = scanParity(root, {
      overrideSources: {
        "android/app/src/main/java/com/toneguard/MainActivity.kt": "// constants moved elsewhere\n"
      }
    });
    const android = result.clients.find((c) => c.id === "android");
    const voice = android.probes.find((p) => p.axis === "voice_strengths");
    expect(voice.status).toBe("missing");
  });
});

describe("parity_scan --check", () => {
  it("exits 0 when docs/client-parity.md is fresh", () => {
    execFileSync("node", ["scripts/parity_scan.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  });
});

describe("voice-strengths canonical schema", () => {
  it("exposes a versioned canonical voice-strength taxonomy", () => {
    const vs = readJson("shared/analysis/voice-strengths.json");
    expect(vs.version).toBe(1);
    expect(vs.voice_strengths.map((v) => v.id)).toEqual([
      "preserve",
      "balanced",
      "polish",
      "rewrite"
    ]);
    expect(vs.default).toBe("balanced");
  });
});
