package com.toneguard

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityMatcherTest {
    @Test
    fun `isSupportedPackage - includes Chrome browsers`() {
        assertTrue(AccessibilityMatcher.isSupportedPackage("com.android.chrome"))
        assertTrue(AccessibilityMatcher.isSupportedPackage("com.chrome.beta"))
        assertTrue(AccessibilityMatcher.isSupportedPackage("org.mozilla.firefox"))
        assertTrue(AccessibilityMatcher.isSupportedPackage("com.microsoft.emmx"))
        assertTrue(AccessibilityMatcher.isSupportedPackage("com.brave.browser"))
    }

    @Test
    fun `isSupportedPackage - includes common Android SMS apps`() {
        assertTrue(AccessibilityMatcher.isSupportedPackage("com.google.android.apps.messaging"))
        assertTrue(AccessibilityMatcher.isSupportedPackage("com.samsung.android.messaging"))
    }

    @Test
    fun `isSupportedPackage - rejects unrelated apps`() {
        assertFalse(AccessibilityMatcher.isSupportedPackage("com.example.notes"))
    }

    @Test
    fun `isSendButtonMetadata - detects browser website submit controls`() {
        assertTrue(AccessibilityMatcher.isSendButtonMetadata(null, null, "Post"))
        assertTrue(AccessibilityMatcher.isSendButtonMetadata(null, "Submit reply", null))
        assertTrue(AccessibilityMatcher.isSendButtonMetadata("com.site:id/comment_submit", null, null))
    }

    @Test
    fun `isSendButtonMetadata - detects Google Messages send controls`() {
        assertTrue(AccessibilityMatcher.isSendButtonMetadata(null, "Send message SMS", null))
        assertTrue(AccessibilityMatcher.isSendButtonMetadata(null, "Send message MMS", null))
        assertTrue(AccessibilityMatcher.isSendButtonMetadata("com.google.android.apps.messaging:id/send_message_button", null, null))
    }

    @Test
    fun `isSendButtonMetadata - does not match long unrelated text`() {
        assertFalse(AccessibilityMatcher.isSendButtonMetadata(null, null, "Send feedback later"))
    }

    @Test
    fun `isExcludedEditableMetadata - skips browser address fields`() {
        assertTrue(AccessibilityMatcher.isExcludedEditableMetadata("com.android.chrome:id/url_bar", null, null, "example.com"))
        assertTrue(AccessibilityMatcher.isExcludedEditableMetadata(null, "Search or type web address", null, "toneguard"))
        assertTrue(AccessibilityMatcher.isExcludedEditableMetadata(null, null, null, "https://example.com"))
    }

    @Test
    fun `isExcludedEditableMetadata - allows website compose text`() {
        assertFalse(AccessibilityMatcher.isExcludedEditableMetadata(null, "Comment", "Write a reply", "Per my last email, fix this today."))
    }
}
