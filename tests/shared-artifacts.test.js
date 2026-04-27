import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

describe("shared analysis contracts", () => {
  it("keeps schema enums aligned with shared taxonomy files", () => {
    const schema = readJson("shared/analysis/schema.json");
    const modes = readJson("shared/analysis/modes.json");
    const categories = readJson("shared/analysis/categories.json");

    const responseModes = modes.response_modes.map((mode) => mode.id);
    const categoryIds = categories.categories.map((category) => category.id);
    const issueBranches = schema.properties.issues.items.anyOf || [schema.properties.issues.items];
    const structuredIssueBranch = issueBranches.find((branch) => branch.properties?.category);

    expect(schema.properties.mode.enum).toEqual(responseModes);
    expect(schema.properties.categories.items.enum).toEqual(categoryIds);
    expect(structuredIssueBranch.properties.category.enum).toEqual(categoryIds);
  });

  it("defines the planned intent modes without changing legacy response modes", () => {
    const modes = readJson("shared/analysis/modes.json");
    const intentModes = modes.intent_modes.map((mode) => mode.id);

    expect(modes.response_modes.map((mode) => mode.id)).toEqual(["", "tone", "polish", "both"]);
    expect(intentModes).toEqual([
      "professional",
      "warm",
      "direct",
      "deescalating",
      "boundary",
      "concise"
    ]);
  });
});

describe("generated shared artifacts", () => {
  it("are fresh", () => {
    execFileSync("node", ["scripts/generate_shared_artifacts.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  });
});
