package com.toneguard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.slider.Slider
import com.google.android.material.textfield.TextInputEditText
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var apiKeyInput: TextInputEditText
    private lateinit var saveKeyBtn: MaterialButton
    private lateinit var keyStatus: TextView
    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var readyHint: TextView
    private lateinit var strictnessSlider: Slider
    private lateinit var strictnessLabel: TextView
    private lateinit var intentModeSpinner: Spinner
    private lateinit var voiceStrengthSpinner: Spinner
    private lateinit var testToneGuardBtn: MaterialButton
    private lateinit var accessibilityBtn: MaterialButton
    private lateinit var overlayBtn: MaterialButton
    private lateinit var supportedAppsContainer: LinearLayout
    private lateinit var diagnosticsSwitch: SwitchCompat
    private lateinit var diagnosticsText: TextView
    private lateinit var lastDetectedEvent: TextView
    private lateinit var copyDiagnosticsBtn: MaterialButton
    private lateinit var clearDiagnosticsBtn: MaterialButton
    private lateinit var syncDot: View
    private lateinit var syncText: TextView

    private var syncManager: SyncManager? = null
    private lateinit var diagnosticStore: DiagnosticStore
    private val strictnessLabels = mapOf(1f to "Gentle", 2f to "Balanced", 3f to "Strict")
    private val intentModes = listOf("professional", "warm", "direct", "deescalating", "boundary", "concise")
    private val voiceStrengths = listOf("light", "balanced", "strong")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        apiKeyInput = findViewById(R.id.apiKeyInput)
        saveKeyBtn = findViewById(R.id.saveKeyBtn)
        keyStatus = findViewById(R.id.keyStatus)
        statusDot = findViewById(R.id.statusDot)
        statusText = findViewById(R.id.statusText)
        readyHint = findViewById(R.id.readyHint)
        strictnessSlider = findViewById(R.id.strictnessSlider)
        strictnessLabel = findViewById(R.id.strictnessLabel)
        intentModeSpinner = findViewById(R.id.intentModeSpinner)
        voiceStrengthSpinner = findViewById(R.id.voiceStrengthSpinner)
        testToneGuardBtn = findViewById(R.id.testToneGuardBtn)
        accessibilityBtn = findViewById(R.id.accessibilityBtn)
        overlayBtn = findViewById(R.id.overlayBtn)
        supportedAppsContainer = findViewById(R.id.supportedAppsContainer)
        diagnosticsSwitch = findViewById(R.id.diagnosticsSwitch)
        diagnosticsText = findViewById(R.id.diagnosticsText)
        lastDetectedEvent = findViewById(R.id.lastDetectedEvent)
        copyDiagnosticsBtn = findViewById(R.id.copyDiagnosticsBtn)
        clearDiagnosticsBtn = findViewById(R.id.clearDiagnosticsBtn)
        syncDot = findViewById(R.id.syncDot)
        syncText = findViewById(R.id.syncText)
        diagnosticStore = DiagnosticStore(this)

        // Load saved settings
        val savedKey = Prefs.getApiKey(this)
        if (!savedKey.isNullOrBlank()) {
            apiKeyInput.setText(savedKey)
        }

        val strictness = Prefs.getStrictness(this)
        strictnessSlider.value = strictness.toFloat()
        strictnessLabel.text = strictnessLabels[strictness.toFloat()] ?: "Balanced"
        setupStyleControls()
        renderSupportedApps()
        setupDiagnostics()

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
            initSync(key)
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

        testToneGuardBtn.setOnClickListener {
            runToneGuardTest()
        }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
        renderDiagnostics()

        // Init sync if we have an API key
        val savedKey = Prefs.getApiKey(this)
        if (!savedKey.isNullOrBlank() && syncManager == null) {
            initSync(savedKey)
        }
    }

    override fun onDestroy() {
        syncManager?.destroy()
        super.onDestroy()
    }

    private fun initSync(apiKey: String) {
        syncManager?.destroy()
        val store = LearningStore(this)
        syncManager = SyncManager(store).also { sm ->
            sm.onSyncStatusChanged = { connected, lastSync ->
                updateSyncStatus(connected, lastSync)
            }
            sm.init(apiKey)
        }
    }

    private fun updateSyncStatus(connected: Boolean, lastSync: String?) {
        if (connected) {
            syncDot.setBackgroundResource(R.drawable.dot_active)
            val timeStr = if (lastSync != null) {
                try {
                    val instant = java.time.Instant.parse(lastSync)
                    val formatter = java.time.format.DateTimeFormatter.ofPattern("h:mm a")
                        .withZone(java.time.ZoneId.systemDefault())
                    "Synced at ${formatter.format(instant)}"
                } catch (_: Exception) { "Synced" }
            } else "Connected"
            syncText.text = timeStr
        } else {
            syncDot.setBackgroundResource(R.drawable.dot_inactive)
            syncText.text = "Not synced"
        }
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

        readyHint.visibility = if (hasKey && hasAccessibility && hasOverlay) View.VISIBLE else View.GONE

        // Update button states
        accessibilityBtn.text = if (hasAccessibility) "Accessibility: Enabled" else getString(R.string.setup_accessibility)
        overlayBtn.text = if (hasOverlay) "Overlay: Granted" else "Grant Overlay Permission"
    }

    private fun setupStyleControls() {
        intentModeSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            intentModes
        )
        voiceStrengthSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            voiceStrengths
        )

        intentModeSpinner.setSelection(intentModes.indexOf(Prefs.getIntentMode(this)).coerceAtLeast(0))
        voiceStrengthSpinner.setSelection(voiceStrengths.indexOf(Prefs.getVoiceStrength(this)).coerceAtLeast(1))

        intentModeSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                Prefs.setIntentMode(this@MainActivity, intentModes[position])
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }

        voiceStrengthSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                Prefs.setVoiceStrength(this@MainActivity, voiceStrengths[position])
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }
    }

    private fun renderSupportedApps() {
        supportedAppsContainer.removeAllViews()
        val enabledPackages = Prefs.getEnabledPackages(this)

        for (app in AccessibilityMatcher.supportedApps) {
            val row = SwitchCompat(this).apply {
                text = "${app.label} • ${app.note}"
                textSize = 14f
                setTextColor(getColor(R.color.text_primary))
                isChecked = enabledPackages.contains(app.packagePrefix)
                setPadding(0, 4, 0, 4)
                setOnCheckedChangeListener { _, checked ->
                    Prefs.setPackageEnabled(this@MainActivity, app.packagePrefix, checked)
                }
            }
            supportedAppsContainer.addView(row)
        }
    }

    private fun setupDiagnostics() {
        diagnosticsSwitch.isChecked = Prefs.isDiagnosticsEnabled(this)
        diagnosticsSwitch.setOnCheckedChangeListener { _, checked ->
            Prefs.setDiagnosticsEnabled(this, checked)
            renderDiagnostics()
        }
        copyDiagnosticsBtn.setOnClickListener {
            copyDiagnostics()
        }
        clearDiagnosticsBtn.setOnClickListener {
            diagnosticStore.clear()
            renderDiagnostics()
        }
        renderDiagnostics()
    }

    private fun renderDiagnostics() {
        if (!Prefs.isDiagnosticsEnabled(this)) {
            diagnosticsText.text = "Diagnostics are off. When enabled, ToneGuard records metadata only: app package, event type, button label/id, and whether an editable field was found. Message text is never saved."
            lastDetectedEvent.text = "Last detected event: diagnostics off"
            return
        }

        val recent = diagnosticStore.getRecent().take(5)
        lastDetectedEvent.text = if (recent.isEmpty()) {
            "Last detected event: none"
        } else {
            "Last detected event: ${formatDiagnostic(recent.first())}"
        }
        diagnosticsText.text = if (recent.isEmpty()) {
            "Diagnostics are on. Try tapping Send in a supported app, then return here. Message text is never saved."
        } else {
            recent.joinToString("\n\n") { event ->
                formatDiagnostic(event)
            }
        }
    }

    private fun formatDiagnostic(event: JSONObject): String {
        return listOf(
            event.optString("packageName", "unknown"),
            "event=${event.optString("eventType", "")}",
            "send=${event.optBoolean("sendCandidate", false)}",
            "editable=${event.optBoolean("editableFound", false)}",
            "route=${event.optString("route", "")}",
            "id=${event.optString("viewId", "")}",
            "label=${event.optString("contentDescription", event.optString("textLabel", ""))}"
        ).joinToString(" | ")
    }

    private fun copyDiagnostics() {
        val recent = diagnosticStore.getRecent()
        if (recent.isEmpty()) {
            Toast.makeText(this, "No diagnostics to copy.", Toast.LENGTH_SHORT).show()
            return
        }

        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(
            ClipData.newPlainText(
                "ToneGuard diagnostics",
                recent.joinToString("\n\n") { formatDiagnostic(it) }
            )
        )
        Toast.makeText(this, "Diagnostics copied.", Toast.LENGTH_SHORT).show()
    }

    private fun runToneGuardTest() {
        val apiKey = Prefs.getApiKey(this)
        if (apiKey.isNullOrBlank()) {
            Toast.makeText(this, "Save your API key first.", Toast.LENGTH_SHORT).show()
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Grant overlay permission first.", Toast.LENGTH_SHORT).show()
            return
        }

        val store = LearningStore(this)
        val overlay = OverlayManager(this, store, syncManager)
        val client = ClaudeApiClient(apiKey, store)
        val sample = "Per my last message, this should have been obvious. Fix it today."

        overlay.showLoading()
        Thread {
            client.analyze(
                sample,
                Prefs.getStrictness(this),
                Prefs.getIntentMode(this),
                Prefs.getVoiceStrength(this)
            ) { result ->
                runOnUiThread {
                    if (result.error != null) {
                        overlay.showError(result) { runToneGuardTest() }
                    } else if (result.flagged) {
                        overlay.showResult(result, sample)
                    } else {
                        overlay.showPassed()
                    }
                }
            }
        }.start()
    }
}
