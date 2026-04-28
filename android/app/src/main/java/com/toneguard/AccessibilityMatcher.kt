package com.toneguard

import android.view.accessibility.AccessibilityNodeInfo

object AccessibilityMatcher {
    data class SupportedApp(
        val label: String,
        val packagePrefix: String,
        val note: String
    )

    val supportedApps = listOf(
        SupportedApp("Google Messages", "com.google.android.apps.messaging", "SMS/RCS"),
        SupportedApp("Samsung Messages", "com.samsung.android.messaging", "SMS/MMS"),
        SupportedApp("Gmail", "com.google.android.gm", "Email"),
        SupportedApp("Chrome", "com.android.chrome", "Web apps"),
        SupportedApp("Chrome Beta", "com.chrome.beta", "Web apps"),
        SupportedApp("Chrome Dev", "com.chrome.dev", "Web apps"),
        SupportedApp("Chrome Canary", "com.chrome.canary", "Web apps"),
        SupportedApp("Firefox", "org.mozilla.firefox", "Web apps"),
        SupportedApp("Firefox Beta", "org.mozilla.firefox_beta", "Web apps"),
        SupportedApp("Edge", "com.microsoft.emmx", "Web apps"),
        SupportedApp("Brave", "com.brave.browser", "Web apps"),
        SupportedApp("Slack", "com.slack", "Work chat"),
        SupportedApp("Slack", "com.Slack", "Work chat"),
        SupportedApp("LinkedIn", "com.linkedin.android", "Professional messages"),
        SupportedApp("WhatsApp", "com.whatsapp", "Messaging"),
        SupportedApp("Messenger", "com.facebook.orca", "Messaging"),
        SupportedApp("Telegram", "org.telegram.messenger", "Messaging"),
        SupportedApp("Discord", "com.discord", "Messaging"),
        SupportedApp("Teams", "com.microsoft.teams", "Work chat")
    )

    private val sendButtonIds = setOf(
        "send",
        "send_button",
        "btn_send",
        "compose_send",
        "send_message",
        "message_send_button",
        "texty_send_button",
        "submit",
        "post",
        "reply"
    )

    private val sendButtonLabels = setOf(
        "send",
        "send message",
        "send sms",
        "send mms",
        "send message sms",
        "send message mms",
        "send now",
        "post",
        "post reply",
        "reply",
        "submit",
        "submit reply",
        "comment",
        "publish"
    )

    private val excludedEditableIds = setOf(
        "url_bar",
        "location_bar",
        "search_box",
        "search_src_text",
        "omnibox",
        "address"
    )

    private val excludedEditableLabels = setOf(
        "search",
        "search or type web address",
        "address bar",
        "url",
        "site address"
    )

    fun isSupportedPackage(packageName: String): Boolean {
        return isSupportedPackage(packageName, supportedApps.map { it.packagePrefix }.toSet())
    }

    fun isSupportedPackage(packageName: String, enabledPackages: Set<String>): Boolean {
        return enabledPackages.any { packageName.startsWith(it) }
    }

    fun isSendButton(node: AccessibilityNodeInfo): Boolean {
        return isSendButtonMetadata(
            viewId = node.viewIdResourceName,
            contentDescription = node.contentDescription?.toString(),
            text = node.text?.toString()
        )
    }

    fun isSendButtonOrAncestor(node: AccessibilityNodeInfo): Boolean {
        if (isSendButton(node)) return true

        var parent = node.parent
        var depth = 0
        while (parent != null && depth < 3) {
            if (isSendButton(parent)) {
                parent.recycle()
                return true
            }
            val nextParent = parent.parent
            parent.recycle()
            parent = nextParent
            depth += 1
        }

        return false
    }

    fun isSendButtonMetadata(
        viewId: String?,
        contentDescription: String?,
        text: String?
    ): Boolean {
        val normalizedId = viewId.normalized()
        if (sendButtonIds.any { normalizedId.contains(it) }) return true

        val normalizedDescription = contentDescription.normalized()
        if (sendButtonLabels.any { normalizedDescription == it }) return true
        if (sendButtonLabels.any { it.contains(" ") && normalizedDescription.startsWith("$it ") }) {
            return true
        }

        val normalizedText = text.normalized()
        if (sendButtonLabels.any { normalizedText == it }) return true
        if (sendButtonLabels.any { it.contains(" ") && normalizedText.startsWith("$it ") }) {
            return true
        }

        return false
    }

    fun findEditableText(node: AccessibilityNodeInfo): String? {
        val direct = editableTextIfCandidate(node)
        if (direct != null) return direct

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findEditableText(child)
            child.recycle()
            if (result != null) return result
        }

        return null
    }

    private fun editableTextIfCandidate(node: AccessibilityNodeInfo): String? {
        val className = node.className?.toString() ?: ""
        val text = node.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return null

        val looksEditable = node.isEditable || className.contains("EditText", ignoreCase = true)
        if (!looksEditable) return null

        if (isExcludedEditableMetadata(
            viewId = node.viewIdResourceName,
            contentDescription = node.contentDescription?.toString(),
            hintText = node.hintText?.toString(),
            text = text
        )) {
            return null
        }

        return text
    }

    fun isExcludedEditableMetadata(
        viewId: String?,
        contentDescription: String?,
        hintText: String?,
        text: String?
    ): Boolean {
        val normalizedId = viewId.normalized()
        if (excludedEditableIds.any { normalizedId.contains(it) }) return true

        val labels = listOf(contentDescription, hintText).map { it.normalized() }
        if (labels.any { label -> excludedEditableLabels.any { label.contains(it) } }) {
            return true
        }

        val normalizedText = text.normalized()
        if (normalizedText.startsWith("http://") || normalizedText.startsWith("https://")) {
            return true
        }

        return false
    }

    fun metadataFor(node: AccessibilityNodeInfo?, includeTextLabel: Boolean = false): Map<String, String> {
        if (node == null) return emptyMap()
        return mapOf(
            "viewId" to node.viewIdResourceName.orEmpty().take(120),
            "className" to node.className?.toString().orEmpty().take(80),
            "contentDescription" to node.contentDescription?.toString().orEmpty().take(80),
            "textLabel" to if (includeTextLabel) node.text?.toString().orEmpty().take(80) else "",
            "editable" to node.isEditable.toString()
        )
    }

    private fun String?.normalized(): String {
        return this.orEmpty()
            .lowercase()
            .replace(Regex("[^\\w\\s:/.-]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }
}
