// ESM wrapper for merge.js — used by vitest.
// Same pattern as lib-exports.mjs.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mergePath = join(__dirname, "..", "src", "sync", "merge.js");
const mergeCode = readFileSync(mergePath, "utf-8");

const sandbox = { globalThis: {} };
vm.runInNewContext(mergeCode, sandbox);

const merge = sandbox.globalThis.__toneGuardMerge;

export const mergeDecisions = merge.mergeDecisions;
export const mergeVoiceSamples = merge.mergeVoiceSamples;
export const mergeRelationships = merge.mergeRelationships;
export const mergeCustomRules = merge.mergeCustomRules;
export const mergeStatsHistory = merge.mergeStatsHistory;
