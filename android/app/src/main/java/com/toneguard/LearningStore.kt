package com.toneguard

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Local-first storage for ToneGuard learning data.
 * Uses regular SharedPreferences (not encrypted) since learning data isn't sensitive.
 * Storage keys match the Chrome extension's chrome.storage.local keys.
 */
class LearningStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("toneguard_learning", Context.MODE_PRIVATE)

    companion object {
        const val KEY_DECISIONS = "tg_decisions"
        const val KEY_VOICE_SAMPLES = "tg_voice_samples"
        const val KEY_RELATIONSHIPS = "tg_relationships"
        const val KEY_CUSTOM_RULES = "tg_custom_rules"
        const val KEY_STATS = "tg_stats"
        const val KEY_STATS_HISTORY = "tg_stats_history"

        private const val MAX_DECISIONS = 100
        private const val MAX_VOICE_SAMPLES = 30
        private const val MAX_VOICE_SAMPLE_LENGTH = 300
    }

    // --- Decisions ---

    fun getDecisions(): List<JSONObject> = getJsonArray(KEY_DECISIONS)

    fun logDecision(action: String, original: String, suggestion: String?, finalText: String?) {
        val decisions = getDecisions().toMutableList()
        decisions.add(0, JSONObject().apply {
            put("action", action)
            put("original", original)
            if (suggestion != null) put("suggestion", suggestion)
            if (finalText != null) put("finalText", finalText)
            put("timestamp", now())
        })
        if (decisions.size > MAX_DECISIONS) {
            while (decisions.size > MAX_DECISIONS) decisions.removeAt(decisions.lastIndex)
        }
        putJsonArray(KEY_DECISIONS, decisions)
    }

    // --- Voice Samples ---

    fun getVoiceSamples(): List<JSONObject> = getJsonArray(KEY_VOICE_SAMPLES)

    fun saveVoiceSample(text: String) {
        if (text.length < 30) return
        val samples = getVoiceSamples().toMutableList()
        samples.add(JSONObject().apply {
            put("text", text.take(MAX_VOICE_SAMPLE_LENGTH))
            put("timestamp", now())
        })
        if (samples.size > MAX_VOICE_SAMPLES) {
            while (samples.size > MAX_VOICE_SAMPLES) samples.removeAt(0)
        }
        putJsonArray(KEY_VOICE_SAMPLES, samples)
    }

    // --- Relationships ---

    fun getRelationships(): JSONObject {
        val raw = prefs.getString(KEY_RELATIONSHIPS, null) ?: return JSONObject()
        return try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
    }

    fun saveRecipientInteraction(text: String) {
        val mentions = extractMentions(text)
        if (mentions.isEmpty()) return

        val relationships = getRelationships()
        for (name in mentions) {
            val entry = relationships.optJSONObject(name) ?: JSONObject().apply {
                put("messageCount", 0)
                put("lastSeen", JSONObject.NULL)
            }
            entry.put("messageCount", entry.optInt("messageCount", 0) + 1)
            entry.put("lastSeen", now())
            relationships.put(name, entry)
        }
        prefs.edit().putString(KEY_RELATIONSHIPS, relationships.toString()).apply()
    }

    // --- Custom Rules ---

    fun getCustomRules(): String = prefs.getString(KEY_CUSTOM_RULES, "") ?: ""

    fun setCustomRules(rules: String) {
        prefs.edit().putString(KEY_CUSTOM_RULES, rules).apply()
    }

    // --- Stats ---

    fun getStats(): JSONObject {
        val raw = prefs.getString(KEY_STATS, null) ?: return JSONObject()
        return try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
    }

    fun getStatsHistory(): List<JSONObject> = getJsonArray(KEY_STATS_HISTORY)

    fun trackStats(flagged: Boolean, mode: String?) {
        val stats = getStats()
        val weekStart = stats.optString("weekStart", "")
        val now = now()

        // Roll over if more than 7 days
        if (weekStart.isNotEmpty()) {
            try {
                val start = java.time.Instant.parse(weekStart)
                val current = java.time.Instant.parse(now)
                val days = java.time.Duration.between(start, current).toDays()
                if (days >= 7) {
                    archiveWeek(stats)
                    prefs.edit().putString(KEY_STATS, JSONObject().apply {
                        put("weekStart", now)
                        put("checked", 0)
                        put("flagged", 0)
                        put("accepted", 0)
                        put("dismissed", 0)
                        put("edited", 0)
                        put("byMode", JSONObject())
                    }.toString()).apply()
                    return trackStats(flagged, mode)
                }
            } catch (_: Exception) { /* continue with current stats */ }
        }

        if (weekStart.isEmpty()) stats.put("weekStart", now)
        stats.put("checked", stats.optInt("checked", 0) + 1)
        if (flagged) stats.put("flagged", stats.optInt("flagged", 0) + 1)
        if (mode != null) {
            val byMode = stats.optJSONObject("byMode") ?: JSONObject()
            byMode.put(mode, byMode.optInt(mode, 0) + 1)
            stats.put("byMode", byMode)
        }

        prefs.edit().putString(KEY_STATS, stats.toString()).apply()
    }

    fun trackDecisionStats(action: String) {
        val stats = getStats()
        when (action) {
            "used_suggestion" -> stats.put("accepted", stats.optInt("accepted", 0) + 1)
            "sent_original" -> stats.put("dismissed", stats.optInt("dismissed", 0) + 1)
            "used_edited" -> stats.put("edited", stats.optInt("edited", 0) + 1)
        }
        prefs.edit().putString(KEY_STATS, stats.toString()).apply()
    }

    private fun archiveWeek(weekStats: JSONObject) {
        val history = getStatsHistory().toMutableList()
        history.add(weekStats)
        // Sort by weekStart ascending, keep last 12
        history.sortBy { it.optString("weekStart", "") }
        while (history.size > 12) history.removeAt(0)
        putJsonArray(KEY_STATS_HISTORY, history)
    }

    // --- Learning context for prompts ---

    fun getLearnedExamples(): String {
        val decisions = getDecisions()
        if (decisions.isEmpty()) return ""

        val examples = mutableListOf<String>()

        val falsePositives = decisions.filter { it.optString("action") == "sent_original" }.take(3)
        for (d in falsePositives) {
            examples.add("FALSE POSITIVE (do NOT flag similar messages):\n  Message: \"${d.optString("original")}\"")
        }

        val edited = decisions.filter { it.optString("action") == "used_edited" }.take(3)
        for (d in edited) {
            examples.add(
                "GOOD CATCH, BETTER REWRITE (learn from user version):\n" +
                "  Original: \"${d.optString("original")}\"\n" +
                "  Your suggestion: \"${d.optString("suggestion")}\"\n" +
                "  User preferred: \"${d.optString("finalText")}\""
            )
        }

        val accepted = decisions.filter { it.optString("action") == "used_suggestion" }.take(3)
        for (d in accepted) {
            examples.add(
                "GOOD EXAMPLE (user accepted):\n" +
                "  Original: \"${d.optString("original")}\"\n" +
                "  Rewrite: \"${d.optString("suggestion")}\""
            )
        }

        return examples.joinToString("\n\n")
    }

    fun getVoiceContext(): String {
        val samples = getVoiceSamples()
        if (samples.size < 5) return ""
        val picked = samples.takeLast(5)
        val lines = picked.joinToString("\n") { "  \"${it.optString("text")}\"" }
        return "VOICE SAMPLES (match this writing style in rewrites):\n$lines"
    }

    fun getRelationshipContext(text: String): String {
        val relationships = getRelationships()
        if (relationships.length() == 0) return ""

        val mentions = extractMentions(text)
        if (mentions.isEmpty()) return ""

        val lines = mutableListOf<String>()
        for (name in mentions) {
            val rel = relationships.optJSONObject(name) ?: continue
            val count = rel.optInt("messageCount", 0)
            if (count > 3) {
                lines.add("@$name: frequent contact ($count messages). Use a familiar, comfortable tone.")
            } else if (count > 0) {
                lines.add("@$name: infrequent contact ($count messages). Keep it professional and clear.")
            }
        }

        return if (lines.isNotEmpty()) {
            "RECIPIENT CONTEXT (based on message history):\n${lines.joinToString("\n")}"
        } else ""
    }

    // --- Raw accessors for sync ---

    fun getRawJson(key: String): Any? {
        val raw = prefs.getString(key, null) ?: return null
        return try {
            if (raw.startsWith("[")) JSONArray(raw) else JSONObject(raw)
        } catch (_: Exception) { raw }
    }

    fun setRawJson(key: String, value: Any?) {
        if (value == null) {
            prefs.edit().remove(key).apply()
        } else {
            prefs.edit().putString(key, value.toString()).apply()
        }
    }

    // --- Helpers ---

    private fun getJsonArray(key: String): List<JSONObject> {
        val raw = prefs.getString(key, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) { emptyList() }
    }

    private fun putJsonArray(key: String, items: List<JSONObject>) {
        val arr = JSONArray()
        for (item in items) arr.put(item)
        prefs.edit().putString(key, arr.toString()).apply()
    }

    private fun now(): String = java.time.Instant.now().toString()

    private fun extractMentions(text: String): List<String> {
        val pattern = Regex("@([\\w.-]+)")
        return pattern.findAll(text).map { it.groupValues[1] }.toList()
    }
}
