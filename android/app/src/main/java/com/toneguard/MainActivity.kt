package com.toneguard

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.TextView
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.slider.Slider
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    private lateinit var apiKeyInput: TextInputEditText
    private lateinit var saveKeyBtn: MaterialButton
    private lateinit var keyStatus: TextView
    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var strictnessSlider: Slider
    private lateinit var strictnessLabel: TextView
    private lateinit var accessibilityBtn: MaterialButton
    private lateinit var overlayBtn: MaterialButton

    private val strictnessLabels = mapOf(1f to "Gentle", 2f to "Balanced", 3f to "Strict")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        apiKeyInput = findViewById(R.id.apiKeyInput)
        saveKeyBtn = findViewById(R.id.saveKeyBtn)
        keyStatus = findViewById(R.id.keyStatus)
        statusDot = findViewById(R.id.statusDot)
        statusText = findViewById(R.id.statusText)
        strictnessSlider = findViewById(R.id.strictnessSlider)
        strictnessLabel = findViewById(R.id.strictnessLabel)
        accessibilityBtn = findViewById(R.id.accessibilityBtn)
        overlayBtn = findViewById(R.id.overlayBtn)

        // Load saved settings
        val savedKey = Prefs.getApiKey(this)
        if (!savedKey.isNullOrBlank()) {
            apiKeyInput.setText(savedKey)
        }

        val strictness = Prefs.getStrictness(this)
        strictnessSlider.value = strictness.toFloat()
        strictnessLabel.text = strictnessLabels[strictness.toFloat()] ?: "Balanced"

        // Save key
        saveKeyBtn.setOnClickListener {
            val key = apiKeyInput.text?.toString()?.trim() ?: ""
            if (key.isBlank()) {
                keyStatus.text = "Please enter an API key."
                keyStatus.setTextColor(getColor(R.color.red))
                return@setOnClickListener
            }
            if (!key.startsWith("sk-ant-")) {
                keyStatus.text = "API keys start with sk-ant-."
                keyStatus.setTextColor(getColor(R.color.red))
                return@setOnClickListener
            }
            Prefs.setApiKey(this, key)
            keyStatus.text = "Saved!"
            keyStatus.setTextColor(getColor(R.color.green))
            updateStatus()
        }

        // Strictness
        strictnessSlider.addOnChangeListener { _, value, _ ->
            strictnessLabel.text = strictnessLabels[value] ?: "Balanced"
            Prefs.setStrictness(this, value.toInt())
        }

        // Accessibility
        accessibilityBtn.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        // Overlay
        overlayBtn.setOnClickListener {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun updateStatus() {
        val hasKey = !Prefs.getApiKey(this).isNullOrBlank()
        val hasAccessibility = ToneGuardAccessibilityService.isServiceEnabled(this)
        val hasOverlay = Settings.canDrawOverlays(this)

        when {
            !hasKey -> {
                statusDot.setBackgroundResource(R.drawable.dot_inactive)
                statusText.text = getString(R.string.status_needs_key)
            }
            !hasAccessibility -> {
                statusDot.setBackgroundResource(R.drawable.dot_inactive)
                statusText.text = getString(R.string.status_needs_accessibility)
            }
            !hasOverlay -> {
                statusDot.setBackgroundResource(R.drawable.dot_inactive)
                statusText.text = "Grant overlay permission to show suggestions"
            }
            else -> {
                statusDot.setBackgroundResource(R.drawable.dot_active)
                statusText.text = getString(R.string.status_ready)
            }
        }

        // Update button states
        accessibilityBtn.text = if (hasAccessibility) "Accessibility: Enabled" else getString(R.string.setup_accessibility)
        overlayBtn.text = if (hasOverlay) "Overlay: Granted" else "Grant Overlay Permission"
    }
}
