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
export const buildStaleFallback = lib.buildStaleFallback;
export const hasUsableSuggestion = lib.hasUsableSuggestion;
export const isConnectionLostError = lib.isConnectionLostError;
export const parseApiResponse = lib.parseApiResponse;
export const extractToolResult = lib.extractToolResult;
export const validateToolInput = lib.validateToolInput;
export const cleanSiteInput = lib.cleanSiteInput;
export const validateApiKey = lib.validateApiKey;
export const getStrictnessLabel = lib.getStrictnessLabel;
export const getReadabilityClass = lib.getReadabilityClass;
export const getConfidenceClass = lib.getConfidenceClass;
export const shouldAnalyze = lib.shouldAnalyze;
export const precheckAnalysis = lib.precheckAnalysis;
export const makeAnalysisError = lib.makeAnalysisError;
export const shouldEscalateMaxTokens = lib.shouldEscalateMaxTokens;
export const shouldRetryDiscardedResult = lib.shouldRetryDiscardedResult;
export const shouldRetryEmptySuggestion = lib.shouldRetryEmptySuggestion;
export const buildSystemPayload = lib.buildSystemPayload;
export const PROMPT_CACHE_MIN_CHARS = lib.PROMPT_CACHE_MIN_CHARS;
export const clampLearnedField = lib.clampLearnedField;
export const clampCustomRules = lib.clampCustomRules;
export const LEARNED_FIELD_MAX_CHARS = lib.LEARNED_FIELD_MAX_CHARS;
export const CUSTOM_RULES_MAX_CHARS = lib.CUSTOM_RULES_MAX_CHARS;
export const ANALYSIS_MAX_TOKENS = lib.ANALYSIS_MAX_TOKENS;
export const ANALYSIS_MAX_TOKENS_CEILING = lib.ANALYSIS_MAX_TOKENS_CEILING;
export const getSiteProfile = lib.getSiteProfile;
export const sanitizeTelemetryEvent = lib.sanitizeTelemetryEvent;
export const buildTelemetryClipboardPayload = lib.buildTelemetryClipboardPayload;
export const truncate = lib.truncate;
export const extractMentions = lib.extractMentions;
export const verifyInsertedText = lib.verifyInsertedText;
export const tokenizeForPattern = lib.tokenizeForPattern;
export const commonPrefixSuffixLengths = lib.commonPrefixSuffixLengths;
export const extractEditSpan = lib.extractEditSpan;
export const categorizePattern = lib.categorizePattern;
export const extractPatterns = lib.extractPatterns;
export const renderMemoryMd = lib.renderMemoryMd;
export const buildMemoryGraph = lib.buildMemoryGraph;
export const renderMemoryGraph = lib.renderMemoryGraph;
export const buildPatternBlock = lib.buildPatternBlock;
export const PATTERN_INJECT_MAX_CHARS = lib.PATTERN_INJECT_MAX_CHARS;
export const PATTERN_INJECT_MAX_COUNT = lib.PATTERN_INJECT_MAX_COUNT;
export const PATTERN_CATEGORIES = lib.PATTERN_CATEGORIES;
