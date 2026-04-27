#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

const GENERATED_HEADER = "Generated from shared/. Do not edit directly.\n\n";
const JS_GENERATED_HEADER = "// Generated from shared/. Do not edit directly.\n\n";

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : value + "\n";
}

function writeOrCheck(relativePath, content) {
  const target = path.join(root, relativePath);
  const normalized = ensureTrailingNewline(content.replace(/\r\n/g, "\n"));
  const current = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")
    : null;

  if (current === normalized) return [];
  if (checkOnly) return [relativePath];

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, normalized);
  return [];
}

function validateTaxonomies(schema, modes, categories) {
  const responseModeIds = modes.response_modes.map((mode) => mode.id);
  const categoryIds = categories.categories.map((category) => category.id);
  const schemaModes = schema.properties.mode.enum;
  const schemaCategories = schema.properties.categories.items.enum;
  const issueBranches = schema.properties.issues.items.anyOf || [schema.properties.issues.items];
  const structuredIssueBranch = issueBranches.find((branch) => branch.properties?.category);
  const schemaIssueCategories = structuredIssueBranch?.properties.category.enum;

  if (JSON.stringify(responseModeIds) !== JSON.stringify(schemaModes)) {
    throw new Error("shared/analysis/schema.json mode enum is stale");
  }
  if (JSON.stringify(categoryIds) !== JSON.stringify(schemaCategories)) {
    throw new Error("shared/analysis/schema.json category enum is stale");
  }
  if (!schemaIssueCategories) {
    throw new Error("shared/analysis/schema.json structured issue category enum is missing");
  }
  if (JSON.stringify(categoryIds) !== JSON.stringify(schemaIssueCategories)) {
    throw new Error("shared/analysis/schema.json issue category enum is stale");
  }
}

function buildPwaPromptModule(basePrompt, landingPrompt) {
  return (
    JS_GENERATED_HEADER +
    "export const TONEGUARD_BASE_PROMPT = " +
    JSON.stringify(basePrompt) +
    ";\n\n" +
    "export const TONEGUARD_LANDING_PROMPT = " +
    JSON.stringify(landingPrompt) +
    ";\n"
  );
}

const schema = readJson("shared/analysis/schema.json");
const modes = readJson("shared/analysis/modes.json");
const categories = readJson("shared/analysis/categories.json");
validateTaxonomies(schema, modes, categories);

const basePrompt = readText("shared/prompts/base.md");
const landingPrompt = readText("shared/prompts/landing.md");
const stale = [
  ...writeOrCheck("prompts/base.txt", GENERATED_HEADER + basePrompt),
  ...writeOrCheck("prompts/landing.txt", GENERATED_HEADER + landingPrompt),
  ...writeOrCheck("toneguard-mcp/critics/landing.md", GENERATED_HEADER + landingPrompt),
  ...writeOrCheck("pwa/generated-prompts.js", buildPwaPromptModule(basePrompt, landingPrompt)),
  ...writeOrCheck("android/app/src/main/res/raw/toneguard_base_prompt.txt", GENERATED_HEADER + basePrompt)
];

if (stale.length > 0) {
  console.error(
    "Generated artifacts are stale. Run: node scripts/generate_shared_artifacts.mjs\n" +
      stale.map((file) => " - " + file).join("\n")
  );
  process.exit(1);
}
