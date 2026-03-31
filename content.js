// ToneGuard Content Script
// Intercepts send actions on supported sites, checks tone before sending.
// Supports Slack, Gmail, LinkedIn, TurboTenant, and user-added custom sites.

(function () {
  "use strict";

  // State
  let releasing = false;
  let pendingText = null;
  let pendingEditor = null;
  let currentPlatform = null;

  // Detect which platform we're on
  function detectPlatform() {
    const host = location.hostname;
    if (host.includes("slack")) return "slack";
    if (host.includes("mail.google")) return "gmail";
    if (host.includes("linkedin")) return "linkedin";
    if (host.includes("turbotenant")) return "turbotenant";
    return "generic";
  }

  const SITE = detectPlatform();

  // Platform-specific selectors and behaviors
  const PLATFORMS = {
    slack: {
      editorSelector: '[data-qa="message_input"] .ql-editor, [role="textbox"][data-qa="message_input"], .ql-editor',
      sendBtnSelector: '[data-qa="texty_send_button"], [aria-label="Send message"]',
      sendKey: "Enter",
      sendModifier: null, // plain Enter sends

      getEditorText(el) { return el.innerText.trim(); },

      replaceEditorText(el, text) {
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      },

      releaseSend(el) {
        releasing = true;
        el.focus();
        el.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        }));
        setTimeout(() => { releasing = false; }, 300);
      }
    },

    gmail: {
      editorSelector: 'div[role="textbox"][aria-label*="Body"], div.Am.Al.editable, div[aria-label*="Message Body"]',
      sendBtnSelector: 'div[aria-label*="Send"][role="button"], div.T-I.J-J5-Ji.aoO',
      sendKey: null, // button-click based
      sendModifier: null,

      getEditorText(el) { return el.innerText.trim(); },

      replaceEditorText(el, text) {
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      },

      releaseSend(_el) {
        releasing = true;
        const btn = document.querySelector(this.sendBtnSelector);
        if (btn) btn.click();
        setTimeout(() => { releasing = false; }, 300);
      }
    },

    linkedin: {
      editorSelector: '.msg-form__contenteditable, div[role="textbox"][contenteditable="true"], .ql-editor',
      sendBtnSelector: '.msg-form__send-button, button[type="submit"].msg-form__send-btn, button.msg-form__send-button',
      sendKey: "Enter",
      sendModifier: null,

      getEditorText(el) { return el.innerText.trim(); },

      replaceEditorText(el, text) {
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      },

      releaseSend(_el) {
        releasing = true;
        const btn = document.querySelector(this.sendBtnSelector);
        if (btn) btn.click();
        setTimeout(() => { releasing = false; }, 300);
      }
    },

    turbotenant: {
      editorSelector: 'textarea, div[contenteditable="true"], [role="textbox"]',
      sendBtnSelector: 'button[type="submit"], input[type="submit"], button:has(.send), button[aria-label*="Send"]',
      sendKey: null,
      sendModifier: null,

      getEditorText(el) {
        return el.value !== undefined ? el.value.trim() : el.innerText.trim();
      },

      replaceEditorText(el, text) {
        if (el.value !== undefined) {
          el.value = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          el.focus();
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, text);
        }
      },

      releaseSend(_el) {
        releasing = true;
        const btn = document.querySelector(this.sendBtnSelector);
        if (btn) btn.click();
        setTimeout(() => { releasing = false; }, 300);
      }
    },

    // Generic fallback for user-added sites
    generic: {
      editorSelector: 'textarea, div[contenteditable="true"], [role="textbox"]',
      sendBtnSelector: 'button[type="submit"], input[type="submit"]',
      sendKey: null,
      sendModifier: null,

      getEditorText(el) {
        return el.value !== undefined ? el.value.trim() : el.innerText.trim();
      },

      replaceEditorText(el, text) {
        if (el.value !== undefined) {
          el.value = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          el.focus();
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, text);
        }
      },

      releaseSend(_el) {
        releasing = true;
        const btn = document.querySelector(this.sendBtnSelector);
        if (btn) btn.click();
        setTimeout(() => { releasing = false; }, 300);
      }
    }
  };

  currentPlatform = PLATFORMS[SITE] || PLATFORMS.generic;

  // Unified send button click handler
  function handleSendBtnClick(e) {
    if (releasing) return;

    // Find the nearest editor
    const editor = findNearestEditor(e.target);
    if (!editor) return;

    const text = currentPlatform.getEditorText(editor);
    if (!text || text.length < 10) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    // Open panel synchronously during user gesture
    chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
    analyzeAndIntercept(text, editor);
  }

  // Unified keydown handler
  function handleKeydown(e) {
    if (releasing) return;

    // Slack + LinkedIn: Enter sends
    if (SITE === "slack" || SITE === "linkedin") {
      if (e.key !== "Enter" || e.shiftKey) return;
    }
    // Gmail: Ctrl/Cmd+Enter sends
    else if (SITE === "gmail") {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    }
    // Generic: don't intercept keyboard sends (just buttons)
    else {
      return;
    }

    const editor = e.target.closest(currentPlatform.editorSelector) || e.target;
    const text = currentPlatform.getEditorText(editor);
    if (!text || text.length < 10) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    // Open panel synchronously during user gesture
    chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
    analyzeAndIntercept(text, editor);
  }

  // Scrape recent conversation messages for context (Slack only)
  function getConversationContext() {
    if (SITE !== "slack") return "";

    try {
      // Slack messages live in elements with role="listitem" or data-qa="message_container"
      const messageEls = document.querySelectorAll(
        '[data-qa="message_container"], [role="listitem"] .c-message_kit__text, .p-rich_text_section'
      );

      if (!messageEls.length) return "";

      // Grab the last 5 messages
      const messages = [];
      const els = Array.from(messageEls).slice(-5);

      for (const el of els) {
        const text = el.innerText?.trim();
        if (text && text.length > 0) {
          messages.push(text);
        }
      }

      if (messages.length === 0) return "";

      return "RECENT CONVERSATION (for context only):\n" +
        messages.map((m, i) => `[${i + 1}] ${m}`).join("\n");

    } catch (_) {
      return ""; // fail silently
    }
  }

  // Find the editor element near a send button
  function findNearestEditor(sendBtn) {
    // Walk up to find a common parent, then look for the editor
    let parent = sendBtn.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      const editor = parent.querySelector(currentPlatform.editorSelector);
      if (editor) return editor;
      parent = parent.parentElement;
    }
    // Fallback: just find any editor on the page
    return document.querySelector(currentPlatform.editorSelector);
  }

  // Core: send text for analysis
  async function analyzeAndIntercept(text, editor) {
    pendingText = text;
    pendingEditor = editor;

    // Panel was already opened by the synchronous event handler
    showCheckingIndicator();

    try {
      const context = getConversationContext();
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE",
        text: text,
        context: context
      });

      hideCheckingIndicator();

      if (result.error) {
        console.warn("ToneGuard:", result.error);
        currentPlatform.releaseSend(editor);
        return;
      }

      if (!result.flagged) {
        // Tell the panel everything is fine
        await chrome.storage.session.set({ tg_latest_result: { passed: true } });
        currentPlatform.releaseSend(editor);
        return;
      }

      // Flagged. Panel is already open and will pick up the result
      // via storage.session listener. We wait for PANEL_DECISION message.

    } catch (err) {
      console.error("ToneGuard error:", err);
      hideCheckingIndicator();
      currentPlatform.releaseSend(editor);
    }
  }

  // Listen for panel decisions
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "PANEL_DECISION") return;
    if (!pendingEditor) return;

    if (message.action === "use_suggestion" && message.suggestion) {
      currentPlatform.replaceEditorText(pendingEditor, message.suggestion);
    }

    currentPlatform.releaseSend(pendingEditor);
    pendingText = null;
    pendingEditor = null;
  });

  // Visual indicator
  let indicatorEl = null;

  function showCheckingIndicator() {
    if (indicatorEl) return;

    indicatorEl = document.createElement("div");
    indicatorEl.textContent = "Checking tone...";
    indicatorEl.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      z-index: 999999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: tg-pulse 1.5s ease-in-out infinite;
    `;

    const style = document.createElement("style");
    style.id = "tg-style";
    style.textContent = `
      @keyframes tg-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
    `;
    if (!document.getElementById("tg-style")) {
      document.head.appendChild(style);
    }
    document.body.appendChild(indicatorEl);
  }

  function hideCheckingIndicator() {
    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
  }

  // Draft mode: inject a "Review" button near editors
  function injectReviewButton(editor) {
    if (editor._tgReviewBtn) return;

    const btn = document.createElement("button");
    btn.textContent = "Review";
    btn.title = "Check tone and clarity with ToneGuard";
    btn.style.cssText = `
      position: absolute;
      bottom: 4px;
      right: 60px;
      background: #4CAF50;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      z-index: 999;
      opacity: 0.7;
      transition: opacity 0.15s;
    `;
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.7"; });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const text = currentPlatform.getEditorText(editor);
      if (!text || text.length < 10) return;

      // Open panel during gesture
      chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
      // Run analysis but don't hold the send — draft mode is advisory
      draftReview(text, editor);
    });

    // Make editor's parent position:relative so the button positions correctly
    const parent = editor.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    (parent || editor).appendChild(btn);
    editor._tgReviewBtn = btn;
  }

  // Draft review: check without intercepting send
  async function draftReview(text, editor) {
    showCheckingIndicator();

    try {
      const context = getConversationContext();
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE",
        text: text,
        context: context
      });

      hideCheckingIndicator();

      if (result.error) {
        console.warn("ToneGuard:", result.error);
        return;
      }

      if (!result.flagged) {
        await chrome.storage.session.set({ tg_latest_result: { passed: true } });
      }
      // If flagged, the service worker already stored the result and panel will show it

    } catch (err) {
      console.error("ToneGuard draft review error:", err);
      hideCheckingIndicator();
    }
  }

  // Initialize
  function init() {
    // Attach keyboard listener (for Slack, LinkedIn, Gmail)
    document.addEventListener("keydown", handleKeydown, true);

    // Watch for send buttons and editors appearing (SPAs render dynamically)
    const observer = new MutationObserver(() => {
      const btns = document.querySelectorAll(currentPlatform.sendBtnSelector);
      btns.forEach((btn) => {
        if (!btn._tgBound) {
          btn._tgBound = true;
          btn.addEventListener("click", handleSendBtnClick, true);
        }
      });

      // Inject review buttons on editors
      const editors = document.querySelectorAll(currentPlatform.editorSelector);
      editors.forEach((editor) => injectReviewButton(editor));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Bind any already-visible send buttons
    document.querySelectorAll(currentPlatform.sendBtnSelector).forEach((btn) => {
      btn._tgBound = true;
      btn.addEventListener("click", handleSendBtnClick, true);
    });

    // Inject review buttons on any visible editors
    document.querySelectorAll(currentPlatform.editorSelector).forEach((editor) => {
      injectReviewButton(editor);
    });
  }

  // Gmail's DOM isn't ready when content script loads via document_idle.
  // Wait for window.onload to ensure compose elements are available.
  if (SITE === "gmail") {
    if (document.readyState === "complete") {
      init();
    } else {
      window.addEventListener("load", init);
    }
  } else {
    init();
  }
})();
