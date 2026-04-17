// ToneGuard overlay frame — runs INSIDE the extension iframe.
// All UI state, DOM event listeners, and chrome.* calls happen here.
// Communicates with the parent content script (overlay.js) via postMessage:
//
//   parent → frame:
//     { type: "show_loading" }
//     { type: "show_result", result }
//     { type: "show_passed" }
//     { type: "show_stale" }
//     { type: "hide" }
//     { type: "decision_ack", id, ok, error? }   // confirms the parent acted
//
//   frame → parent:
//     { type: "ready" }                                    // sent on load
//     { type: "size", open: bool }                         // ask parent to enable/disable pointer events
//     { type: "decision", id, decision: { action, suggestion? } }
//     { type: "replace_selection", text }                  // for context-menu selection mode
//
// ACK/NACK contract: every "decision" carries a unique id. The parent acts,
// then replies with "decision_ack" {id, ok, error?}. The iframe paints the
// success toast ONLY on ok:true; on ok:false (or timeout) it shows an error
// state so the user is never told success when the action silently failed.

(function () {
  "use strict";

  let currentResult = null;
  let suggestionWasEdited = false;
  let undoTimer = null;
  let undoInterval = null;

  // Pending decisions awaiting parent ack: id → { resolve, reject, timer }
  const pendingDecisions = new Map();
  let nextDecisionId = 0;
  const DECISION_ACK_TIMEOUT_MS = 5000;

  const els = {
    drawer: document.getElementById("tgDrawer"),
    backdrop: document.getElementById("tgBackdrop"),
    closeBtn: document.getElementById("tgClose"),
    loading: document.getElementById("tgLoading"),
    content: document.getElementById("tgContent"),
    empty: document.getElementById("tgEmpty"),
    originalSection: document.getElementById("tgOriginalSection"),
    diffSection: document.getElementById("tgDiffSection"),
    original: document.getElementById("tgOriginal"),
    suggestion: document.getElementById("tgSuggestion"),
    reasoning: document.getElementById("tgReasoning"),
    badge: document.getElementById("tgBadge"),
    confidenceFill: document.getElementById("tgConfidenceFill"),
    metaRow: document.getElementById("tgMetaRow"),
    readability: document.getElementById("tgReadability"),
    categories: document.getElementById("tgCategories"),
    redFlags: document.getElementById("tgRedFlags"),
    flagsList: document.getElementById("tgFlagsList"),
    questionsSection: document.getElementById("tgQuestionsSection"),
    questionsList: document.getElementById("tgQuestionsList"),
    submitAnswersBtn: document.getElementById("tgSubmitAnswers"),
    refining: document.getElementById("tgRefining"),
    useSuggestionBtn: document.getElementById("tgUseSuggestion"),
    sendOriginalBtn: document.getElementById("tgSendOriginal")
  };

  // --- postMessage helpers ---

  function sendToParent(msg) {
    window.parent.postMessage({ source: "toneguard-frame", ...msg }, "*");
  }

  // Send a decision to the parent and wait for its ack. Resolves on ok:true,
  // rejects on ok:false or timeout. Callers paint success only on resolve.
  function notifyDecision(decision) {
    const id = ++nextDecisionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingDecisions.has(id)) {
          pendingDecisions.delete(id);
          reject(new Error("decision_ack timeout"));
        }
      }, DECISION_ACK_TIMEOUT_MS);
      pendingDecisions.set(id, { resolve, reject, timer });
      sendToParent({ type: "decision", id, decision });
    });
  }

  function handleDecisionAck(msg) {
    const pending = pendingDecisions.get(msg.id);
    if (!pending) return; // stale ack (already timed out) — ignore
    clearTimeout(pending.timer);
    pendingDecisions.delete(msg.id);
    if (msg.ok) pending.resolve();
    else pending.reject(new Error(msg.error || "action failed"));
  }

  // --- DOM helpers ---

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = v;
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

  // --- Word-level diff ---

  function wordDiff(oldText, newText) {
    const oldWords = oldText.split(/(\s+)/);
    const newWords = newText.split(/(\s+)/);
    const m = oldWords.length;
    const n = newWords.length;

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

    const stack = [];
    let i = m, j = n;
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
    stack.reverse();

    const segments = [];
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
      if (seg.type === "removed") span.className = "tg-diff-removed";
      else if (seg.type === "added") span.className = "tg-diff-added";
      container.appendChild(span);
    }
    return container;
  }

  // --- State ---

  function resetState() {
    currentResult = null;
    suggestionWasEdited = false;
    els.original.textContent = "";
    els.suggestion.textContent = "";
    els.reasoning.textContent = "";
    els.flagsList.textContent = "";
    els.categories.textContent = "";
    els.questionsList.textContent = "";
    els.useSuggestionBtn.textContent = "Use suggestion ";
    els.useSuggestionBtn.appendChild(el("span", { className: "tg-kbd", textContent: "Enter" }));
    els.sendOriginalBtn.textContent = "Send as-is ";
    els.sendOriginalBtn.appendChild(el("span", { className: "tg-kbd", textContent: "Esc" }));
    els.useSuggestionBtn.onclick = null;
    els.sendOriginalBtn.onclick = null;
    const oldReplace = els.drawer.querySelector(".tg-replace-btn");
    if (oldReplace) oldReplace.remove();
    const diffEl = els.drawer.querySelector(".tg-diff");
    if (diffEl) diffEl.remove();
    clearToast();
  }

  function clearToast() {
    const passed = els.drawer.querySelector(".tg-passed");
    if (passed) passed.remove();
    const stale = els.drawer.querySelector(".tg-stale");
    if (stale) stale.remove();
    const undo = els.drawer.querySelector(".tg-undo-toast");
    if (undo) undo.remove();
  }

  function openDrawer() {
    els.drawer.classList.add("tg-open");
    els.backdrop.classList.add("tg-open");
    sendToParent({ type: "size", open: true });
    // Focus drawer for keyboard shortcuts
    setTimeout(() => els.drawer.focus(), 0);
  }

  function closeDrawer() {
    els.drawer.classList.remove("tg-open");
    els.backdrop.classList.remove("tg-open");
    sendToParent({ type: "size", open: false });
  }

  function hide() {
    closeDrawer();
    resetState();
  }

  // --- Public state methods (called via postMessage from parent) ---

  function showLoading() {
    resetState();
    els.loading.style.display = "flex";
    els.content.style.display = "none";
    els.empty.style.display = "none";
    openDrawer();
  }

  function showResult(result) {
    currentResult = result;
    suggestionWasEdited = false;

    // Reset overrides from any prior selection-mode render
    els.useSuggestionBtn.onclick = null;
    els.sendOriginalBtn.onclick = null;
    const oldReplace = els.drawer.querySelector(".tg-replace-btn");
    if (oldReplace) oldReplace.remove();

    // Selection mode (context menu): Copy / Replace / Dismiss
    if (result.selectionMode) {
      els.useSuggestionBtn.textContent = "Copy rewrite";
      els.sendOriginalBtn.textContent = "Dismiss";

      els.useSuggestionBtn.onclick = () => {
        const text = els.suggestion.textContent || result.suggestion;
        navigator.clipboard.writeText(text).catch(() => {});
        els.useSuggestionBtn.textContent = "Copied!";
        setTimeout(() => hide(), 1000);
      };
      els.sendOriginalBtn.onclick = () => hide();

      if (result.editable && result.suggestion) {
        const replaceBtn = el("button", {
          className: "tg-btn tg-replace-btn",
          textContent: "Replace selection",
          type: "button"
        });
        replaceBtn.addEventListener("click", () => {
          sendToParent({ type: "replace_selection", text: result.suggestion });
          hide();
        });
        els.useSuggestionBtn.parentElement.insertBefore(replaceBtn, els.sendOriginalBtn);
      }
    } else {
      els.useSuggestionBtn.textContent = "Use suggestion ";
      els.useSuggestionBtn.appendChild(el("span", { className: "tg-kbd", textContent: "Enter" }));
      els.sendOriginalBtn.textContent = "Send as-is ";
      els.sendOriginalBtn.appendChild(el("span", { className: "tg-kbd", textContent: "Esc" }));
    }

    els.original.textContent = result.original;
    els.suggestion.textContent = result.suggestion;
    els.reasoning.textContent = result.reasoning;

    // Inline diff view
    const existingDiff = els.diffSection.querySelector(".tg-diff");
    if (existingDiff) existingDiff.remove();
    if (result.original && result.suggestion && result.original !== result.suggestion) {
      els.diffSection.appendChild(buildDiffView(result.original, result.suggestion));
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
  }

  function showPassed() {
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
    clearToast();
    els.loading.style.display = "none";
    els.content.style.display = "none";
    els.empty.style.display = "none";

    const notice = el("div", { className: "tg-stale" });
    notice.appendChild(el("div", { className: "tg-stale-icon", textContent: "\u26A0" }));
    notice.appendChild(el("div", { className: "tg-stale-title", textContent: "ToneGuard was updated" }));
    notice.appendChild(el("div", {
      className: "tg-stale-msg",
      textContent: "Reload this tab to reconnect. Your message was not sent."
    }));
    const reloadBtn = el("button", {
      className: "tg-btn tg-btn-primary",
      textContent: "Reload tab",
      type: "button"
    });
    reloadBtn.addEventListener("click", () => {
      sendToParent({ type: "reload_tab" });
    });
    notice.appendChild(reloadBtn);
    els.drawer.appendChild(notice);
    openDrawer();

    setTimeout(() => {
      notice.remove();
      hide();
    }, 8000);
  }

  // --- Action handlers ---

  async function handleSendOriginal() {
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
    try {
      await notifyDecision({ action: "send_original" });
      showSent("Sent as-is.");
    } catch (err) {
      showActionError("Couldn't send — try again from your compose window.", err);
    }
  }

  function showUndoCountdown(finalText, wasEdited) {
    const savedResult = { ...currentResult };
    els.content.style.display = "none";

    const toast = el("div", { className: "tg-undo-toast" });
    const countdownText = el("div", { className: "tg-undo-countdown", textContent: "Sending in 3..." });
    const undoBtn = el("button", {
      className: "tg-btn tg-btn-secondary",
      textContent: "Undo",
      type: "button"
    });
    toast.appendChild(countdownText);
    toast.appendChild(undoBtn);
    els.drawer.appendChild(toast);

    let secondsLeft = 3;
    undoInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) countdownText.textContent = "Sending in " + secondsLeft + "...";
    }, 1000);

    undoTimer = setTimeout(async () => {
      clearInterval(undoInterval);
      toast.remove();
      logDecision({
        action: wasEdited ? "used_edited" : "used_suggestion",
        original: savedResult.original,
        suggestion: savedResult.suggestion,
        finalText,
        reasoning: savedResult.reasoning,
        wasEdited
      });
      try {
        await notifyDecision({ action: "use_suggestion", suggestion: finalText });
        showSent(wasEdited ? "Edited version sent!" : "Suggestion applied!");
      } catch (err) {
        // Parent couldn't insert/send — tell the user the truth so they can
        // paste the rewrite manually. Preserve it on the clipboard as a last-
        // ditch affordance.
        try { navigator.clipboard.writeText(finalText); } catch (_) { /* ignore */ }
        showActionError("Couldn't apply the rewrite — it's on your clipboard. Paste and send manually.", err);
      }
    }, 3000);

    undoBtn.addEventListener("click", () => {
      clearTimeout(undoTimer);
      clearInterval(undoInterval);
      undoTimer = null;
      undoInterval = null;
      toast.remove();
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
      hide();
    }, 2000);
  }

  function showActionError(message, err) {
    // Distinct from showSent: warn-styled, longer visible, preserves a close
    // action. Logged to console so it's not silent during dev.
    if (err) console.warn("ToneGuard:", err && err.message ? err.message : err);
    clearToast();
    els.content.style.display = "none";
    const warn = el("div", { className: "tg-stale-notice" });
    warn.appendChild(el("div", { className: "tg-stale-icon", textContent: "\u26A0" }));
    warn.appendChild(el("div", { className: "tg-stale-title", textContent: "Couldn't finish that action" }));
    warn.appendChild(el("div", { className: "tg-stale-msg", textContent: message }));
    const closeBtn = el("button", {
      className: "tg-btn tg-btn-primary",
      textContent: "Close",
      type: "button"
    });
    closeBtn.addEventListener("click", () => {
      warn.remove();
      hide();
    });
    warn.appendChild(closeBtn);
    els.drawer.appendChild(warn);
    openDrawer();
    setTimeout(() => { if (warn.isConnected) { warn.remove(); hide(); } }, 8000);
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
        answers
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

  // --- Decision logging ---

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  async function logDecision(decision) {
    if (!isContextValid()) return;
    decision.timestamp = new Date().toISOString();
    decision.url = "";
    try {
      const { tg_decisions: existing } = await chrome.storage.local.get(["tg_decisions"]);
      const decisions = existing || [];
      decisions.push(decision);
      if (decisions.length > 100) decisions.splice(0, decisions.length - 100);
      await chrome.storage.local.set({ tg_decisions: decisions });

      chrome.runtime.sendMessage({ type: "SYNC_PUSH", dataType: "decisions" }).catch(() => {});

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

  // --- Event bindings ---

  els.closeBtn.addEventListener("click", () => handleSendOriginal());
  els.backdrop.addEventListener("click", () => handleSendOriginal());

  els.useSuggestionBtn.addEventListener("click", () => {
    // Skip if a selection-mode override is bound
    if (els.useSuggestionBtn.onclick) return;
    if (!currentResult) return;
    const finalText = els.suggestion.innerText.trim();
    showUndoCountdown(finalText, suggestionWasEdited);
  });

  els.sendOriginalBtn.addEventListener("click", () => {
    if (els.sendOriginalBtn.onclick) return;
    handleSendOriginal();
  });

  els.suggestion.addEventListener("input", () => {
    suggestionWasEdited = true;
    // Preserve the kbd hint by rebuilding text
    els.useSuggestionBtn.textContent = "Use edited version";
  });

  els.submitAnswersBtn.addEventListener("click", submitAnswers);

  // Keyboard shortcuts (drawer-level, ignoring text inputs)
  els.drawer.addEventListener("keydown", (e) => {
    if (!currentResult) return;
    const active = document.activeElement;
    if (active === els.suggestion) return;
    if (active && active.classList && active.classList.contains("tg-question-input")) return;

    if (e.key === "Enter") {
      e.preventDefault();
      els.useSuggestionBtn.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleSendOriginal();
    }
  });

  // --- Parent message handler ---

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.source !== "toneguard-content") return;
    switch (msg.type) {
      case "show_loading":  showLoading(); break;
      case "show_result":   showResult(msg.result); break;
      case "show_passed":   showPassed(); break;
      case "show_stale":    showStale(); break;
      case "hide":          hide(); break;
      case "decision_ack":  handleDecisionAck(msg); break;
    }
  });

  // Tell parent we're ready to receive state
  sendToParent({ type: "ready" });
})();
