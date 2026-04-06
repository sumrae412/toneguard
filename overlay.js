// ToneGuard In-Page Overlay
// Replaces the side panel with an injected drawer that doesn't require
// chrome.sidePanel.open() or user gesture context. Uses Shadow DOM for
// style isolation so host page CSS can't affect the overlay and vice versa.
// All HTML built via DOM API (no innerHTML) for security compliance.

(function () {
  "use strict";

  let host = null;
  let shadow = null;
  let currentResult = null;
  let suggestionWasEdited = false;
  let onDecision = null;

  // DOM references (set once on first ensureHost)
  let els = {};

  // Expose API on window for content.js to call.
  // setOnDecision must be called before freeze, so content.js setupOverlay()
  // runs first (overlay.js loads before content.js in manifest).
  // Object.freeze prevents host page scripts from overwriting the API.
  let decisionSet = false;
  window.__toneGuard = Object.freeze({
    showLoading,
    showResult,
    showPassed,
    showStale,
    hide,
    setOnDecision(fn) {
      if (decisionSet) return; // only allow one binding
      onDecision = fn;
      decisionSet = true;
    }
  });

  // --- State Management ---

  function resetState() {
    currentResult = null;
    suggestionWasEdited = false;
    if (!els.original) return;
    els.original.textContent = "";
    els.suggestion.textContent = "";
    els.reasoning.textContent = "";
    els.flagsList.textContent = "";
    els.categories.textContent = "";
    els.questionsList.textContent = "";
    if (els.useSuggestionBtn) {
      els.useSuggestionBtn.textContent = "Use suggestion";
    }
    // Clear any diff view
    const diffEl = els.drawer?.querySelector(".tg-diff");
    if (diffEl) diffEl.remove();
    // Clear any undo/toast
    clearToast();
  }

  // --- Word-Level Diff ---

  // Simple longest-common-subsequence word diff (no dependencies)
  function wordDiff(oldText, newText) {
    const oldWords = oldText.split(/(\s+)/);
    const newWords = newText.split(/(\s+)/);
    const m = oldWords.length;
    const n = newWords.length;

    // Build LCS table
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldWords[i - 1] === newWords[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to produce diff segments
    const segments = [];
    let i = m, j = n;
    const stack = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
        stack.push({ type: "same", text: oldWords[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        stack.push({ type: "added", text: newWords[j - 1] });
        j--;
      } else {
        stack.push({ type: "removed", text: oldWords[i - 1] });
        i--;
      }
    }

    // Reverse (backtrack produces reverse order)
    stack.reverse();

    // Merge adjacent same-type segments
    for (const seg of stack) {
      if (segments.length > 0 && segments[segments.length - 1].type === seg.type) {
        segments[segments.length - 1].text += seg.text;
      } else {
        segments.push({ type: seg.type, text: seg.text });
      }
    }

    return segments;
  }

  function buildDiffView(original, suggestion) {
    const segments = wordDiff(original, suggestion);
    const container = el("div", { className: "tg-diff" });

    for (const seg of segments) {
      const span = document.createElement("span");
      span.textContent = seg.text;
      if (seg.type === "removed") {
        span.className = "tg-diff-removed";
      } else if (seg.type === "added") {
        span.className = "tg-diff-added";
      }
      container.appendChild(span);
    }

    return container;
  }

  // --- DOM Builder Helpers ---

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = v;
        else if (k === "style" && typeof v === "string") node.style.cssText = v;
        else if (k === "contentEditable") node.contentEditable = v;
        else if (k.startsWith("data-")) node.setAttribute(k, v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (const child of Array.isArray(children) ? children : [children]) {
        if (typeof child === "string") {
          node.appendChild(document.createTextNode(child));
        } else if (child) {
          node.appendChild(child);
        }
      }
    }
    return node;
  }

  // --- Build the drawer DOM tree ---

  function buildDrawer() {
    // Close button
    const closeBtn = el("button", { className: "tg-close", title: "Close" });
    closeBtn.appendChild(document.createTextNode("\u2715"));

    // Header
    const header = el("div", { className: "tg-header" }, [
      el("h2", { textContent: "ToneGuard" }),
      el("span", { className: "tg-badge", id: "tgBadge", textContent: "Suggestion" })
    ]);

    // Loading
    const loading = el("div", { className: "tg-loading", id: "tgLoading", style: "display:none" }, [
      el("div", { className: "tg-loading-dot" }),
      el("span", { textContent: "Reviewing your message..." })
    ]);

    // Confidence bar
    const confidenceBar = el("div", { className: "tg-confidence-bar" }, [
      el("div", { className: "tg-confidence-fill", id: "tgConfidenceFill" })
    ]);

    // Meta row (readability + categories)
    const metaRow = el("div", { className: "tg-meta-row", id: "tgMetaRow", style: "display:none" }, [
      el("span", { className: "tg-readability", id: "tgReadability" }),
      el("span", { className: "tg-categories", id: "tgCategories" })
    ]);

    // Red flags
    const redFlags = el("div", { className: "tg-red-flags", id: "tgRedFlags", style: "display:none" }, [
      el("div", { className: "tg-section-label", textContent: "Flagged phrases" }),
      el("div", { className: "tg-flags-list", id: "tgFlagsList" })
    ]);

    // Original message section (hidden when diff is shown)
    const originalSection = el("div", { className: "tg-section", id: "tgOriginalSection" }, [
      el("div", { className: "tg-section-label", textContent: "Your message" }),
      el("div", { className: "tg-message-box tg-original", id: "tgOriginal" })
    ]);

    // Diff section (shows inline changes — replaces original when active)
    const diffSection = el("div", { className: "tg-section", id: "tgDiffSection", style: "display:none" }, [
      el("div", { className: "tg-section-label", textContent: "Changes" })
    ]);

    // Questions section
    const submitAnswersBtn = el("button", {
      className: "tg-btn tg-btn-primary",
      id: "tgSubmitAnswers",
      textContent: "Refine with my answers"
    });
    const questionsSection = el("div", { id: "tgQuestionsSection", style: "display:none" }, [
      el("div", { className: "tg-section-label", textContent: "Help me improve this" }),
      el("div", { id: "tgQuestionsList" }),
      submitAnswersBtn
    ]);

    // Refining indicator
    const refining = el("div", { className: "tg-loading", id: "tgRefining", style: "display:none" }, [
      el("div", { className: "tg-loading-dot" }),
      el("span", { textContent: "Refining with your answers..." })
    ]);

    // Suggestion section
    const editHint = el("span", { className: "tg-edit-hint", textContent: "(click to edit)" });
    const suggestionLabel = el("div", { className: "tg-section-label", textContent: "Suggested rewrite " });
    suggestionLabel.appendChild(editHint);

    const suggestionBox = el("div", {
      className: "tg-message-box tg-suggestion",
      id: "tgSuggestion",
      contentEditable: "true"
    });

    const suggestionSection = el("div", { className: "tg-section" }, [
      suggestionLabel,
      suggestionBox
    ]);

    // Action buttons
    const useKbd = el("span", { className: "tg-kbd", textContent: "Enter" });
    const useSuggestionBtn = el("button", {
      className: "tg-btn tg-btn-primary",
      id: "tgUseSuggestion"
    });
    useSuggestionBtn.appendChild(document.createTextNode("Use suggestion "));
    useSuggestionBtn.appendChild(useKbd);

    const escKbd = el("span", { className: "tg-kbd", textContent: "Esc" });
    const sendOriginalBtn = el("button", {
      className: "tg-btn tg-btn-secondary",
      id: "tgSendOriginal"
    });
    sendOriginalBtn.appendChild(document.createTextNode("Send as-is "));
    sendOriginalBtn.appendChild(escKbd);

    const actions = el("div", { className: "tg-actions" }, [
      useSuggestionBtn,
      sendOriginalBtn
    ]);

    // Reasoning callout
    const reasoning = el("div", { className: "tg-reason", id: "tgReasoning" });

    // Content container
    const content = el("div", { id: "tgContent", style: "display:none" }, [
      reasoning,
      confidenceBar,
      metaRow,
      redFlags,
      diffSection,
      originalSection,
      questionsSection,
      refining,
      suggestionSection,
      actions
    ]);

    // Empty state
    const empty = el("div", { className: "tg-empty", id: "tgEmpty", style: "display:none" }, [
      el("p", { textContent: "ToneGuard is active. It'll appear here when it catches something." })
    ]);

    // Assemble drawer
    const drawer = el("div", { className: "tg-drawer" }, [
      closeBtn,
      header,
      loading,
      content,
      empty
    ]);

    // Backdrop
    const backdrop = el("div", { className: "tg-backdrop" });

    return { drawer, backdrop, closeBtn, useSuggestionBtn, sendOriginalBtn, suggestionBox, submitAnswersBtn };
  }

  // --- Create and mount ---

  function ensureHost() {
    if (host) return;

    host = document.createElement("div");
    host.id = "toneguard-overlay-host";
    shadow = host.attachShadow({ mode: "closed" });

    // Inject styles
    const style = document.createElement("style");
    style.textContent = getCSS();
    shadow.appendChild(style);

    // Build and append DOM
    const parts = buildDrawer();
    shadow.appendChild(parts.backdrop);
    shadow.appendChild(parts.drawer);

    document.body.appendChild(host);

    // Cache element references
    els = {
      drawer: parts.drawer,
      backdrop: parts.backdrop,
      loading: shadow.getElementById("tgLoading"),
      content: shadow.getElementById("tgContent"),
      empty: shadow.getElementById("tgEmpty"),
      originalSection: shadow.getElementById("tgOriginalSection"),
      diffSection: shadow.getElementById("tgDiffSection"),
      original: shadow.getElementById("tgOriginal"),
      suggestion: shadow.getElementById("tgSuggestion"),
      reasoning: shadow.getElementById("tgReasoning"),
      badge: shadow.getElementById("tgBadge"),
      confidenceFill: shadow.getElementById("tgConfidenceFill"),
      metaRow: shadow.getElementById("tgMetaRow"),
      readability: shadow.getElementById("tgReadability"),
      categories: shadow.getElementById("tgCategories"),
      redFlags: shadow.getElementById("tgRedFlags"),
      flagsList: shadow.getElementById("tgFlagsList"),
      questionsSection: shadow.getElementById("tgQuestionsSection"),
      questionsList: shadow.getElementById("tgQuestionsList"),
      refining: shadow.getElementById("tgRefining"),
      useSuggestionBtn: parts.useSuggestionBtn,
      sendOriginalBtn: parts.sendOriginalBtn
    };

    // Bind events
    parts.backdrop.addEventListener("click", () => handleSendOriginal());
    parts.closeBtn.addEventListener("click", () => handleSendOriginal());

    parts.useSuggestionBtn.addEventListener("click", () => {
      if (!currentResult) return;
      const finalText = els.suggestion.innerText.trim();
      const wasEdited = suggestionWasEdited;
      showUndoCountdown(finalText, wasEdited);
    });

    parts.sendOriginalBtn.addEventListener("click", () => handleSendOriginal());

    els.suggestion.addEventListener("input", () => {
      suggestionWasEdited = true;
      els.useSuggestionBtn.textContent = "Use edited version";
    });

    parts.submitAnswersBtn.addEventListener("click", submitAnswers);

    // Keyboard shortcuts
    parts.drawer.addEventListener("keydown", (e) => {
      if (!currentResult) return;
      // Don't capture when editing suggestion or typing in question inputs
      const active = shadow.activeElement;
      if (active === els.suggestion) return;
      if (active && active.classList.contains("tg-question-input")) return;

      if (e.key === "Enter") {
        e.preventDefault();
        els.useSuggestionBtn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleSendOriginal();
      }
    });

    // Make drawer focusable for keyboard events
    parts.drawer.setAttribute("tabindex", "-1");

    // Prevent all keyboard/mouse events from leaking to the host page (e.g. Slack)
    for (const evt of ["mousedown", "click", "keydown", "keypress", "keyup", "input"]) {
      parts.drawer.addEventListener(evt, (e) => e.stopPropagation());
    }
  }

  // --- Handlers ---

  function handleSendOriginal() {
    if (!currentResult) {
      hide();
      return;
    }

    logDecision({
      action: "sent_original",
      original: currentResult.original,
      suggestion: currentResult.suggestion,
      finalText: currentResult.original,
      reasoning: currentResult.reasoning,
      wasEdited: false
    });

    if (onDecision) {
      onDecision({ action: "send_original" });
    }
    showSent("Sent as-is.");
  }

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  async function submitAnswers() {
    if (!currentResult) return;

    if (!isContextValid()) {
      showStale();
      return;
    }

    const inputs = els.questionsList.querySelectorAll(".tg-question-input");
    const answers = [];
    for (const input of inputs) {
      const answer = input.value.trim();
      if (!answer) {
        input.style.borderColor = "#e53935";
        input.focus();
        return;
      }
      answers.push({ question: input.dataset.question, answer });
    }

    els.questionsSection.style.display = "none";
    els.refining.style.display = "flex";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "REFINE",
        original: currentResult.original,
        answers: answers
      });

      if (response && response.suggestion) {
        currentResult.suggestion = response.suggestion;
        currentResult.reasoning = "Refined with your answers";
        currentResult.has_questions = false;
        currentResult.questions = [];
        currentResult.refined = true;
        showResult(currentResult);
      }
    } catch (err) {
      console.error("ToneGuard refine error:", err);
      els.refining.style.display = "none";
      els.questionsSection.style.display = "block";
    }
  }

  // --- Public API ---

  function showLoading() {
    ensureHost();
    resetState();
    els.loading.style.display = "flex";
    els.content.style.display = "none";
    els.empty.style.display = "none";
    openDrawer();
  }

  function showResult(result) {
    ensureHost();
    currentResult = result;
    suggestionWasEdited = false;
    els.useSuggestionBtn.textContent = "Use suggestion";

    els.original.textContent = result.original;
    els.suggestion.textContent = result.suggestion;
    els.reasoning.textContent = result.reasoning;

    // Inline diff view — show changes instead of "Your message" when edits are small
    const existingDiff = els.diffSection.querySelector(".tg-diff");
    if (existingDiff) existingDiff.remove();

    if (result.original && result.suggestion && result.original !== result.suggestion) {
      const diffView = buildDiffView(result.original, result.suggestion);
      els.diffSection.appendChild(diffView);
      els.diffSection.style.display = "block";
      els.originalSection.style.display = "none";
    } else {
      els.diffSection.style.display = "none";
      els.originalSection.style.display = "block";
    }

    // Badge
    if (result.refined) {
      els.badge.textContent = "Refined";
      els.badge.className = "tg-badge tg-polish";
    } else if (result.mode === "polish") {
      els.badge.textContent = "Polish";
      els.badge.className = "tg-badge tg-polish";
    } else if (result.mode === "both") {
      els.badge.textContent = "Tone + Polish";
      els.badge.className = "tg-badge tg-both";
    } else {
      els.badge.textContent = "Tone";
      els.badge.className = "tg-badge";
    }

    // Confidence
    const conf = result.confidence || 0;
    els.confidenceFill.style.width = (conf * 100) + "%";
    els.confidenceFill.className = "tg-confidence-fill " +
      (conf >= 0.9 ? "tg-high" : conf >= 0.6 ? "tg-medium" : "tg-low");

    // Red flags
    els.flagsList.textContent = "";
    if (result.red_flags && result.red_flags.length > 0) {
      els.redFlags.style.display = "block";
      for (const flag of result.red_flags) {
        els.flagsList.appendChild(el("span", { className: "tg-flag-chip", textContent: flag }));
      }
    } else {
      els.redFlags.style.display = "none";
    }

    // Readability + categories
    if (result.readability || (result.categories && result.categories.length > 0)) {
      els.metaRow.style.display = "flex";
      if (result.readability) {
        const grade = result.readability;
        els.readability.textContent = "Grade " + grade;
        els.readability.className = "tg-readability " +
          (grade <= 9 ? "tg-good" : grade <= 12 ? "tg-medium" : "tg-hard");
        els.readability.style.display = "inline-block";
      } else {
        els.readability.style.display = "none";
      }
      els.categories.textContent = "";
      if (result.categories && result.categories.length > 0) {
        for (const cat of result.categories) {
          els.categories.appendChild(el("span", { className: "tg-category-chip", textContent: cat }));
        }
      }
    } else {
      els.metaRow.style.display = "none";
    }

    // Clarifying questions
    els.refining.style.display = "none";
    els.questionsList.textContent = "";
    if (result.has_questions && result.questions && result.questions.length > 0) {
      els.questionsSection.style.display = "block";
      for (const q of result.questions) {
        const item = el("div", { className: "tg-question-item" }, [
          el("div", { className: "tg-question-label", textContent: q })
        ]);
        const input = el("input", {
          type: "text",
          className: "tg-question-input",
          placeholder: "Your answer...",
          "data-question": q
        });
        // Prevent host page (e.g. Slack) from stealing focus/keystrokes
        for (const evt of ["mousedown", "click", "focus", "keydown", "keypress", "keyup", "input"]) {
          input.addEventListener(evt, (e) => e.stopPropagation());
        }
        item.appendChild(input);
        els.questionsList.appendChild(item);
      }
      setTimeout(() => {
        const firstInput = els.questionsList.querySelector(".tg-question-input");
        if (firstInput) firstInput.focus();
      }, 100);
    } else {
      els.questionsSection.style.display = "none";
    }

    els.loading.style.display = "none";
    els.empty.style.display = "none";
    els.content.style.display = "block";
    openDrawer();

    // Focus drawer for keyboard shortcuts
    els.drawer.focus();
  }

  function clearToast() {
    if (!els.drawer) return;
    const existing = els.drawer.querySelector(".tg-passed");
    if (existing) existing.remove();
  }

  function showPassed() {
    ensureHost();
    clearToast();
    els.loading.style.display = "none";
    els.content.style.display = "none";
    els.empty.style.display = "none";

    const passed = el("div", { className: "tg-passed", textContent: "Looks good! Message sent." });
    els.drawer.appendChild(passed);
    openDrawer();

    setTimeout(() => {
      passed.remove();
      hide();
    }, 2000);
  }

  function showStale() {
    ensureHost();
    clearToast();
    els.loading.style.display = "none";
    els.content.style.display = "none";
    els.empty.style.display = "none";

    const notice = el("div", { className: "tg-stale" });
    notice.appendChild(el("div", {
      className: "tg-stale-icon",
      textContent: "\u26A0"
    }));
    notice.appendChild(el("div", {
      className: "tg-stale-title",
      textContent: "ToneGuard was updated"
    }));
    notice.appendChild(el("div", {
      className: "tg-stale-msg",
      textContent: "Reload this tab to reconnect. Your message was sent as-is."
    }));
    const reloadBtn = el("button", {
      className: "tg-btn tg-btn-primary",
      textContent: "Reload tab"
    });
    reloadBtn.addEventListener("click", () => {
      location.reload();
    });
    notice.appendChild(reloadBtn);
    els.drawer.appendChild(notice);
    openDrawer();

    // Auto-close after 8 seconds
    setTimeout(() => {
      notice.remove();
      hide();
    }, 8000);
  }

  // Undo countdown: show "Sending in 3..." with an Undo button
  let undoTimer = null;
  let undoInterval = null;

  function showUndoCountdown(finalText, wasEdited) {
    const savedResult = { ...currentResult };
    els.content.style.display = "none";

    const toast = el("div", { className: "tg-undo-toast" });
    const countdownText = el("div", { className: "tg-undo-countdown", textContent: "Sending in 3..." });
    const undoBtn = el("button", {
      className: "tg-btn tg-btn-secondary",
      textContent: "Undo"
    });
    toast.appendChild(countdownText);
    toast.appendChild(undoBtn);
    els.drawer.appendChild(toast);

    let secondsLeft = 3;

    undoInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        countdownText.textContent = "Sending in " + secondsLeft + "...";
      }
    }, 1000);

    undoTimer = setTimeout(() => {
      clearInterval(undoInterval);
      toast.remove();

      logDecision({
        action: wasEdited ? "used_edited" : "used_suggestion",
        original: savedResult.original,
        suggestion: savedResult.suggestion,
        finalText: finalText,
        reasoning: savedResult.reasoning,
        wasEdited: wasEdited
      });

      if (onDecision) {
        onDecision({ action: "use_suggestion", suggestion: finalText });
      }
      showSent(wasEdited ? "Edited version sent!" : "Suggestion applied!");
    }, 3000);

    undoBtn.addEventListener("click", () => {
      clearTimeout(undoTimer);
      clearInterval(undoInterval);
      undoTimer = null;
      undoInterval = null;
      toast.remove();
      // Restore the result view
      showResult(savedResult);
    });
  }

  function showSent(message) {
    clearToast();
    els.content.style.display = "none";

    const sent = el("div", { className: "tg-passed", textContent: message });
    els.drawer.appendChild(sent);

    setTimeout(() => {
      sent.remove();
      hide(); // resetState() runs inside hide()
    }, 2000);
  }

  function openDrawer() {
    els.drawer.classList.add("tg-open");
    els.backdrop.classList.add("tg-open");
  }

  function hide() {
    if (!els.drawer) return;
    els.drawer.classList.remove("tg-open");
    els.backdrop.classList.remove("tg-open");
    resetState();
  }

  // --- Decision logging (same format as old panel.js) ---

  async function logDecision(decision) {
    // Skip storage write if extension context is stale — message already sent
    if (!isContextValid()) return;

    decision.timestamp = new Date().toISOString();
    decision.url = "";

    try {
      const { tg_decisions: existing } = await chrome.storage.local.get(["tg_decisions"]);
      const decisions = existing || [];
      decisions.push(decision);
      if (decisions.length > 100) {
        decisions.splice(0, decisions.length - 100);
      }
      await chrome.storage.local.set({ tg_decisions: decisions });

      const { tg_stats: stats } = await chrome.storage.local.get(["tg_stats"]);
      if (stats) {
        if (decision.action === "used_suggestion") stats.accepted++;
        else if (decision.action === "used_edited") stats.edited++;
        else if (decision.action === "sent_original") stats.dismissed++;
        await chrome.storage.local.set({ tg_stats: stats });
      }
    } catch (err) {
      console.warn("ToneGuard: failed to log decision", err);
    }
  }

  // --- CSS (embedded in shadow root) ---

  function getCSS() {
    return [
      ":host {",
      "  all: initial;",
      "  position: fixed;",
      "  top: 0; right: 0; bottom: 0;",
      "  z-index: 2147483647;",
      "  pointer-events: none;",
      "}",

      ".tg-backdrop {",
      "  position: fixed;",
      "  top: 0; left: 0; right: 0; bottom: 0;",
      "  background: rgba(0, 0, 0, 0.3);",
      "  opacity: 0;",
      "  pointer-events: none;",
      "  transition: opacity 0.2s ease;",
      "}",
      ".tg-backdrop.tg-open {",
      "  opacity: 1;",
      "  pointer-events: auto;",
      "}",

      ".tg-drawer {",
      "  position: fixed;",
      "  top: 0; right: -400px; bottom: 0;",
      "  width: 380px;",
      "  max-width: 90vw;",
      "  background: #fafafa;",
      "  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);",
      "  overflow-y: auto;",
      "  padding: 20px;",
      "  transition: right 0.25s ease;",
      "  pointer-events: auto;",
      "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "  font-size: 14px;",
      "  color: #1a1a1a;",
      "  line-height: 1.5;",
      "  box-sizing: border-box;",
      "  outline: none;",
      "}",
      ".tg-drawer.tg-open { right: 0; }",
      ".tg-drawer *, .tg-drawer *::before, .tg-drawer *::after {",
      "  box-sizing: border-box;",
      "  margin: 0;",
      "  padding: 0;",
      "}",

      ".tg-close {",
      "  position: absolute;",
      "  top: 16px; right: 16px;",
      "  background: none;",
      "  border: none;",
      "  font-size: 18px;",
      "  color: #999;",
      "  cursor: pointer;",
      "  padding: 4px;",
      "  line-height: 1;",
      "}",
      ".tg-close:hover { color: #333; }",

      ".tg-header {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 10px;",
      "  margin-bottom: 20px;",
      "}",
      ".tg-header h2 {",
      "  font-size: 18px;",
      "  font-weight: 600;",
      "  margin: 0;",
      "}",

      ".tg-badge {",
      "  font-size: 11px;",
      "  font-weight: 500;",
      "  padding: 2px 8px;",
      "  border-radius: 10px;",
      "  background: #FFF3E0;",
      "  color: #E65100;",
      "}",
      ".tg-badge.tg-polish { background: #E3F2FD; color: #1565C0; }",
      ".tg-badge.tg-both { background: #FFF3E0; color: #E65100; }",

      ".tg-confidence-bar {",
      "  height: 3px;",
      "  border-radius: 2px;",
      "  background: #e0e0e0;",
      "  margin-bottom: 16px;",
      "}",
      ".tg-confidence-fill {",
      "  height: 100%;",
      "  border-radius: 2px;",
      "  transition: width 0.3s;",
      "}",
      ".tg-confidence-fill.tg-low { background: #FFB300; }",
      ".tg-confidence-fill.tg-medium { background: #FF9800; }",
      ".tg-confidence-fill.tg-high { background: #e53935; }",

      ".tg-red-flags { margin-bottom: 12px; }",
      ".tg-flags-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }",
      ".tg-flag-chip {",
      "  display: inline-block;",
      "  padding: 3px 10px;",
      "  background: #FFEBEE;",
      "  color: #C62828;",
      "  border-radius: 12px;",
      "  font-size: 12px;",
      "  line-height: 1.4;",
      "}",

      ".tg-meta-row {",
      "  display: flex;",
      "  flex-wrap: wrap;",
      "  align-items: center;",
      "  gap: 6px;",
      "  margin-bottom: 12px;",
      "}",
      ".tg-readability {",
      "  font-size: 11px;",
      "  font-weight: 600;",
      "  padding: 2px 8px;",
      "  border-radius: 10px;",
      "}",
      ".tg-readability.tg-good { background: #E8F5E9; color: #2E7D32; }",
      ".tg-readability.tg-medium { background: #FFF3E0; color: #E65100; }",
      ".tg-readability.tg-hard { background: #FFEBEE; color: #C62828; }",

      ".tg-category-chip {",
      "  display: inline-block;",
      "  font-size: 10px;",
      "  padding: 1px 7px;",
      "  border-radius: 8px;",
      "  background: #F3E5F5;",
      "  color: #6A1B9A;",
      "}",

      ".tg-loading {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 10px;",
      "  padding: 20px 0;",
      "  color: #666;",
      "  font-size: 13px;",
      "}",
      ".tg-loading-dot {",
      "  width: 10px;",
      "  height: 10px;",
      "  border-radius: 50%;",
      "  background: #4CAF50;",
      "  animation: tg-pulse 1.5s ease-in-out infinite;",
      "}",
      "@keyframes tg-pulse {",
      "  0%, 100% { opacity: 1; transform: scale(1); }",
      "  50% { opacity: 0.5; transform: scale(0.8); }",
      "}",

      ".tg-reason {",
      "  background: #FFF8E1;",
      "  border-left: 3px solid #FFB300;",
      "  padding: 10px 12px;",
      "  border-radius: 0 6px 6px 0;",
      "  font-size: 13px;",
      "  color: #5D4037;",
      "  margin-bottom: 16px;",
      "  line-height: 1.4;",
      "}",

      ".tg-section { margin-bottom: 16px; }",
      ".tg-section-label {",
      "  font-size: 11px;",
      "  font-weight: 600;",
      "  text-transform: uppercase;",
      "  letter-spacing: 0.5px;",
      "  color: #999;",
      "  margin-bottom: 6px;",
      "}",

      ".tg-message-box {",
      "  padding: 12px;",
      "  border-radius: 8px;",
      "  font-size: 14px;",
      "  line-height: 1.5;",
      "  white-space: pre-wrap;",
      "  word-wrap: break-word;",
      "}",
      ".tg-message-box.tg-original {",
      "  background: #fff;",
      "  border: 1px solid #e0e0e0;",
      "  color: #666;",
      "}",
      ".tg-message-box.tg-suggestion {",
      "  background: #E8F5E9;",
      "  border: 1px solid #A5D6A7;",
      "  color: #1a1a1a;",
      "  cursor: text;",
      "  outline: none;",
      "  min-height: 60px;",
      "}",
      ".tg-message-box.tg-suggestion:focus {",
      "  border-color: #4CAF50;",
      "  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);",
      "}",

      ".tg-edit-hint {",
      "  font-weight: 400;",
      "  text-transform: none;",
      "  letter-spacing: 0;",
      "  color: #bbb;",
      "  font-size: 10px;",
      "}",

      ".tg-question-item { margin-bottom: 10px; }",
      ".tg-question-label {",
      "  font-size: 13px;",
      "  color: #333;",
      "  margin-bottom: 4px;",
      "  font-weight: 500;",
      "}",
      ".tg-question-input {",
      "  width: 100%;",
      "  padding: 8px 10px;",
      "  border: 1px solid #ddd;",
      "  border-radius: 6px;",
      "  font-family: inherit;",
      "  font-size: 13px;",
      "  line-height: 1.4;",
      "  background: #fff;",
      "  color: #1a1a1a;",
      "}",
      ".tg-question-input:focus {",
      "  outline: none;",
      "  border-color: #4CAF50;",
      "  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.15);",
      "}",

      "#tgQuestionsSection .tg-btn { margin-top: 8px; }",

      ".tg-actions {",
      "  display: flex;",
      "  gap: 10px;",
      "  margin-top: 20px;",
      "}",

      ".tg-btn {",
      "  flex: 1;",
      "  padding: 10px 16px;",
      "  border: none;",
      "  border-radius: 8px;",
      "  font-size: 14px;",
      "  font-weight: 500;",
      "  cursor: pointer;",
      "  transition: background 0.15s;",
      "  font-family: inherit;",
      "}",
      ".tg-btn-primary { background: #4CAF50; color: white; }",
      ".tg-btn-primary:hover { background: #43A047; }",
      ".tg-btn-secondary { background: #fff; color: #666; border: 1px solid #ddd; }",
      ".tg-btn-secondary:hover { background: #f5f5f5; }",

      ".tg-kbd {",
      "  display: inline-block;",
      "  font-size: 10px;",
      "  padding: 1px 5px;",
      "  border-radius: 3px;",
      "  background: rgba(255,255,255,0.2);",
      "  margin-left: 6px;",
      "  font-weight: 400;",
      "}",
      ".tg-btn-secondary .tg-kbd { background: rgba(0,0,0,0.06); }",

      ".tg-empty {",
      "  padding: 40px 0;",
      "  text-align: center;",
      "  color: #999;",
      "  font-size: 13px;",
      "  line-height: 1.5;",
      "}",

      ".tg-passed {",
      "  padding: 40px 0;",
      "  text-align: center;",
      "  color: #4CAF50;",
      "  font-size: 14px;",
      "}",

      ".tg-stale {",
      "  padding: 30px 0;",
      "  text-align: center;",
      "}",
      ".tg-stale-icon {",
      "  font-size: 28px;",
      "  margin-bottom: 8px;",
      "}",
      ".tg-stale-title {",
      "  font-size: 15px;",
      "  font-weight: 600;",
      "  color: #E65100;",
      "  margin-bottom: 6px;",
      "}",
      ".tg-stale-msg {",
      "  font-size: 13px;",
      "  color: #666;",
      "  margin-bottom: 16px;",
      "  line-height: 1.4;",
      "}",
      ".tg-stale .tg-btn {",
      "  flex: none;",
      "  width: auto;",
      "  padding: 8px 24px;",
      "}",

      "/* Diff view */",
      ".tg-diff {",
      "  padding: 12px;",
      "  border-radius: 8px;",
      "  font-size: 14px;",
      "  line-height: 1.6;",
      "  white-space: pre-wrap;",
      "  word-wrap: break-word;",
      "  background: #fff;",
      "  border: 1px solid #e0e0e0;",
      "}",
      ".tg-diff-removed {",
      "  text-decoration: line-through;",
      "  color: #C62828;",
      "  background: #FFEBEE;",
      "  border-radius: 2px;",
      "  padding: 0 2px;",
      "}",
      ".tg-diff-added {",
      "  color: #2E7D32;",
      "  background: #E8F5E9;",
      "  border-radius: 2px;",
      "  padding: 0 2px;",
      "}",

      "/* Undo countdown */",
      ".tg-undo-toast {",
      "  text-align: center;",
      "  padding: 30px 0;",
      "}",
      ".tg-undo-countdown {",
      "  font-size: 15px;",
      "  color: #666;",
      "  margin-bottom: 12px;",
      "}",
      ".tg-undo-toast .tg-btn {",
      "  flex: none;",
      "  width: auto;",
      "  padding: 8px 24px;",
      "}",

      "/* Dark mode */",
      "@media (prefers-color-scheme: dark) {",
      "  .tg-drawer { background: #1e1e1e; color: #e0e0e0; }",
      "  .tg-close { color: #777; }",
      "  .tg-close:hover { color: #ccc; }",
      "  .tg-badge { background: #3d2e1a; color: #FFB300; }",
      "  .tg-badge.tg-polish { background: #1a2e3d; color: #64B5F6; }",
      "  .tg-badge.tg-both { background: #3d2e1a; color: #FFB300; }",
      "  .tg-flag-chip { background: #3d1c1c; color: #EF9A9A; }",
      "  .tg-readability.tg-good { background: #1b3a1b; color: #81C784; }",
      "  .tg-readability.tg-medium { background: #3d2e1a; color: #FFB74D; }",
      "  .tg-readability.tg-hard { background: #3d1c1c; color: #EF9A9A; }",
      "  .tg-category-chip { background: #2d1a35; color: #CE93D8; }",
      "  .tg-reason { background: #3d3520; border-left-color: #FFB300; color: #D7CCC8; }",
      "  .tg-section-label { color: #777; }",
      "  .tg-message-box.tg-original { background: #2d2d2d; border-color: #404040; color: #999; }",
      "  .tg-message-box.tg-suggestion { background: #1b3a1b; border-color: #2d5f2d; color: #e0e0e0; }",
      "  .tg-message-box.tg-suggestion:focus { border-color: #4CAF50; box-shadow: 0 0 0 2px rgba(76,175,80,0.3); }",
      "  .tg-question-label { color: #ccc; }",
      "  .tg-question-input { background: #2d2d2d; border-color: #404040; color: #e0e0e0; }",
      "  .tg-question-input:focus { border-color: #4CAF50; }",
      "  .tg-btn-primary { background: #388E3C; }",
      "  .tg-btn-primary:hover { background: #2E7D32; }",
      "  .tg-btn-secondary { background: #2d2d2d; color: #999; border-color: #555; }",
      "  .tg-btn-secondary:hover { background: #333; }",
      "  .tg-kbd { background: rgba(255,255,255,0.1); }",
      "  .tg-btn-secondary .tg-kbd { background: rgba(255,255,255,0.08); }",
      "  .tg-loading { color: #999; }",
      "  .tg-empty { color: #777; }",
      "  .tg-edit-hint { color: #666; }",
      "  .tg-diff { background: #2d2d2d; border-color: #404040; }",
      "  .tg-diff-removed { background: #3d1c1c; color: #EF9A9A; }",
      "  .tg-diff-added { background: #1b3a1b; color: #81C784; }",
      "  .tg-undo-countdown { color: #999; }",
      "  .tg-stale-title { color: #FFB74D; }",
      "  .tg-stale-msg { color: #999; }",
      "  .tg-backdrop { background: rgba(0, 0, 0, 0.5); }",
      "}"
    ].join("\n");
  }
})();
