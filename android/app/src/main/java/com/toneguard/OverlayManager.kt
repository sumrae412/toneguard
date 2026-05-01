package com.toneguard

import android.animation.ObjectAnimator
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.text.LineBreaker
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.view.*
import android.widget.*
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton

class OverlayManager(
    private val context: Context,
    private val learningStore: LearningStore? = null,
    private val syncManager: SyncManager? = null
) {

    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var overlayView: View? = null
    private var currentResult: AnalysisResult? = null
    private var currentOriginal: String? = null

    private val layoutParams: WindowManager.LayoutParams
        get() = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

    fun showLoading() {
        handler.post {
            ensureOverlay()
            setVisibility(loading = true)
        }
    }

    fun showPassed() {
        handler.post {
            ensureOverlay()
            setVisibility(passed = true)
            handler.postDelayed({ dismiss() }, 2000)
        }
    }

    fun showResult(result: AnalysisResult, original: String) {
        handler.post {
            currentResult = result
            currentOriginal = original
            ensureOverlay()
            val view = overlayView ?: return@post

            // Populate
            view.findViewById<TextView>(R.id.reasoning).text = result.reasoning

            val confidenceBar = view.findViewById<ProgressBar>(R.id.confidenceBar)
            confidenceBar.max = 100
            confidenceBar.progress = (result.confidence * 100).toInt()

            // Red flags
            val flagsContainer = view.findViewById<LinearLayout>(R.id.redFlagsContainer)
            if (result.redFlags.isNotEmpty()) {
                flagsContainer.visibility = View.VISIBLE
                // We use a simple FlowLayout approach with a LinearLayout of wrapped TextViews
                val flagsFlow = view.findViewById<ViewGroup>(R.id.flagsFlow)
                flagsFlow.removeAllViews()
                for (flag in result.redFlags) {
                    val chip = TextView(context).apply {
                        text = flag
                        textSize = 12f
                        setTextColor(ContextCompat.getColor(context, R.color.red_chip))
                        setBackgroundColor(ContextCompat.getColor(context, R.color.red_bg))
                        setPadding(dp(10), dp(3), dp(10), dp(3))
                    }
                    flagsFlow.addView(chip)
                }
            } else {
                flagsContainer.visibility = View.GONE
            }

            // Diff
            val diffView = view.findViewById<TextView>(R.id.diffView)
            diffView.text = buildDiffSpannable(original, result.suggestion)

            // Suggestion
            view.findViewById<TextView>(R.id.suggestionText).text = result.suggestion

            // Badge
            val badge = view.findViewById<TextView>(R.id.badge)
            badge.visibility = View.VISIBLE
            when (result.mode) {
                "polish" -> { badge.text = "Polish"; badge.setTextColor(0xFF1565C0.toInt()) }
                "both" -> { badge.text = "Tone + Polish"; badge.setTextColor(0xFFE65100.toInt()) }
                else -> { badge.text = "Tone"; badge.setTextColor(0xFFE65100.toInt()) }
            }

            // Actions
            view.findViewById<MaterialButton>(R.id.useSuggestionBtn).setOnClickListener {
                copyToClipboard(result.suggestion)
                view.findViewById<TextView>(R.id.copyFeedback).text =
                    "Copied! Switch back to your app and paste."

                // Log decision
                learningStore?.logDecision(
                    action = "used_suggestion",
                    original = original,
                    suggestion = result.suggestion,
                    finalText = null
                )
                learningStore?.trackDecisionStats("used_suggestion")
                syncManager?.schedulePush("decisions")

                handler.postDelayed({ dismiss() }, 2000)
            }

            view.findViewById<MaterialButton>(R.id.dismissBtn).setOnClickListener {
                // Log decision
                learningStore?.logDecision(
                    action = "sent_original",
                    original = original,
                    suggestion = result.suggestion,
                    finalText = null
                )
                learningStore?.trackDecisionStats("sent_original")
                syncManager?.schedulePush("decisions")

                dismiss()
            }

            setVisibility(result = true)
            animateDrawerIn()
        }
    }

    fun showError(result: AnalysisResult, onRetry: (() -> Unit)? = null) {
        handler.post {
            ensureOverlay()
            val view = overlayView ?: return@post

            view.findViewById<TextView>(R.id.errorTitle).text = "ToneGuard could not check this message"
            view.findViewById<TextView>(R.id.errorMessage).text =
                result.error ?: "Something went wrong while checking the message."
            view.findViewById<TextView>(R.id.errorDiagnostic).text =
                listOfNotNull(result.errorType, result.diagnosticCode).joinToString(" • ")

            view.findViewById<MaterialButton>(R.id.retryBtn).visibility =
                if (result.retryable && onRetry != null) View.VISIBLE else View.GONE
            view.findViewById<MaterialButton>(R.id.retryBtn).setOnClickListener {
                dismiss()
                onRetry?.invoke()
            }
            view.findViewById<MaterialButton>(R.id.errorDismissBtn).setOnClickListener {
                dismiss()
            }

            setVisibility(error = true)
            animateDrawerIn()
        }
    }

    fun dismiss() {
        handler.post {
            overlayView?.let {
                try {
                    windowManager.removeView(it)
                } catch (_: Exception) {}
            }
            overlayView = null
            currentResult = null
        }
    }

    fun isShowing(): Boolean = overlayView != null

    private fun ensureOverlay() {
        if (overlayView != null) return

        val inflater = LayoutInflater.from(context)
        overlayView = inflater.inflate(R.layout.overlay_drawer, null)

        overlayView?.findViewById<View>(R.id.backdrop)?.setOnClickListener { dismiss() }
        overlayView?.findViewById<View>(R.id.closeBtn)?.setOnClickListener { dismiss() }

        try {
            windowManager.addView(overlayView, layoutParams)
        } catch (e: Exception) {
            overlayView = null
        }
    }

    private fun setVisibility(
        loading: Boolean = false,
        passed: Boolean = false,
        result: Boolean = false,
        error: Boolean = false
    ) {
        val view = overlayView ?: return
        view.findViewById<View>(R.id.loadingView).visibility = if (loading) View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.passedView).visibility = if (passed) View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.resultView).visibility = if (result) View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.errorView).visibility = if (error) View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.actionsView).visibility = if (result) View.VISIBLE else View.GONE

        if (loading || passed || error) {
            animateDrawerIn()
        }
    }

    private fun animateDrawerIn() {
        val drawer = overlayView?.findViewById<View>(R.id.drawer) ?: return
        val backdrop = overlayView?.findViewById<View>(R.id.backdrop) ?: return

        drawer.post {
            ObjectAnimator.ofFloat(drawer, "translationY", drawer.height.toFloat(), 0f).apply {
                duration = 300
                start()
            }
            ObjectAnimator.ofFloat(backdrop, "alpha", 0f, 1f).apply {
                duration = 200
                start()
            }
        }
    }

    private fun copyToClipboard(text: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("ToneGuard suggestion", text))
    }

    private fun buildDiffSpannable(original: String, suggestion: String): SpannableStringBuilder {
        val oldWords = original.split(Regex("((?<=\\s)|(?=\\s))"))
        val newWords = suggestion.split(Regex("((?<=\\s)|(?=\\s))"))
        val m = oldWords.size
        val n = newWords.size

        // LCS table
        val dp = Array(m + 1) { IntArray(n + 1) }
        for (i in 1..m) {
            for (j in 1..n) {
                dp[i][j] = if (oldWords[i - 1] == newWords[j - 1]) {
                    dp[i - 1][j - 1] + 1
                } else {
                    maxOf(dp[i - 1][j], dp[i][j - 1])
                }
            }
        }

        // Backtrack
        data class Seg(val type: String, var text: String)
        val stack = mutableListOf<Seg>()
        var i = m; var j = n
        while (i > 0 || j > 0) {
            when {
                i > 0 && j > 0 && oldWords[i - 1] == newWords[j - 1] -> {
                    stack.add(Seg("same", oldWords[i - 1])); i--; j--
                }
                j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) -> {
                    stack.add(Seg("added", newWords[j - 1])); j--
                }
                else -> {
                    stack.add(Seg("removed", oldWords[i - 1])); i--
                }
            }
        }
        stack.reverse()

        // Merge adjacent
        val segments = mutableListOf<Seg>()
        for (seg in stack) {
            if (segments.isNotEmpty() && segments.last().type == seg.type) {
                segments.last().text += seg.text
            } else {
                segments.add(seg)
            }
        }

        // Build spannable
        val sb = SpannableStringBuilder()
        val addedBg = ContextCompat.getColor(context, R.color.diff_added_bg)
        val addedFg = ContextCompat.getColor(context, R.color.diff_added_text)
        val removedBg = ContextCompat.getColor(context, R.color.diff_removed_bg)
        val removedFg = ContextCompat.getColor(context, R.color.diff_removed_text)

        for (seg in segments) {
            val start = sb.length
            sb.append(seg.text)
            val end = sb.length
            when (seg.type) {
                "added" -> {
                    sb.setSpan(BackgroundColorSpan(addedBg), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.setSpan(ForegroundColorSpan(addedFg), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                "removed" -> {
                    sb.setSpan(BackgroundColorSpan(removedBg), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.setSpan(ForegroundColorSpan(removedFg), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.setSpan(StrikethroughSpan(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
            }
        }
        return sb
    }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}
