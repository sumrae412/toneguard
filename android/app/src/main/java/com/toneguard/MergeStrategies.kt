package com.toneguard

import org.json.JSONArray
import org.json.JSONObject

/**
 * Merge strategies for cross-platform sync.
 * Must produce identical results to src/sync/merge.js.
 */
object MergeStrategies {

    /**
     * Merge decision arrays: union by (timestamp + action), sort newest-first, trim to 100.
     */
    fun mergeDecisions(local: JSONArray?, remote: JSONArray?): JSONArray {
        val all = mutableListOf<JSONObject>()
        local?.let { for (i in 0 until it.length()) all.add(it.getJSONObject(i)) }
        remote?.let { for (i in 0 until it.length()) all.add(it.getJSONObject(i)) }

        val seen = mutableSetOf<String>()
        val deduped = mutableListOf<JSONObject>()

        for (d in all) {
            val key = (d.optString("timestamp", "") + "|" + d.optString("action", ""))
            if (key in seen) continue
            seen.add(key)
            deduped.add(d)
        }

        deduped.sortByDescending { it.optString("timestamp", "") }

        val result = JSONArray()
        for (d in deduped.take(100)) result.put(d)
        return result
    }

    /**
     * Merge voice sample arrays: deduplicate by text content, sort newest-first, trim to 30.
     */
    fun mergeVoiceSamples(local: JSONArray?, remote: JSONArray?): JSONArray {
        val all = mutableListOf<JSONObject>()
        local?.let { for (i in 0 until it.length()) all.add(it.getJSONObject(i)) }
        remote?.let { for (i in 0 until it.length()) all.add(it.getJSONObject(i)) }

        val seen = mutableSetOf<String>()
        val deduped = mutableListOf<JSONObject>()

        for (s in all) {
            val key = s.optString("text", "")
            if (key in seen) continue
            seen.add(key)
            deduped.add(s)
        }

        deduped.sortByDescending { it.optString("timestamp", "") }

        val result = JSONArray()
        for (s in deduped.take(30)) result.put(s)
        return result
    }

    /**
     * Merge relationship maps: per-key, take max messageCount and latest lastSeen.
     */
    fun mergeRelationships(local: JSONObject?, remote: JSONObject?): JSONObject {
        val localMap = local ?: JSONObject()
        val remoteMap = remote ?: JSONObject()
        val merged = JSONObject()

        val allKeys = mutableSetOf<String>()
        localMap.keys().forEach { allKeys.add(it) }
        remoteMap.keys().forEach { allKeys.add(it) }

        for (key in allKeys) {
            val l = localMap.optJSONObject(key)
            val r = remoteMap.optJSONObject(key)

            val lCount = l?.optInt("messageCount", 0) ?: 0
            val rCount = r?.optInt("messageCount", 0) ?: 0
            val lSeen = l?.optString("lastSeen", "") ?: ""
            val rSeen = r?.optString("lastSeen", "") ?: ""

            merged.put(key, JSONObject().apply {
                put("messageCount", maxOf(lCount, rCount))
                put("lastSeen", if (lSeen > rSeen) lSeen else rSeen)
            })
        }

        return merged
    }

    data class CustomRulesResult(val rules: String, val source: String, val updatedAt: String)

    /**
     * Merge custom rules: last-write-wins based on updatedAt timestamp.
     */
    fun mergeCustomRules(local: JSONObject?, remote: JSONObject?): CustomRulesResult {
        val localVal = local ?: JSONObject()
        val remoteVal = remote ?: JSONObject()

        val localUpdated = localVal.optString("updatedAt", "")
        val remoteUpdated = remoteVal.optString("updatedAt", "")

        return if (remoteUpdated > localUpdated) {
            CustomRulesResult(
                rules = remoteVal.optString("rules", ""),
                source = "remote",
                updatedAt = remoteUpdated
            )
        } else {
            CustomRulesResult(
                rules = localVal.optString("rules", ""),
                source = "local",
                updatedAt = localUpdated
            )
        }
    }

    /**
     * Merge stats history: union by weekStart, take higher counts per week, trim to 12.
     */
    fun mergeStatsHistory(local: JSONArray?, remote: JSONArray?): JSONArray {
        val byWeek = linkedMapOf<String, JSONObject>()

        fun addAll(arr: JSONArray?) {
            arr ?: return
            for (i in 0 until arr.length()) {
                val week = arr.getJSONObject(i)
                val key = week.optString("weekStart", "")
                val existing = byWeek[key]

                if (existing == null) {
                    byWeek[key] = JSONObject(week.toString()) // deep copy
                } else {
                    byWeek[key] = JSONObject().apply {
                        put("weekStart", key)
                        put("checked", maxOf(existing.optInt("checked", 0), week.optInt("checked", 0)))
                        put("flagged", maxOf(existing.optInt("flagged", 0), week.optInt("flagged", 0)))
                        put("accepted", maxOf(existing.optInt("accepted", 0), week.optInt("accepted", 0)))
                        put("edited", maxOf(existing.optInt("edited", 0), week.optInt("edited", 0)))
                        put("dismissed", maxOf(existing.optInt("dismissed", 0), week.optInt("dismissed", 0)))
                        put("byMode", mergeByMode(existing.optJSONObject("byMode"), week.optJSONObject("byMode")))
                    }
                }
            }
        }

        addAll(local)
        addAll(remote)

        val sorted = byWeek.entries.sortedBy { it.key }
        val trimmed = sorted.takeLast(12)

        val result = JSONArray()
        for ((_, v) in trimmed) result.put(v)
        return result
    }

    private fun mergeByMode(a: JSONObject?, b: JSONObject?): JSONObject {
        val modeA = a ?: JSONObject()
        val modeB = b ?: JSONObject()
        val merged = JSONObject(modeA.toString())

        modeB.keys().forEach { key ->
            merged.put(key, maxOf(merged.optInt(key, 0), modeB.optInt(key, 0)))
        }

        return merged
    }
}
