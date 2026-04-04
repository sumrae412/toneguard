package com.toneguard

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest

/**
 * Sync orchestrator for cross-platform learning data.
 * Mirrors src/sync/sync-manager.js behavior exactly.
 * Uses OkHttp for Supabase REST calls and WebSocket for Realtime.
 */
class SyncManager(private val store: LearningStore) {

    companion object {
        private const val TAG = "ToneGuardSync"
        private const val SUPABASE_URL = "https://jimjfaaaccqtcbbxsrys.supabase.co"
        private const val SUPABASE_ANON_KEY = "sb_publishable_NyUr9I9amTiVVWT5H8ysvg_lB054qK0"
        private const val TABLE = "sync_data"
        private const val DEBOUNCE_MS = 5000L
        private const val POLL_INTERVAL_MS = 5 * 60 * 1000L // 5 minutes

        private val DATA_TYPES = listOf("decisions", "voice_samples", "relationships", "custom_rules", "stats_history")
        private val STORAGE_KEYS = mapOf(
            "decisions" to LearningStore.KEY_DECISIONS,
            "voice_samples" to LearningStore.KEY_VOICE_SAMPLES,
            "relationships" to LearningStore.KEY_RELATIONSHIPS,
            "custom_rules" to LearningStore.KEY_CUSTOM_RULES,
            "stats_history" to LearningStore.KEY_STATS_HISTORY
        )

        fun hashApiKey(apiKey: String): String {
            val bytes = MessageDigest.getInstance("SHA-256").digest(apiKey.toByteArray())
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    private val handler = Handler(Looper.getMainLooper())

    private var userHash: String? = null
    private var jwt: String? = null
    @Volatile private var remoteVersions = mutableMapOf<String, Int>()
    private val versionsLock = Any()
    private val pendingPush = mutableSetOf<String>()
    private var debounceRunnable: Runnable? = null
    private var pollRunnable: Runnable? = null
    private var realtimeWs: WebSocket? = null
    private var heartbeatRunnable: Runnable? = null

    var lastSyncAt: String? = null
        private set

    var isConnected: Boolean = false
        private set

    var onSyncStatusChanged: ((connected: Boolean, lastSync: String?) -> Unit)? = null

    /**
     * Initialize sync: hash API key, authenticate, pull, subscribe.
     */
    fun init(apiKey: String) {
        if (apiKey.isBlank()) return

        userHash = hashApiKey(apiKey)

        Thread {
            try {
                authenticate()
                pull()
                startSubscription()
                startPolling()
                isConnected = true
                notifyStatus()
            } catch (e: Exception) {
                Log.e(TAG, "Sync init failed: ${e.message}")
                isConnected = false
                notifyStatus()
                // Sync is optional — app works offline
            }
        }.start()
    }

    /**
     * Mark a data type as dirty and schedule a debounced push.
     */
    fun schedulePush(dataType: String) {
        synchronized(pendingPush) {
            pendingPush.add(dataType)
        }

        debounceRunnable?.let { handler.removeCallbacks(it) }
        debounceRunnable = Runnable {
            Thread { flushPush() }.start()
        }
        handler.postDelayed(debounceRunnable!!, DEBOUNCE_MS)
    }

    /**
     * Clean shutdown.
     */
    fun destroy() {
        realtimeWs?.close(1000, "shutdown")
        realtimeWs = null
        heartbeatRunnable?.let { handler.removeCallbacks(it) }
        heartbeatRunnable = null
        debounceRunnable?.let { handler.removeCallbacks(it) }
        pollRunnable?.let { handler.removeCallbacks(it) }
    }

    // --- Auth ---

    private fun authenticate() {
        val hash = userHash ?: return
        val body = JSONObject().apply { put("hash", hash) }

        val request = Request.Builder()
            .url("$SUPABASE_URL/functions/v1/auth-by-hash")
            .addHeader("Content-Type", "application/json")
            .addHeader("Authorization", "Bearer $SUPABASE_ANON_KEY")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw IOException("Sync auth failed: ${response.code}")
        }

        val data = JSONObject(response.body?.string() ?: "{}")
        jwt = data.optString("token", null)
    }

    // --- Pull ---

    private fun pull() {
        val hash = userHash ?: return

        val url = "$SUPABASE_URL/rest/v1/$TABLE?user_hash=eq.$hash&select=data_type,payload,version,updated_at"
        val request = Request.Builder()
            .url(url)
            .headers(buildHeaders())
            .get()
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw IOException("Sync pull failed: ${response.code}")
        }

        val rows = JSONArray(response.body?.string() ?: "[]")
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val dataType = row.optString("data_type")
            val payload = row.opt("payload")
            val version = row.optInt("version", 0)

            synchronized(versionsLock) { remoteVersions[dataType] = version }
            val storageKey = STORAGE_KEYS[dataType] ?: continue
            val localData = store.getRawJson(storageKey)

            val merged = merge(dataType, localData, payload)
            if (merged != null) {
                store.setRawJson(storageKey, merged)
            }
        }

        lastSyncAt = java.time.Instant.now().toString()
        notifyStatus()
    }

    // --- Push ---

    private fun flushPush() {
        val hash = userHash ?: return

        val types: List<String>
        synchronized(pendingPush) {
            types = pendingPush.toList()
            pendingPush.clear()
        }

        for (dataType in types) {
            try {
                val storageKey = STORAGE_KEYS[dataType] ?: continue
                var payload = store.getRawJson(storageKey)

                // Wrap custom_rules with updatedAt for LWW
                if (dataType == "custom_rules" && payload is String) {
                    payload = JSONObject().apply {
                        put("rules", payload)
                        put("updatedAt", java.time.Instant.now().toString())
                    }
                }

                val version = synchronized(versionsLock) { remoteVersions[dataType] ?: 0 }

                val body = JSONObject().apply {
                    put("user_hash", hash)
                    put("data_type", dataType)
                    put("payload", payload)
                    put("version", version + 1)
                    put("updated_at", java.time.Instant.now().toString())
                }

                val request = Request.Builder()
                    .url("$SUPABASE_URL/rest/v1/$TABLE")
                    .headers(buildHeaders().newBuilder()
                        .add("Prefer", "resolution=merge-duplicates")
                        .build())
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    synchronized(versionsLock) { remoteVersions[dataType] = version + 1 }
                } else {
                    Log.e(TAG, "Push failed for $dataType: ${response.code}")
                    synchronized(pendingPush) { pendingPush.add(dataType) }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Push failed for $dataType: ${e.message}")
                synchronized(pendingPush) { pendingPush.add(dataType) }
            }
        }

        lastSyncAt = java.time.Instant.now().toString()
        notifyStatus()
    }

    // --- Merge ---

    private fun merge(dataType: String, local: Any?, remote: Any?): Any? {
        return when (dataType) {
            "decisions" -> MergeStrategies.mergeDecisions(
                local as? JSONArray, remote as? JSONArray
            )
            "voice_samples" -> MergeStrategies.mergeVoiceSamples(
                local as? JSONArray, remote as? JSONArray
            )
            "relationships" -> MergeStrategies.mergeRelationships(
                local as? JSONObject, remote as? JSONObject
            )
            "custom_rules" -> {
                val localWrapped = when (local) {
                    is String -> JSONObject().apply { put("rules", local); put("updatedAt", "") }
                    is JSONObject -> local
                    else -> JSONObject().apply { put("rules", ""); put("updatedAt", "") }
                }
                val remoteWrapped = remote as? JSONObject
                    ?: JSONObject().apply { put("rules", ""); put("updatedAt", "") }
                val result = MergeStrategies.mergeCustomRules(localWrapped, remoteWrapped)
                result.rules
            }
            "stats_history" -> MergeStrategies.mergeStatsHistory(
                local as? JSONArray, remote as? JSONArray
            )
            else -> remote
        }
    }

    // --- Realtime ---

    private fun startSubscription() {
        realtimeWs?.close(1000, "reconnect")

        val hash = userHash ?: return
        val wsUrl = SUPABASE_URL.replace("https://", "wss://") +
            "/realtime/v1/websocket?apikey=$SUPABASE_ANON_KEY"

        val request = Request.Builder().url(wsUrl).build()

        realtimeWs = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val joinMsg = JSONObject().apply {
                    put("topic", "realtime:$TABLE:user_hash=eq.$hash")
                    put("event", "phx_join")
                    put("payload", JSONObject().apply {
                        put("config", JSONObject().apply {
                            put("broadcast", JSONObject().apply { put("self", false) })
                        })
                    })
                    put("ref", "1")
                }
                webSocket.send(joinMsg.toString())

                // Start heartbeat (tracked for cleanup in destroy())
                heartbeatRunnable?.let { handler.removeCallbacks(it) }
                heartbeatRunnable = object : Runnable {
                    override fun run() {
                        try {
                            val hb = JSONObject().apply {
                                put("topic", "phoenix")
                                put("event", "heartbeat")
                                put("payload", JSONObject())
                                put("ref", System.currentTimeMillis().toString())
                            }
                            webSocket.send(hb.toString())
                            handler.postDelayed(this, 30000)
                        } catch (_: Exception) { /* ws closed */ }
                    }
                }
                handler.postDelayed(heartbeatRunnable!!, 30000)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    val event = msg.optString("event")
                    if (event == "INSERT" || event == "UPDATE") {
                        val record = msg.optJSONObject("payload")?.optJSONObject("record") ?: return
                        val dataType = record.optString("data_type")
                        val payload = record.opt("payload")
                        val storageKey = STORAGE_KEYS[dataType] ?: return

                        val localData = store.getRawJson(storageKey)
                        val merged = merge(dataType, localData, payload)
                        if (merged != null) {
                            store.setRawJson(storageKey, merged)
                        }
                    }
                } catch (_: Exception) {
                    // Ignore parse errors from heartbeats etc.
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Realtime connection failed: ${t.message}")
            }
        })
    }

    // --- Polling ---

    private fun startPolling() {
        pollRunnable?.let { handler.removeCallbacks(it) }
        pollRunnable = object : Runnable {
            override fun run() {
                Thread {
                    try { pull() } catch (e: Exception) {
                        Log.e(TAG, "Poll failed: ${e.message}")
                    }
                }.start()
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
        handler.postDelayed(pollRunnable!!, POLL_INTERVAL_MS)
    }

    // --- Helpers ---

    private fun buildHeaders(): Headers {
        return Headers.Builder()
            .add("Content-Type", "application/json")
            .add("apikey", SUPABASE_ANON_KEY)
            .add("Authorization", "Bearer ${jwt ?: SUPABASE_ANON_KEY}")
            .build()
    }

    private fun notifyStatus() {
        handler.post {
            onSyncStatusChanged?.invoke(isConnected, lastSyncAt)
        }
    }
}
