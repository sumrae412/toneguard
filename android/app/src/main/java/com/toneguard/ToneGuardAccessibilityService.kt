package com.toneguard

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class ToneGuardAccessibilityService : AccessibilityService() {

    private lateinit var overlay: OverlayManager
    private val handler = Handler(Looper.getMainLooper())
    private var analyzing = false

    // Packages where we look for send buttons
    private val supportedPackages = setOf(
        "com.slack",
        "com.Slack",
        "com.google.android.gm",          // Gmail
        "com.linkedin.android",
        "com.whatsapp",
        "com.facebook.orca",               // Messenger
        "com.google.android.apps.messaging", // Google Messages
        "org.telegram.messenger",
        "com.discord",
        "com.microsoft.teams"
    )

    // Common send button identifiers
    private val sendButtonIds = setOf(
        "send", "send_button", "btn_send", "compose_send",
        "send_message", "message_send_button", "texty_send_button"
    )

    private val sendButtonLabels = setOf(
        "send", "send message", "send sms"
    )

    override fun onCreate() {
        super.onCreate()
        overlay = OverlayManager(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (!Prefs.isEnabled(this)) return
        if (Prefs.getApiKey(this).isNullOrBlank()) return
        if (analyzing || overlay.isShowing()) return

        val pkg = event.packageName?.toString() ?: return
        if (!supportedPackages.any { pkg.startsWith(it) }) return

        if (event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            val source = event.source ?: return
            if (isSendButton(source)) {
                handleSendClicked(source)
            }
            source.recycle()
        }
    }

    override fun onInterrupt() {
        overlay.dismiss()
    }

    override fun onDestroy() {
        overlay.dismiss()
        super.onDestroy()
    }

    private fun isSendButton(node: AccessibilityNodeInfo): Boolean {
        // Check resource ID
        val viewId = node.viewIdResourceName?.lowercase() ?: ""
        if (sendButtonIds.any { viewId.contains(it) }) return true

        // Check content description
        val desc = node.contentDescription?.toString()?.lowercase() ?: ""
        if (sendButtonLabels.any { desc.contains(it) }) return true

        // Check text
        val text = node.text?.toString()?.lowercase() ?: ""
        if (sendButtonLabels.any { text.contains(it) }) return true

        return false
    }

    private fun handleSendClicked(sendButton: AccessibilityNodeInfo) {
        // Find the text field in the same window
        val rootNode = rootInActiveWindow ?: return
        val messageText = findEditableText(rootNode)
        rootNode.recycle()

        if (messageText.isNullOrBlank() || messageText.trim().length < 10) return

        // Check overlay permission
        if (!Settings.canDrawOverlays(this)) return

        analyzing = true
        overlay.showLoading()

        val apiKey = Prefs.getApiKey(this) ?: return
        val strictness = Prefs.getStrictness(this)
        val client = ClaudeApiClient(apiKey)

        Thread {
            client.analyze(messageText, strictness) { result ->
                analyzing = false

                if (result.error != null) {
                    handler.post { overlay.dismiss() }
                    return@analyze
                }

                if (!result.flagged) {
                    overlay.showPassed()
                    return@analyze
                }

                overlay.showResult(result, messageText)
            }
        }.start()
    }

    private fun findEditableText(node: AccessibilityNodeInfo): String? {
        // Look for editable text fields
        if (node.isEditable && node.text != null) {
            val text = node.text.toString().trim()
            if (text.isNotEmpty()) return text
        }

        // Check className for EditText/input fields
        val className = node.className?.toString() ?: ""
        if ((className.contains("EditText") || className.contains("edittext")) && node.text != null) {
            val text = node.text.toString().trim()
            if (text.isNotEmpty()) return text
        }

        // Recurse into children
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findEditableText(child)
            child.recycle()
            if (result != null) return result
        }

        return null
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
