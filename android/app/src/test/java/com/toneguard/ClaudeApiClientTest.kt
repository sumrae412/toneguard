package com.toneguard

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

class ClaudeApiClientTest {
    @Test
    fun `analyze - safe ack passes locally`() {
        val client = ClaudeApiClient("sk-ant-test")
        val resultRef = AtomicReference<AnalysisResult>()

        client.analyze("sounds good", strictness = 2) { result ->
            resultRef.set(result)
        }

        val result = resultRef.get()
        assertNotNull(result)
        assertFalse(result.flagged)
        assertEquals("local_pass", result.routingRoute)
        assertEquals(listOf("phrase:sounds good"), result.routingHits)
        assertEquals("local", result.routingModel)
    }
}
