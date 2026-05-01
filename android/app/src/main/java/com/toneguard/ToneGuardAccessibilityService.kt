package com.toneguard

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

class ToneGuardAccessibilityService : AccessibilityService() {

    private lateinit var overlay: OverlayManager
    private lateinit var learningStore: LearningStore
    private lateinit var diagnosticStore: DiagnosticStore
    private var syncManager: SyncManager? = null
    private val handler = Handler(Looper.getMainLooper())
    private var analyzing = false

    override fun onCreate() {
        super.onCreate()
        learningStore = LearningStore(this)
        diagnosticStore = DiagnosticStore(this)
        initSync()
        overlay = OverlayManager(this, learningStore, syncManager)
    }

    private fun initSync() {
        val apiKey = Prefs.getApiKey(this) ?: return
        syncManager = SyncManager(learningStore).also { it.init(apiKey) }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (!Prefs.isEnabled(this)) return
        if (Prefs.getApiKey(this).isNullOrBlank()) return
        if (analyzing || overlay.isShowing()) return

        val pkg = event.packageName?.toString() ?: return
        val supported = AccessibilityMatcher.isSupportedPackage(pkg, Prefs.getEnabledPackages(this))
        if (!supported) return

        if (event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            val source = event.source ?: return
            val isSend = AccessibilityMatcher.isSendButtonOrAncestor(source)
            if (Prefs.isDiagnosticsEnabled(this)) {
                recordDiagnostic(event, source, isSend, "click")
            }
            if (isSend) {
                handleSendClicked(pkg)
            }
        }
    }

    override fun onInterrupt() {
        overlay.dismiss()
    }

    override fun onDestroy() {
        overlay.dismiss()
        syncManager?.destroy()
        super.onDestroy()
    }

    private fun handleSendClicked(sourcePackage: String) {
        // Find the text field in the same window
        val rootNode = rootInActiveWindow ?: return
        val messageText = AccessibilityMatcher.findEditableText(rootNode)

        if (Prefs.isDiagnosticsEnabled(this)) {
            diagnosticStore.add(JSONObject().apply {
                put("packageName", sourcePackage)
                put("eventType", "send_attempt")
                put("sendCandidate", true)
                put("editableFound", !messageText.isNullOrBlank())
                put("route", if (messageText.isNullOrBlank()) "no_editable_text" else "analyze")
            })
        }

        if (messageText.isNullOrBlank() || messageText.trim().length < 10) return

        analyzeMessage(messageText)
    }

    private fun analyzeMessage(messageText: String) {
        // Check overlay permission
        if (!Settings.canDrawOverlays(this)) return

        analyzing = true
        overlay.showLoading()

        val apiKey = Prefs.getApiKey(this) ?: return
        val strictness = Prefs.getStrictness(this)
        val intentMode = Prefs.getIntentMode(this)
        val voiceStrength = Prefs.getVoiceStrength(this)
        val client = ClaudeApiClient(apiKey, learningStore)

        // Save recipient interaction for relationship tracking
        learningStore.saveRecipientInteraction(messageText)
        syncManager?.schedulePush("relationships")

        Thread {
            client.analyze(messageText, strictness, intentMode, voiceStrength) { result ->
                analyzing = false

                if (result.error != null) {
                    handler.post {
                        overlay.showError(result) {
                            analyzeMessage(messageText)
                        }
                    }
                    return@analyze
                }

                // Track stats
                learningStore.trackStats(result.flagged, result.mode)
                syncManager?.schedulePush("stats_history")

                if (!result.flagged) {
                    // Message passed — save as voice sample
                    learningStore.saveVoiceSample(messageText)
                    syncManager?.schedulePush("voice_samples")
                    overlay.showPassed()
                    return@analyze
                }

                overlay.showResult(result, messageText)
            }
        }.start()
    }

    private fun recordDiagnostic(
        event: AccessibilityEvent,
        source: AccessibilityNodeInfo?,
        sendCandidate: Boolean,
        route: String
    ) {
        val metadata = AccessibilityMatcher.metadataFor(source, includeTextLabel = sendCandidate)
        diagnosticStore.add(JSONObject().apply {
            put("packageName", event.packageName?.toString().orEmpty())
            put("eventType", event.eventType)
            put("sendCandidate", sendCandidate)
            put("editableFound", false)
            put("route", route)
            put("viewId", metadata["viewId"].orEmpty())
            put("className", metadata["className"].orEmpty())
            put("contentDescription", metadata["contentDescription"].orEmpty())
            put("textLabel", metadata["textLabel"].orEmpty())
            put("editable", metadata["editable"].orEmpty())
        })
    }

    companion object {
        fun isServiceEnabled(context: android.content.Context): Boolean {
            val service = "${context.packageName}/.ToneGuardAccessibilityService"
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            return enabledServices.contains(service)
        }
    }
}
