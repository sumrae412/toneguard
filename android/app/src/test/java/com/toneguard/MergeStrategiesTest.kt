package com.toneguard

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for MergeStrategies.
 * These must produce results identical to the JS merge tests in tests/merge.test.js.
 */
class MergeStrategiesTest {

    // --- mergeDecisions ---

    @Test
    fun `mergeDecisions - merges two disjoint arrays`() {
        val local = JSONArray().put(JSONObject().apply {
            put("timestamp", "2026-04-01T10:00:00Z"); put("action", "sent_original"); put("original", "a")
        })
        val remote = JSONArray().put(JSONObject().apply {
            put("timestamp", "2026-04-02T10:00:00Z"); put("action", "used_suggestion"); put("original", "b")
        })
        val result = MergeStrategies.mergeDecisions(local, remote)
        assertEquals(2, result.length())
        assertEquals("b", result.getJSONObject(0).getString("original")) // newest first
    }

    @Test
    fun `mergeDecisions - deduplicates by timestamp+action`() {
        val d = JSONObject().apply {
            put("timestamp", "2026-04-01T10:00:00Z"); put("action", "sent_original"); put("original", "same")
        }
        val result = MergeStrategies.mergeDecisions(
            JSONArray().put(d),
            JSONArray().put(JSONObject(d.toString()))
        )
        assertEquals(1, result.length())
    }

    @Test
    fun `mergeDecisions - trims to 100`() {
        val local = JSONArray()
        for (i in 0 until 80) {
            local.put(JSONObject().apply {
                put("timestamp", "2026-01-01T${i.toString().padStart(2, '0')}:00:00Z")
                put("action", "sent_original"); put("original", "local-$i")
            })
        }
        val remote = JSONArray()
        for (i in 0 until 80) {
            remote.put(JSONObject().apply {
                put("timestamp", "2026-02-01T${i.toString().padStart(2, '0')}:00:00Z")
                put("action", "sent_original"); put("original", "remote-$i")
            })
        }
        val result = MergeStrategies.mergeDecisions(local, remote)
        assertEquals(100, result.length())
    }

    @Test
    fun `mergeDecisions - handles empty arrays`() {
        assertEquals(0, MergeStrategies.mergeDecisions(JSONArray(), JSONArray()).length())
        assertEquals(0, MergeStrategies.mergeDecisions(null, JSONArray()).length())
        assertEquals(0, MergeStrategies.mergeDecisions(JSONArray(), null).length())
        assertEquals(0, MergeStrategies.mergeDecisions(null, null).length())
    }

    @Test
    fun `mergeDecisions - handles one side empty`() {
        val data = JSONArray().put(JSONObject().apply {
            put("timestamp", "2026-04-01T10:00:00Z"); put("action", "sent_original"); put("original", "a")
        })
        assertEquals(1, MergeStrategies.mergeDecisions(data, JSONArray()).length())
        assertEquals(1, MergeStrategies.mergeDecisions(JSONArray(), data).length())
    }

    @Test
    fun `mergeDecisions - sorts newest first`() {
        val old = JSONArray().put(JSONObject().apply {
            put("timestamp", "2026-01-01T00:00:00Z"); put("action", "sent_original"); put("original", "old")
        })
        val recent = JSONArray().put(JSONObject().apply {
            put("timestamp", "2026-04-01T00:00:00Z"); put("action", "sent_original"); put("original", "new")
        })
        val result = MergeStrategies.mergeDecisions(old, recent)
        assertEquals("new", result.getJSONObject(0).getString("original"))
        assertEquals("old", result.getJSONObject(1).getString("original"))
    }

    // --- mergeVoiceSamples ---

    @Test
    fun `mergeVoiceSamples - merges disjoint samples`() {
        val local = JSONArray().put(JSONObject().apply {
            put("text", "hello world"); put("timestamp", "2026-04-01T10:00:00Z")
        })
        val remote = JSONArray().put(JSONObject().apply {
            put("text", "goodbye world"); put("timestamp", "2026-04-02T10:00:00Z")
        })
        val result = MergeStrategies.mergeVoiceSamples(local, remote)
        assertEquals(2, result.length())
    }

    @Test
    fun `mergeVoiceSamples - deduplicates by text content`() {
        val s1 = JSONObject().apply { put("text", "same message"); put("timestamp", "2026-04-01T10:00:00Z") }
        val s2 = JSONObject().apply { put("text", "same message"); put("timestamp", "2026-04-02T10:00:00Z") }
        val result = MergeStrategies.mergeVoiceSamples(JSONArray().put(s1), JSONArray().put(s2))
        assertEquals(1, result.length())
    }

    @Test
    fun `mergeVoiceSamples - trims to 30`() {
        val local = JSONArray()
        for (i in 0 until 20) {
            local.put(JSONObject().apply {
                put("text", "local-$i"); put("timestamp", "2026-01-01T${i.toString().padStart(2, '0')}:00:00Z")
            })
        }
        val remote = JSONArray()
        for (i in 0 until 20) {
            remote.put(JSONObject().apply {
                put("text", "remote-$i"); put("timestamp", "2026-02-01T${i.toString().padStart(2, '0')}:00:00Z")
            })
        }
        val result = MergeStrategies.mergeVoiceSamples(local, remote)
        assertEquals(30, result.length())
    }

    @Test
    fun `mergeVoiceSamples - handles empty or null`() {
        assertEquals(0, MergeStrategies.mergeVoiceSamples(null, null).length())
        assertEquals(0, MergeStrategies.mergeVoiceSamples(JSONArray(), JSONArray()).length())
    }

    // --- mergeRelationships ---

    @Test
    fun `mergeRelationships - merges disjoint contacts`() {
        val local = JSONObject().apply {
            put("alice", JSONObject().apply { put("messageCount", 5); put("lastSeen", "2026-04-01T10:00:00Z") })
        }
        val remote = JSONObject().apply {
            put("bob", JSONObject().apply { put("messageCount", 3); put("lastSeen", "2026-04-02T10:00:00Z") })
        }
        val result = MergeStrategies.mergeRelationships(local, remote)
        assertTrue(result.has("alice"))
        assertTrue(result.has("bob"))
    }

    @Test
    fun `mergeRelationships - takes max messageCount`() {
        val local = JSONObject().apply {
            put("alice", JSONObject().apply { put("messageCount", 5); put("lastSeen", "2026-04-01T10:00:00Z") })
        }
        val remote = JSONObject().apply {
            put("alice", JSONObject().apply { put("messageCount", 8); put("lastSeen", "2026-03-01T10:00:00Z") })
        }
        val result = MergeStrategies.mergeRelationships(local, remote)
        assertEquals(8, result.getJSONObject("alice").getInt("messageCount"))
    }

    @Test
    fun `mergeRelationships - takes latest lastSeen`() {
        val local = JSONObject().apply {
            put("alice", JSONObject().apply { put("messageCount", 5); put("lastSeen", "2026-04-01T10:00:00Z") })
        }
        val remote = JSONObject().apply {
            put("alice", JSONObject().apply { put("messageCount", 3); put("lastSeen", "2026-04-05T10:00:00Z") })
        }
        val result = MergeStrategies.mergeRelationships(local, remote)
        assertEquals("2026-04-05T10:00:00Z", result.getJSONObject("alice").getString("lastSeen"))
    }

    @Test
    fun `mergeRelationships - handles empty or null`() {
        assertEquals(0, MergeStrategies.mergeRelationships(null, null).length())
        assertEquals(0, MergeStrategies.mergeRelationships(JSONObject(), JSONObject()).length())
    }

    @Test
    fun `mergeRelationships - handles one side missing a contact`() {
        val local = JSONObject().apply {
            put("alice", JSONObject().apply { put("messageCount", 5); put("lastSeen", "2026-04-01T10:00:00Z") })
        }
        val result = MergeStrategies.mergeRelationships(local, JSONObject())
        assertEquals(5, result.getJSONObject("alice").getInt("messageCount"))
    }

    // --- mergeCustomRules ---

    @Test
    fun `mergeCustomRules - takes remote when remote is newer`() {
        val local = JSONObject().apply { put("rules", "old rules"); put("updatedAt", "2026-04-01T10:00:00Z") }
        val remote = JSONObject().apply { put("rules", "new rules"); put("updatedAt", "2026-04-02T10:00:00Z") }
        val result = MergeStrategies.mergeCustomRules(local, remote)
        assertEquals("new rules", result.rules)
        assertEquals("remote", result.source)
    }

    @Test
    fun `mergeCustomRules - keeps local when local is newer`() {
        val local = JSONObject().apply { put("rules", "local rules"); put("updatedAt", "2026-04-03T10:00:00Z") }
        val remote = JSONObject().apply { put("rules", "remote rules"); put("updatedAt", "2026-04-02T10:00:00Z") }
        val result = MergeStrategies.mergeCustomRules(local, remote)
        assertEquals("local rules", result.rules)
        assertEquals("local", result.source)
    }

    @Test
    fun `mergeCustomRules - handles empty or null`() {
        val result = MergeStrategies.mergeCustomRules(null, null)
        assertEquals("", result.rules)
        assertEquals("local", result.source)
    }

    @Test
    fun `mergeCustomRules - handles one side null`() {
        val local = JSONObject().apply { put("rules", "my rules"); put("updatedAt", "2026-04-01T10:00:00Z") }
        val result = MergeStrategies.mergeCustomRules(local, null)
        assertEquals("my rules", result.rules)
    }

    // --- mergeStatsHistory ---

    @Test
    fun `mergeStatsHistory - merges disjoint weeks`() {
        val local = JSONArray().put(JSONObject().apply {
            put("weekStart", "2026-03-24T00:00:00Z"); put("checked", 10); put("flagged", 3)
        })
        val remote = JSONArray().put(JSONObject().apply {
            put("weekStart", "2026-03-31T00:00:00Z"); put("checked", 5); put("flagged", 1)
        })
        val result = MergeStrategies.mergeStatsHistory(local, remote)
        assertEquals(2, result.length())
    }

    @Test
    fun `mergeStatsHistory - takes max counts for overlapping weeks`() {
        val local = JSONArray().put(JSONObject().apply {
            put("weekStart", "2026-03-24T00:00:00Z"); put("checked", 10); put("flagged", 3)
            put("accepted", 2); put("edited", 1); put("dismissed", 0)
        })
        val remote = JSONArray().put(JSONObject().apply {
            put("weekStart", "2026-03-24T00:00:00Z"); put("checked", 8); put("flagged", 5)
            put("accepted", 1); put("edited", 0); put("dismissed", 3)
        })
        val result = MergeStrategies.mergeStatsHistory(local, remote)
        assertEquals(1, result.length())
        val week = result.getJSONObject(0)
        assertEquals(10, week.getInt("checked"))
        assertEquals(5, week.getInt("flagged"))
        assertEquals(3, week.getInt("dismissed"))
    }

    @Test
    fun `mergeStatsHistory - trims to 12 weeks`() {
        val weeks = JSONArray()
        for (i in 0 until 15) {
            weeks.put(JSONObject().apply {
                val month = if (i < 9) (i + 1) else 9
                put("weekStart", "2026-0${month}-01T00:00:00Z")
                put("checked", i); put("flagged", 0); put("accepted", 0); put("edited", 0); put("dismissed", 0)
            })
        }
        val result = MergeStrategies.mergeStatsHistory(weeks, JSONArray())
        assertTrue(result.length() <= 12)
    }

    @Test
    fun `mergeStatsHistory - merges byMode taking max per key`() {
        val local = JSONArray().put(JSONObject().apply {
            put("weekStart", "2026-03-24T00:00:00Z"); put("checked", 10); put("flagged", 5)
            put("accepted", 0); put("edited", 0); put("dismissed", 0)
            put("byMode", JSONObject().apply { put("tone", 3); put("polish", 2) })
        })
        val remote = JSONArray().put(JSONObject().apply {
            put("weekStart", "2026-03-24T00:00:00Z"); put("checked", 8); put("flagged", 4)
            put("accepted", 0); put("edited", 0); put("dismissed", 0)
            put("byMode", JSONObject().apply { put("tone", 1); put("both", 3) })
        })
        val result = MergeStrategies.mergeStatsHistory(local, remote)
        val byMode = result.getJSONObject(0).getJSONObject("byMode")
        assertEquals(3, byMode.getInt("tone"))
        assertEquals(2, byMode.getInt("polish"))
        assertEquals(3, byMode.getInt("both"))
    }

    @Test
    fun `mergeStatsHistory - handles empty or null`() {
        assertEquals(0, MergeStrategies.mergeStatsHistory(null, null).length())
        assertEquals(0, MergeStrategies.mergeStatsHistory(JSONArray(), JSONArray()).length())
    }
}
