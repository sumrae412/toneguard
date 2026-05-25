#!/usr/bin/env node
// Parity scanner: reads canonical taxonomies from shared/analysis/*.json,
// extracts each client's local enumerations, compares, and renders
// docs/client-parity.md. With --check, exits non-zero if the regenerated
// doc differs from disk (CI gate).
//
// Two axes, per gotcha_parity_doc_two_axis_drift.md:
//   1. Taxonomy axis  — does each client's enumerated set equal canonical?
//   2. Feature axis   — does each client have a grep-detectable implementation
//                       of each capability row?

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const GENERATED_HEADER =
  "<!-- Generated from shared/analysis/*.json + scripts/parity_manifest.json by scripts/parity_scan.mjs. Do not edit directly. -->\n\n";

// ---------- extractors ----------

export function extractObjectKeys(source, pattern) {
  const m = source.match(pattern);
  if (!m) return null;
  const body = m[1];
  const keys = [];
  for (const line of body.split("\n")) {
    const km = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (km) keys.push(km[1]);
  }
  return keys.length ? keys : null;
}

export function extractPythonDictKeys(source, pattern) {
  const m = source.match(pattern);
  if (!m) return null;
  const body = m[1];
  const keys = [];
  const re = /["']([^"']+)["']\s*:/g;
  let km;
  while ((km = re.exec(body)) !== null) keys.push(km[1]);
  return keys.length ? keys : null;
}

export function extractStringList(source, pattern) {
  const m = source.match(pattern);
  if (!m) return null;
  const body = m[1];
  const items = [];
  const re = /["']([^"']+)["']/g;
  let km;
  while ((km = re.exec(body)) !== null) items.push(km[1]);
  return items.length ? items : null;
}

const EXTRACTORS = {
  "object-keys": extractObjectKeys,
  "python-dict-keys": extractPythonDictKeys,
  "string-list": extractStringList
};

// ---------- canonical loading ----------

function loadCanonical(root) {
  const modes = JSON.parse(fs.readFileSync(path.join(root, "shared/analysis/modes.json"), "utf8"));
  const categories = JSON.parse(fs.readFileSync(path.join(root, "shared/analysis/categories.json"), "utf8"));
  const voiceStrengths = JSON.parse(
    fs.readFileSync(path.join(root, "shared/analysis/voice-strengths.json"), "utf8")
  );
  return {
    intent_modes: modes.intent_modes.map((m) => m.id),
    response_modes: modes.response_modes.map((m) => m.id),
    categories: categories.categories.map((c) => c.id),
    voice_strengths: voiceStrengths.voice_strengths.map((v) => v.id)
  };
}

// ---------- probing ----------

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function readSource(root, relPath, overrides) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, relPath)) {
    return overrides[relPath];
  }
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return null;
  if (fs.statSync(abs).isDirectory()) return null;
  return fs.readFileSync(abs, "utf8");
}

function probeFeature(root, feature, overrides) {
  if (!feature) return false;
  const target = path.join(root, feature.file);
  const re = new RegExp(feature.pattern);
  if (feature.recursive && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const stack = [target];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (re.test(fs.readFileSync(full, "utf8"))) {
          return true;
        }
      }
    }
    return false;
  }
  const src = readSource(root, feature.file, overrides);
  if (src === null) return false;
  return re.test(src);
}

export function scanParity(root = DEFAULT_ROOT, options = {}) {
  const overrides = options.overrideSources || null;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts/parity_manifest.json"), "utf8"));
  const canonical = loadCanonical(root);

  const clients = manifest.clients.map((client) => {
    const probes = client.probes.map((probe) => {
      if (probe.passthrough) {
        return {
          axis: probe.axis,
          status: "passthrough",
          note: probe.note || "",
          extracted: null,
          canonical: canonical[probe.axis] || null,
          file: null
        };
      }
      const extractor = EXTRACTORS[probe.extract];
      if (!extractor) {
        throw new Error(`Unknown extractor: ${probe.extract}`);
      }
      const src = readSource(root, probe.file, overrides);
      if (src === null) {
        return {
          axis: probe.axis,
          status: "missing",
          extracted: null,
          canonical: canonical[probe.axis] || null,
          file: probe.file,
          error: `file not found: ${probe.file}`
        };
      }
      const extracted = extractor(src, new RegExp(probe.pattern));
      if (extracted === null) {
        return {
          axis: probe.axis,
          status: "missing",
          extracted: null,
          canonical: canonical[probe.axis] || null,
          file: probe.file,
          error: `pattern did not match in ${probe.file}`
        };
      }
      const canonicalSet = canonical[probe.axis];
      const status = arraysEqual(extracted, canonicalSet) ? "match" : "drift";
      return { axis: probe.axis, status, extracted, canonical: canonicalSet, file: probe.file };
    });

    const features = {};
    for (const row of manifest.feature_rows) {
      features[row.id] = probeFeature(root, client.features?.[row.id], overrides);
    }

    return { id: client.id, label: client.label, language: client.language, probes, features };
  });

  return { canonical, clients, manifest };
}

// ---------- rendering ----------

function cellForFeature(present) {
  return present ? "✅" : "—";
}

function cellForTaxonomy(probe) {
  if (probe.status === "passthrough") return "passthrough";
  if (probe.status === "match") return "✅ canonical";
  if (probe.status === "drift") return `⚠️ drift (${probe.extracted.join(", ")})`;
  if (probe.status === "missing") return `❌ missing (${probe.file})`;
  return "?";
}

export function renderParityMarkdown(result) {
  const lines = [];
  lines.push(GENERATED_HEADER.trimEnd());
  lines.push("");
  lines.push("# ToneGuard Client Parity");
  lines.push("");
  lines.push(
    "Each row is a capability or canonical taxonomy. Each column is a client surface. " +
      "Generated from `shared/analysis/*.json` + `scripts/parity_manifest.json` by " +
      "`scripts/parity_scan.mjs`. Run `node scripts/parity_scan.mjs` to regenerate; " +
      "`node scripts/parity_scan.mjs --check` is wired into CI."
  );
  lines.push("");
  lines.push("## Canonical taxonomy match (per client)");
  lines.push("");

  const taxonomies = ["intent_modes", "voice_strengths"];
  const header = ["Taxonomy", ...result.clients.map((c) => c.label)];
  lines.push("| " + header.join(" | ") + " |");
  lines.push("|" + header.map(() => "---").join("|") + "|");
  for (const axis of taxonomies) {
    const row = [`\`${axis}\``];
    for (const client of result.clients) {
      const probe = client.probes.find((p) => p.axis === axis);
      row.push(probe ? cellForTaxonomy(probe) : "—");
    }
    lines.push("| " + row.join(" | ") + " |");
  }
  lines.push("");

  lines.push("## Feature presence");
  lines.push("");
  const fHeader = ["Capability", ...result.clients.map((c) => c.label)];
  lines.push("| " + fHeader.join(" | ") + " |");
  lines.push("|" + fHeader.map(() => "---").join("|") + "|");
  for (const row of result.manifest.feature_rows) {
    const cells = [row.label];
    for (const client of result.clients) {
      cells.push(cellForFeature(client.features[row.id]));
    }
    lines.push("| " + cells.join(" | ") + " |");
  }
  lines.push("");

  lines.push("## Canonical taxonomy values");
  lines.push("");
  lines.push("- `intent_modes`: " + result.canonical.intent_modes.map((s) => `\`${s}\``).join(", "));
  lines.push("- `voice_strengths`: " + result.canonical.voice_strengths.map((s) => `\`${s}\``).join(", "));
  lines.push("- `response_modes`: " + result.canonical.response_modes.map((s) => `\`${s || "(empty)"}\``).join(", "));
  lines.push("- `categories`: " + result.canonical.categories.map((s) => `\`${s}\``).join(", "));
  lines.push("");

  lines.push("## Drift policy");
  lines.push("");
  lines.push(
    "Any `⚠️ drift` cell fails CI via `node scripts/parity_scan.mjs --check`. " +
      "MCP intent modes are `passthrough` — the server forwards them to the LLM rather than enumerating locally, so drift is not measurable. " +
      "Voice strength canonical lives at [`shared/analysis/voice-strengths.json`](../shared/analysis/voice-strengths.json); " +
      "intent modes and response modes live at [`shared/analysis/modes.json`](../shared/analysis/modes.json); " +
      "categories at [`shared/analysis/categories.json`](../shared/analysis/categories.json)."
  );
  lines.push("");

  return lines.join("\n") + "\n";
}

// ---------- CLI ----------

function main() {
  const checkOnly = process.argv.includes("--check");
  const result = scanParity(DEFAULT_ROOT);
  const md = renderParityMarkdown(result);
  const target = path.join(DEFAULT_ROOT, "docs/client-parity.md");

  // First, fail loudly on drift regardless of mode.
  const driftLines = [];
  for (const client of result.clients) {
    for (const probe of client.probes) {
      if (probe.status === "drift") {
        driftLines.push(
          `  ${client.id}.${probe.axis}: ${JSON.stringify(probe.extracted)} != canonical ${JSON.stringify(probe.canonical)}`
        );
      } else if (probe.status === "missing") {
        driftLines.push(`  ${client.id}.${probe.axis}: ${probe.error}`);
      }
    }
  }
  if (driftLines.length) {
    console.error("Parity drift detected:");
    for (const l of driftLines) console.error(l);
    process.exit(1);
  }

  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (current === md) {
    return;
  }
  if (checkOnly) {
    console.error(
      "docs/client-parity.md is stale. Run: node scripts/parity_scan.mjs"
    );
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, md);
  console.log("Regenerated docs/client-parity.md");
}

const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  main();
}
