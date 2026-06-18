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

function validateTaxonomies(schema, modes, categories, voiceStrengths) {
  const responseModeIds = modes.response_modes.map((mode) => mode.id);
  const categoryIds = categories.categories.map((category) => category.id);
  const schemaModes = schema.properties.mode.enum;
  const schemaCategories = schema.properties.categories.items.enum;
  if (JSON.stringify(responseModeIds) !== JSON.stringify(schemaModes)) {
    throw new Error("shared/analysis/schema.json mode enum is stale");
  }
  if (JSON.stringify(categoryIds) !== JSON.stringify(schemaCategories)) {
    throw new Error("shared/analysis/schema.json category enum is stale");
  }

  if (!Array.isArray(voiceStrengths?.voice_strengths) || voiceStrengths.voice_strengths.length === 0) {
    throw new Error("shared/analysis/voice-strengths.json missing voice_strengths array");
  }
  const voiceIds = voiceStrengths.voice_strengths.map((v) => v.id);
  if (!voiceIds.includes(voiceStrengths.default)) {
    throw new Error(
      `shared/analysis/voice-strengths.json default '${voiceStrengths.default}' is not in voice_strengths list`
    );
  }
}

// Forced-tool name shared by every analysis caller. The model is told to call
// this tool, and the API returns its arguments as an already-parsed object —
// no free-text JSON parsing, which eliminates the stray-quote / control-char /
// markdown-fence parse failures (TG_PARSE_001).
const ANALYSIS_TOOL_NAME = "report_analysis";

// Build the forced-tool input schema from the canonical analysis schema.
// `routing` is attached client-side (not produced by the model), so it is
// stripped. Everything else mirrors shared/analysis/schema.json.
function buildAnalysisTool(schema) {
  const inputSchema = JSON.parse(JSON.stringify(schema));
  delete inputSchema.$schema;
  delete inputSchema.$id;
  delete inputSchema.title;
  if (inputSchema.properties) delete inputSchema.properties.routing;
  return {
    name: ANALYSIS_TOOL_NAME,
    description:
      "Report the tone, clarity, and professionalism analysis of the reviewed " +
      "message. Always call this tool with the complete structured result.",
    input_schema: inputSchema
  };
}

const LANDING_TOOL_NAME = "report_landing";

// Build the landing-view forced-tool schema from shared/analysis/landing-schema.json.
function buildLandingTool(schema) {
  const inputSchema = JSON.parse(JSON.stringify(schema));
  delete inputSchema.$schema;
  delete inputSchema.$id;
  delete inputSchema.title;
  return {
    name: LANDING_TOOL_NAME,
    description:
      "Report how the message lands on a single skim: the takeaway, the tone " +
      "felt, and the next action. Use null for messages too short to analyze.",
    input_schema: inputSchema
  };
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
const landingSchema = readJson("shared/analysis/landing-schema.json");
const modes = readJson("shared/analysis/modes.json");
const categories = readJson("shared/analysis/categories.json");
const voiceStrengths = readJson("shared/analysis/voice-strengths.json");
validateTaxonomies(schema, modes, categories, voiceStrengths);

const basePrompt = readText("shared/prompts/base.md");
const landingPrompt = readText("shared/prompts/landing.md");
const analysisTool = buildAnalysisTool(schema);
const landingTool = buildLandingTool(landingSchema);
const stale = [
  ...writeOrCheck("prompts/base.txt", GENERATED_HEADER + basePrompt),
  ...writeOrCheck("prompts/landing.txt", GENERATED_HEADER + landingPrompt),
  // Forced-tool schema, fetched at runtime by each client (extension from
  // prompts/, PWA from its own served directory). Pure JSON — no header comment.
  ...writeOrCheck("prompts/analysis-tool.json", JSON.stringify(analysisTool, null, 2)),
  ...writeOrCheck("sync-server/pwa/analysis-tool.json", JSON.stringify(analysisTool, null, 2)),
  ...writeOrCheck("prompts/landing-tool.json", JSON.stringify(landingTool, null, 2)),
  ...writeOrCheck("toneguard-mcp/critics/landing-tool.json", JSON.stringify(landingTool, null, 2)),
  ...writeOrCheck("toneguard-mcp/critics/landing.md", GENERATED_HEADER + landingPrompt),
  ...writeOrCheck("sync-server/pwa/generated-prompts.js", buildPwaPromptModule(basePrompt, landingPrompt)),
  ...writeOrCheck("android/app/src/main/res/raw/toneguard_base_prompt.txt", GENERATED_HEADER + basePrompt)
];

if (stale.length > 0) {
  console.error(
    "Generated artifacts are stale. Run: node scripts/generate_shared_artifacts.mjs\n" +
      stale.map((file) => " - " + file).join("\n")
  );
  process.exit(1);
}
