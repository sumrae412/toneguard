// ESM wrapper for lib.js — used by vitest.
// lib.js assigns functions to globalThis.__toneGuardLib when loaded.
// This file loads it and re-exports for clean test imports.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const libPath = join(__dirname, "..", "lib.js");
const libCode = readFileSync(libPath, "utf-8");

// Run lib.js in a sandbox with globalThis
const sandbox = { globalThis: {} };
vm.runInNewContext(libCode, sandbox);

const lib = sandbox.globalThis.__toneGuardLib;

export const detectPlatform = lib.detectPlatform;
export const parseApiResponse = lib.parseApiResponse;
export const extractToolResult = lib.extractToolResult;
export const cleanSiteInput = lib.cleanSiteInput;
export const validateApiKey = lib.validateApiKey;
export const getStrictnessLabel = lib.getStrictnessLabel;
export const getReadabilityClass = lib.getReadabilityClass;
export const getConfidenceClass = lib.getConfidenceClass;
export const shouldAnalyze = lib.shouldAnalyze;
export const precheckAnalysis = lib.precheckAnalysis;
export const makeAnalysisError = lib.makeAnalysisError;
export const shouldEscalateMaxTokens = lib.shouldEscalateMaxTokens;
export const ANALYSIS_MAX_TOKENS = lib.ANALYSIS_MAX_TOKENS;
export const ANALYSIS_MAX_TOKENS_CEILING = lib.ANALYSIS_MAX_TOKENS_CEILING;
export const getSiteProfile = lib.getSiteProfile;
export const sanitizeTelemetryEvent = lib.sanitizeTelemetryEvent;
export const buildTelemetryClipboardPayload = lib.buildTelemetryClipboardPayload;
export const truncate = lib.truncate;
export const extractMentions = lib.extractMentions;
export const verifyInsertedText = lib.verifyInsertedText;
