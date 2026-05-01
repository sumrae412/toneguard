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
 * Talks to the Railway-hosted sync server via JSON HTTP + WebSocket.
 */
class SyncManager(private val store: LearningStore) {

    companion object {
        private const val TAG = "ToneGuardSync"
        private const val SYNC_SERVER_URL = "https://sync-server-production-3a24.up.railway.app"
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

    var lastSyncAt: String? = null
        private set

    var isConnected: Boolean = false
        private set

    var onSyncStatusChanged: ((connected: Boolean, lastSync: String?) -> Unit)? = null

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
            }
        }.start()
    }

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

    fun destroy() {
        realtimeWs?.close(1000, "shutdown")
        realtimeWs = null
        debounceRunnable?.let { handler.removeCallbacks(it) }
        pollRunnable?.let { handler.removeCallbacks(it) }
    }

    // --- Auth ---

    private fun authenticate() {
        val hash = userHash ?: return
        val body = JSONObject().apply { put("hash", hash) }

        val request = Request.Builder()
            .url("$SYNC_SERVER_URL/auth")
            .addHeader("Content-Type", "application/json")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw IOException("Sync auth failed: ${response.code}")
        }

        val data = JSONObject(response.body?.string() ?: "{}")
        jwt = data.optString("token").takeIf { it.isNotBlank() }
    }

    // --- Pull ---

    private fun pull() {
        val request = Request.Builder()
            .url("$SYNC_SERVER_URL/sync")
            .headers(authHeaders())
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
        val types: List<String>
        synchronized(pendingPush) {
            types = pendingPush.toList()
            pendingPush.clear()
        }

        for (dataType in types) {
            try {
                val storageKey = STORAGE_KEYS[dataType] ?: continue
                var payload = store.getRawJson(storageKey)

                if (dataType == "custom_rules" && payload is String) {
                    payload = JSONObject().apply {
                        put("rules", payload)
                        put("updatedAt", java.time.Instant.now().toString())
                    }
                }

                val version = synchronized(versionsLock) { remoteVersions[dataType] ?: 0 }

                val body = JSONObject().apply {
                    put("data_type", dataType)
                    put("payload", payload)
                    put("version", version)
                }

                val request = Request.Builder()
                    .url("$SYNC_SERVER_URL/sync")
                    .headers(authHeaders())
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

        val token = jwt ?: return
        val wsUrl = SYNC_SERVER_URL.replace("https://", "wss://") +
            "/ws?token=" + java.net.URLEncoder.encode(token, "UTF-8")

        val request = Request.Builder().url(wsUrl).build()

        realtimeWs = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    if (msg.optString("event") == "UPDATE") {
                        val dataType = msg.optString("data_type")
                        val payload = msg.opt("payload")
                        val storageKey = STORAGE_KEYS[dataType] ?: return

                        val localData = store.getRawJson(storageKey)
                        val merged = merge(dataType, localData, payload)
                        if (merged != null) {
                            store.setRawJson(storageKey, merged)
                        }
                    }
                } catch (_: Exception) {
                    // Ignore parse errors.
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

    private fun authHeaders(): Headers {
        val token = jwt ?: throw IOException("Not authenticated")
        return Headers.Builder()
            .add("Content-Type", "application/json")
            .add("Authorization", "Bearer $token")
            .build()
    }

    private fun notifyStatus() {
        handler.post {
            onSyncStatusChanged?.invoke(isConnected, lastSyncAt)
        }
    }
}
