package com.toneguard

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class DiagnosticStore(context: Context) {
    private val prefs = context.getSharedPreferences("toneguard_diagnostics", Context.MODE_PRIVATE)

    fun add(event: JSONObject) {
        val items = getRecent().toMutableList()
        items.add(0, event.put("timestamp", java.time.Instant.now().toString()))
        while (items.size > MAX_ITEMS) items.removeAt(items.lastIndex)

        val arr = JSONArray()
        for (item in items) arr.put(item)
        prefs.edit().putString(KEY_EVENTS, arr.toString()).apply()
    }

    fun getRecent(): List<JSONObject> {
        val raw = prefs.getString(KEY_EVENTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun clear() {
        prefs.edit().remove(KEY_EVENTS).apply()
    }

    companion object {
        private const val KEY_EVENTS = "events"
        private const val MAX_ITEMS = 20
    }
}
