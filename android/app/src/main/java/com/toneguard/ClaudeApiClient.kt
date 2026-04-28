package com.toneguard

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

data class AnalysisResult(
    val flagged: Boolean,
    val confidence: Double = 0.0,
    val mode: String = "tone",
    val readability: Int = 0,
    val redFlags: List<String> = emptyList(),
    val categories: List<String> = emptyList(),
    val reasoning: String = "",
    val suggestion: String = "",
    val error: String? = null,
    val errorType: String? = null,
    val diagnosticCode: String? = null,
    val retryable: Boolean = false,
    val routingRoute: String = "standard",
    val routingHits: List<String> = emptyList(),
    val routingModel: String = "claude-haiku-4-5-20251001"
)

class ClaudeApiClient(private val apiKey: String, private val learningStore: LearningStore? = null) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    fun analyze(
        text: String,
        strictness: Int,
        intentMode: String = "professional",
        voiceStrength: String = "balanced",
        callback: (AnalysisResult) -> Unit
    ) {
        val normalizedIntentMode = normalizeIntentMode(intentMode)
        val normalizedVoiceStrength = normalizeVoiceStrength(voiceStrength)
        val precheck = precheckAnalysis(text, normalizedIntentMode)
        if (!precheck.shouldCallModel) {
            callback(AnalysisResult(
                flagged = false,
                mode = "",
                routingRoute = precheck.route,
                routingHits = precheck.hits,
                routingModel = "local"
            ))
            return
        }

        val systemPrompt = buildSystemPrompt(strictness, text, normalizedIntentMode, normalizedVoiceStrength)
        val body = JSONObject().apply {
            put("model", "claude-haiku-4-5-20251001")
            put("max_tokens", 1024)
            put("system", systemPrompt)
            put("messages", JSONArray().apply {
                put(JSONObject().apply {
                    put("role", "user")
                    put("content", "Review this message before sending:\n\n$text")
                })
            })
        }

        val request = Request.Builder()
            .url("https://api.anthropic.com/v1/messages")
            .addHeader("Content-Type", "application/json")
            .addHeader("x-api-key", apiKey)
            .addHeader("anthropic-version", "2023-06-01")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        var lastError: String? = null

        for (attempt in 0..2) {
            try {
                val response = client.newCall(request).execute()

                if (response.code == 401 || response.code == 400 || response.code == 403) {
                    callback(analysisError("api", getFriendlyError(response.code), response.code))
                    return
                }

                if (response.isSuccessful) {
                    val responseBody = response.body?.string() ?: ""
                    val result = parseResponse(responseBody)
                    callback(result.copy(
                        routingRoute = precheck.route,
                        routingHits = precheck.hits
                    ))
                    return
                }

                if (response.code < 500) {
                    callback(analysisError("api", getFriendlyError(response.code), response.code))
                    return
                }

                lastError = getFriendlyError(response.code)
                Thread.sleep((Math.pow(2.0, attempt.toDouble()) * 500).toLong())
            } catch (e: IOException) {
                lastError = "Network error. Check your internet connection."
                if (attempt < 2) {
                    Thread.sleep((Math.pow(2.0, attempt.toDouble()) * 500).toLong())
                }
            }
        }

        callback(analysisError("network", lastError ?: "Network error. Check your internet connection."))
    }

    private fun analysisError(kind: String, message: String, status: Int? = null): AnalysisResult {
        val type = when (kind) {
            "parse" -> "parse_error"
            "network" -> "network_error"
            "api" -> "api_error"
            else -> "runtime_error"
        }
        val code = when (kind) {
            "parse" -> "TG_PARSE_001"
            "network" -> "TG_NET_001"
            "api" -> if (status != null) "TG_API_$status" else "TG_API_001"
            else -> "TG_RUNTIME_001"
        }
        return AnalysisResult(
            flagged = false,
            error = message,
            errorType = type,
            diagnosticCode = code,
            retryable = kind != "api" || status !in listOf(400, 401, 403)
        )
    }

    private data class PrecheckResult(
        val route: String,
        val hits: List<String>,
        val shouldCallModel: Boolean
    )

    private fun normalizeIntentMode(mode: String): String {
        return when (mode) {
            "professional", "warm", "direct", "deescalating", "boundary", "concise" -> mode
            else -> "professional"
        }
    }

    private fun normalizeVoiceStrength(strength: String): String {
        return when (strength) {
            "light", "balanced", "strong" -> strength
            else -> "balanced"
        }
    }

    private fun precheckAnalysis(text: String, intentMode: String = ""): PrecheckResult {
        val normalized = text.lowercase()
            .replace(Regex("[^\\w\\s']"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (normalized.isEmpty()) {
            return PrecheckResult("local_pass", listOf("empty"), false)
        }

        val escalationPhrases = listOf(
            "what the heck",
            "what the hell",
            "are you serious",
            "i can't believe",
            "per my last email",
            "as i already said",
            "why this is so hard"
        )
        val hits = escalationPhrases
            .filter { normalized.contains(it) }
            .map { "phrase:$it" }
            .toMutableList()
        if (intentMode == "deescalating" || intentMode == "boundary") {
            hits.add("intent:$intentMode")
        }
        if (hits.isNotEmpty()) {
            return PrecheckResult("deep", hits, true)
        }

        val localPassPhrases = setOf(
            "sounds good",
            "thanks",
            "thank you",
            "got it",
            "ok",
            "okay",
            "will do"
        )
        val words = normalized.split(" ").filter { it.isNotEmpty() }
        if (words.size <= 4 && localPassPhrases.contains(normalized)) {
            return PrecheckResult("local_pass", listOf("phrase:$normalized"), false)
        }

        return PrecheckResult("standard", emptyList(), true)
    }

    private fun parseResponse(body: String): AnalysisResult {
        try {
            val json = JSONObject(body)
            val content = json.getJSONArray("content")
            val text = content.getJSONObject(0).getString("text")

            val jsonRegex = Regex("\\{[\\s\\S]*\\}")
            val match = jsonRegex.find(text)
                ?: return analysisError("parse", "Failed to parse response")
            val result = JSONObject(match.value)

            val flagged = result.optBoolean("flagged", false)
            if (!flagged) return AnalysisResult(flagged = false)

            val redFlags = mutableListOf<String>()
            val flagsArray = result.optJSONArray("red_flags")
            if (flagsArray != null) {
                for (i in 0 until flagsArray.length()) {
                    redFlags.add(flagsArray.getString(i))
                }
            }

            val categories = mutableListOf<String>()
            val catsArray = result.optJSONArray("categories")
            if (catsArray != null) {
                for (i in 0 until catsArray.length()) {
                    categories.add(catsArray.getString(i))
                }
            }

            return AnalysisResult(
                flagged = true,
                confidence = result.optDouble("confidence", 0.0),
                mode = result.optString("mode", "tone"),
                readability = result.optInt("readability", 0),
                redFlags = redFlags,
                categories = categories,
                reasoning = result.optString("reasoning", ""),
                suggestion = result.optString("suggestion", "")
            )
        } catch (e: Exception) {
            return analysisError("parse", "Failed to parse response")
        }
    }

    private fun getFriendlyError(status: Int): String {
        return when (status) {
            401 -> "Invalid API key. Check your key in ToneGuard settings."
            403 -> "API key doesn\u2019t have permission. Check console.anthropic.com."
            429 -> "Rate limit reached. Wait a moment and try again."
            400 -> "Bad request. The message may be too long."
            500, 502, 503 -> "Anthropic\u2019s API is temporarily unavailable."
            else -> "API error ($status)."
        }
    }

    private fun buildSystemPrompt(
        strictness: Int,
        messageText: String = "",
        intentMode: String = "professional",
        voiceStrength: String = "balanced"
    ): String {
        val base = """You are ToneGuard, a writing assistant that checks messages for tone and clarity issues before sending.

Your job has three parts:
1. TONE: Catch messages that sound harsh, accusatory, passive-aggressive, defensive, guilt-trippy, or negative.
2. CLARITY: Catch messages that are vague, ambiguous, or could be misread. Flag missing context, unclear references, hedging that buries the point, and rambling phrasing.
3. PROFESSIONALISM: Catch messages that are sloppy, incoherent, or would make the sender look unprofessional.

IMPORTANT: When in doubt, FLAG IT. The user can always dismiss your suggestion.

INTENT MODE: $intentMode. Intent mode affects rewrite style only. It must not suppress real tone, clarity, or professionalism warnings.
VOICE STRENGTH: $voiceStrength. Use "light" for minimal voice matching, "balanced" for natural matching, and "strong" for closer matching when learned voice examples exist.

When you DO rewrite:
- One idea per sentence
- Put what happened first, then why
- Short sentences over long ones
- No em dashes (use periods or commas)
- Assume good intent. Frame things as miscommunication, not mistakes
- Make clear requests. Say what you want going forward
- Be direct and compassionate at the same time

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "flagged": boolean,
  "confidence": number 0-1,
  "mode": "tone" | "polish" | "both",
  "readability": number (grade level),
  "red_flags": ["quoted phrases from the message that are problematic"],
  "categories": ["short labels for issue types found"],
  "reasoning": "1-2 sentence explanation of what's wrong",
  "suggestion": "the rewritten message"
}

If the message is fine, return: {"flagged": false}"""

        val strictnessAddendum = when (strictness) {
            1 -> "\n\nSTRICTNESS: GENTLE. Only flag messages that are clearly problematic. Let borderline messages through."
            3 -> "\n\nSTRICTNESS: STRICT. Flag anything that could be improved. Be thorough."
            else -> ""
        }

        var prompt = base + strictnessAddendum

        // Add learning context if available
        if (learningStore != null) {
            val learnedExamples = learningStore.getLearnedExamples()
            if (learnedExamples.isNotEmpty()) {
                prompt += "\n\nLEARNED FROM PAST DECISIONS (use these to calibrate):\n$learnedExamples"
            }

            val voiceContext = learningStore.getVoiceContext()
            if (voiceContext.isNotEmpty()) {
                prompt += "\n\n$voiceContext"
            }

            val relationshipContext = learningStore.getRelationshipContext(messageText)
            if (relationshipContext.isNotEmpty()) {
                prompt += "\n\n$relationshipContext"
            }
        }

        return prompt
    }
}
