// ToneGuard Content Script
// Intercepts send actions on supported sites, checks tone before sending.
// Supports Slack, Gmail, LinkedIn, TurboTenant, and user-added custom sites.
// Uses the in-page overlay (overlay.js) instead of Chrome Side Panel.

(function () {
  "use strict";

  // Step 8: Guard against double-injection
  if (window.__toneGuardActive) return;
  window.__toneGuardActive = true;

  // State
  let releasing = false;
  let pendingText = null;
  let pendingEditor = null;
  let currentPlatform = null;

  // Format a result.error for human-readable logging. The service worker now
  // returns structured error objects ({type, message, retryable,
  // diagnostic_code}); a bare console.warn("ToneGuard:", obj) stringifies as
  // "[object Object]" in chrome://extensions, which hides the actual cause.
  function formatErrorForLog(err) {
    if (err == null) return "(null error)";
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      const type = err.type || err.name || "error";
      const msg = err.message || err.error || "";
      const code = err.diagnostic_code ? ` [${err.diagnostic_code}]` : "";
      try {
        return `${type}${code}: ${msg || JSON.stringify(err)}`;
      } catch (_) {
        return `${type}${code}: <unserializable>`;
      }
    }
    return String(err);
  }

  // Detect if the extension context was invalidated (extension reloaded
  // without reloading this tab). chrome.runtime.id becomes undefined.
  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  // Detect which platform we're on (Step 8: exact domain matching)
  function detectPlatform() {
    const host = location.hostname;
    if (host === "app.slack.com") return "slack";
    if (host === "mail.google.com") return "gmail";
    if (host === "www.linkedin.com") return "linkedin";
    if (host.endsWith(".turbotenant.com") || host === "turbotenant.com") return "turbotenant";
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
        if (!el) {
          console.warn("[ToneGuard:diag] slack.replaceEditorText: no editor element (detached?)");
          return;
        }
        el.focus();

        // Strategy 1: execCommand (works in some browsers/editors)
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);

        // Verify it worked — if not, fall back to direct DOM manipulation
        if (el.innerText.trim() !== text.trim()) {
          // Strategy 2: clear and rebuild the editor content directly
          while (el.firstChild) el.removeChild(el.firstChild);
          // Slack's Quill editor expects <p> elements
          const lines = text.split("\n");
          for (const line of lines) {
            const p = document.createElement("p");
            p.textContent = line || "\u200B"; // zero-width space for empty lines
            el.appendChild(p);
          }
          // Notify the editor framework of the change
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },

      releaseSend(el) {
        if (!el) {
          console.warn("[ToneGuard:diag] slack.releaseSend: no editor element (detached?) — cannot auto-release send");
          return;
        }
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

  // Set up overlay decision callback.
  //
  // Returns { ok: bool, error?: string }. overlay.js forwards this as the
  // decision_ack back to the iframe so the iframe paints success only when
  // the action actually succeeded.
  function setupOverlay() {
    if (!window.__toneGuard) return;
    window.__toneGuard.setOnDecision((decision) => {
      console.log("[ToneGuard:diag] decision arrived", decision.action,
        "pendingEditor:", !!pendingEditor,
        "connected:", pendingEditor?.isConnected);

      // Cancel always succeeds: it just clears the concurrency guard and
      // leaves the editor untouched so the user can keep editing. Handle
      // before the pendingEditor checks so a stale-state cancel still acks
      // ok (the user just wants out of the drawer).
      if (decision.action === "cancel") {
        pendingText = null;
        pendingEditor = null;
        return { ok: true };
      }

      if (decision.action === "retry") {
        const editor = pendingEditor;
        pendingText = null;
        pendingEditor = null;
        if (editor && editor.isConnected) {
          // Read the live text from the editor — pendingText was already cleared
          // above and passing the DOM node directly (the prior bug) produced
          // "text:object(undefined)" in the ANALYZE payload and a
          // "Could not serialize message" rejection.
          const retryText = currentPlatform.getEditorText(editor) || "";
          if (!retryText) {
            return { ok: false, error: "editor is empty; nothing to retry" };
          }
          setTimeout(() => analyzeAndIntercept(retryText, editor), 0);
          return { ok: true };
        }
        return { ok: false, error: "no pending compose to retry" };
      }

      if (!pendingEditor) {
        console.warn("[ToneGuard:diag] decision rejected: pendingEditor was null", decision.action);
        return { ok: false, error: "no pending compose" };
      }
      if (!pendingEditor.isConnected) {
        // Editor was detached (Gmail re-rendered the compose). releaseSend
        // might still hit a live Send button, but we can't insert the
        // rewrite safely — fail loud.
        pendingText = null;
        pendingEditor = null;
        return { ok: false, error: "compose editor was detached from the page" };
      }

      try {
        if (decision.action === "use_suggestion" && decision.suggestion) {
          const lib = globalThis.__toneGuardLib;
          if (!lib || typeof lib.verifyInsertedText !== "function") {
            // lib.js is shipped in every content-script injection path
            // (manifest content_scripts + service-worker's executeScript
            // and registerContentScripts calls). Missing it means a build
            // or load-order bug — nack honestly instead of silently
            // falling back to strict-equality and reintroducing the
            // false-negative paste-fallback bug we fixed in 0.3.1.
            console.warn("[ToneGuard:diag] lib.verifyInsertedText missing; aborting insert");
            pendingText = null;
            pendingEditor = null;
            return { ok: false, error: "verification helper missing" };
          }
          const before = currentPlatform.getEditorText(pendingEditor) || "";
          const activeBefore = document.activeElement;
          console.log("[ToneGuard:diag] replaceEditorText about to run",
            "site:", SITE,
            "editorIsActive:", pendingEditor === activeBefore,
            "activeTag:", activeBefore?.tagName,
            "activeId:", activeBefore?.id,
            "beforeLen:", before.length);
          currentPlatform.replaceEditorText(pendingEditor, decision.suggestion);
          // Verify the insert actually landed — execCommand can silently
          // no-op if focus transfer failed. Normalize the comparison so
          // editor-specific whitespace quirks (Gmail signature appended
          // below the body, Slack Quill's zero-width-space padding,
          // NBSP/CRLF normalization) don't produce false negatives.
          const after = currentPlatform.getEditorText(pendingEditor) || "";
          console.log("[ToneGuard:diag] replaceEditorText completed",
            "afterLen:", after.length,
            "expectedLen:", decision.suggestion.length,
            "afterMatches:", after.trim() === decision.suggestion.trim(),
            "editorStillActive:", pendingEditor === document.activeElement);
          if (!lib.verifyInsertedText(before, after, decision.suggestion)) {
            // Must clear state before returning — otherwise the pendingEditor
            // concurrency guard in analyzeAndIntercept blocks every future
            // send until the tab is reloaded.
            pendingText = null;
            pendingEditor = null;
            return { ok: false, error: "editor did not accept the rewrite" };
          }
        }

        currentPlatform.releaseSend(pendingEditor);
        pendingText = null;
        pendingEditor = null;
        return { ok: true };
      } catch (err) {
        pendingText = null;
        pendingEditor = null;
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    });
  }

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
    analyzeAndIntercept(text, editor);
  }

  // Check if the event originates from inside the ToneGuard overlay.
  // The overlay is now an extension iframe; events inside it don't normally
  // propagate to the parent document at all, but we still guard in case any
  // residual event targets the iframe element itself (focus/blur on the
  // iframe wrapper, etc.).
  function isFromOverlay(e) {
    const frame = document.getElementById("toneguard-overlay-frame");
    if (!frame) return false;
    if (e.target === frame) return true;
    if (e.composedPath) {
      const path = e.composedPath();
      for (const node of path) {
        if (node === frame) return true;
      }
    }
    return false;
  }

  // Check if Slack's autocomplete/mention picker is open.
  //
  // Primary signal: the ARIA combobox pattern. When Slack's composer opens
  // any autocomplete popup (@mentions, #channels, :emoji:, /slash commands),
  // it sets aria-activedescendant on the focused editor to the highlighted
  // item id. This is required for screen-reader support so it can't break
  // without also breaking accessibility — much more stable than sniffing
  // data-qa attributes or CSS class names across Slack releases.
  //
  // Secondary signal: any visible role="listbox"/role="menu" on the page.
  function isAutocompleteOpen() {
    // 1. aria-activedescendant or aria-expanded on the focused editor
    const active = document.activeElement;
    if (active && active.getAttribute) {
      const descendant = active.getAttribute("aria-activedescendant");
      if (descendant && descendant.trim() !== "") return true;
      if (active.getAttribute("aria-expanded") === "true") return true;
    }

    // 2. Any visible listbox/menu popup (Slack renders autocomplete as
    //    role="listbox"). Visibility check ignores off-screen ARIA widgets.
    //    Skip anything inside our own overlay.
    const popups = document.querySelectorAll(
      '[role="listbox"], [role="menu"], [role="grid"][aria-label*="autocomplete" i]'
    );
    for (const p of popups) {
      if (p.closest && p.closest("#toneguard-overlay-frame, #toneguard-overlay-host")) continue;
      const rect = p.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }

    return false;
  }

  // Unified keydown handler
  function handleKeydown(e) {
    if (releasing) return;

    // Never intercept events from the ToneGuard overlay itself
    if (isFromOverlay(e)) return;

    // Slack + LinkedIn: Enter sends
    if (SITE === "slack" || SITE === "linkedin") {
      if (e.key !== "Enter" || e.shiftKey) return;
      // Don't intercept Enter when selecting from autocomplete dropdowns
      if (isAutocompleteOpen()) return;
    }
    // Gmail: Ctrl/Cmd+Enter sends
    else if (SITE === "gmail") {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    }
    // Generic (custom sites): treat plain Enter as send, Shift+Enter as newline.
    // This matches the convention on Slack/LinkedIn/Discord/Frame.io/etc.
    else {
      if (e.key !== "Enter" || e.shiftKey) return;
      // Skip when an autocomplete popup is open (same ARIA check as Slack)
      if (isAutocompleteOpen()) return;
      // Only intercept if the focused element looks like a message editor
      const t = e.target;
      const isEditor =
        (t && t.matches && t.matches(currentPlatform.editorSelector)) ||
        (t && t.closest && t.closest(currentPlatform.editorSelector));
      if (!isEditor) return;
    }

    const editor = e.target.closest(currentPlatform.editorSelector) || e.target;
    const text = currentPlatform.getEditorText(editor);
    if (!text || text.length < 10) return;

    e.preventDefault();
    e.stopImmediatePropagation();
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

      for (const msgEl of els) {
        const text = msgEl.innerText?.trim();
        if (text && text.length > 0) {
          messages.push(text);
        }
      }

      if (messages.length === 0) return "";

      return "RECENT CONVERSATION (for context only):\n" +
        messages.map((m, i) => "[" + (i + 1) + "] " + m).join("\n");

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
    // Concurrency guard: don't start a new analysis while one is in-flight
    if (pendingEditor) return;

    pendingText = text;
    pendingEditor = editor;
    console.log("[ToneGuard:diag] pendingEditor set, analysis starting");

    // Tracks whether the safety timeout already gave up on this run. The
    // in-flight analysis promise is NOT abortable, so a slow analysis can
    // still resolve after the timeout fired and cleared pendingEditor. If
    // that resolve path were allowed to call showResult()/releaseSend(), it
    // would paint a live, clickable suggestion over null pending state — the
    // user clicks "Use suggestion", the decision reaches us with
    // pendingEditor === null, and we nack with "no pending compose" and a
    // false "message did not send" card. Guard every post-await branch on
    // this flag so a superseded run stays silent.
    let superseded = false;

    // Safety timeout: if analysis hangs much longer than the multi-model
    // path's worst case (~15s), surface a stale-state notice and clear
    // the concurrency guard. Do NOT dispatch a synthetic Enter here —
    // synthetic KeyboardEvents have isTrusted=false and Slack ignores them
    // for send, so the old "releaseSend on timeout" path silently left the
    // message in draft while clearing pendingEditor (which then broke any
    // later "Use edited version" click with a "no pending compose" error).
    const safetyTimeout = setTimeout(() => {
      console.warn("[ToneGuard:diag] safety timeout fired after 30s; clearing pending state");
      superseded = true;
      hideCheckingIndicator();
      if (window.__toneGuard) {
        window.__toneGuard.showError({
          type: "timeout",
          message: "Analysis took longer than 30 seconds. Your message was not sent. Close this and try again from your compose window.",
          retryable: true,
          diagnostic_code: "TG_TIMEOUT_001"
        });
      }
      pendingEditor = null;
      pendingText = null;
    }, 30000);

    // Check if extension context is still valid before calling chrome APIs.
    // If stale, show reload prompt and DO NOT release the send — the message
    // is unchecked and must not go out automatically. User can reload the tab
    // and resend manually.
    if (!isContextValid()) {
      clearTimeout(safetyTimeout);
      if (window.__toneGuard) {
        window.__toneGuard.showStale();
      }
      pendingEditor = null;
      pendingText = null;
      return;
    }

    // Show overlay loading state
    if (window.__toneGuard) {
      window.__toneGuard.showLoading();
    }
    showCheckingIndicator();

    // Hoisted so the catch can report the payload shape if sendMessage throws
    // a "Could not serialize message" error (a non-string slipping into one of
    // these fields). See the serialize breadcrumb in the catch below.
    let context;
    try {
      context = getConversationContext();
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE",
        text: text,
        context: context,
        site: SITE
      });

      clearTimeout(safetyTimeout);
      hideCheckingIndicator();

      // The safety timeout already fired and tore down pending state. Dropping
      // here keeps a slow result from painting a live overlay (showResult) or
      // auto-releasing the send over null pendingEditor — both would strand the
      // user on a phantom suggestion that can never ack. The timeout notice is
      // already on screen; say nothing more.
      if (superseded) {
        console.warn("[ToneGuard:diag] analysis resolved after timeout; dropping superseded result");
        return;
      }

      if (result.error) {
        console.warn("ToneGuard:", formatErrorForLog(result.error));
        if (window.__toneGuard) window.__toneGuard.showError(result.error);
        return;
      }

      if (!result.flagged) {
        // Show "Looks good!" briefly and release
        if (window.__toneGuard) {
          window.__toneGuard.showPassed();
        }
        currentPlatform.releaseSend(editor);
        pendingEditor = null;
        pendingText = null;
        return;
      }

      // Flagged — show result in overlay and wait for decision
      if (window.__toneGuard) {
        window.__toneGuard.showResult({
          original: text,
          suggestion: result.suggestion,
          reasoning: result.reasoning,
          confidence: result.confidence || 0,
          mode: result.mode || "tone",
          readability: result.readability || 0,
          red_flags: result.red_flags || [],
          categories: result.categories || [],
          issues: result.issues || [],
          intent_mode: result.intent_mode || "professional",
          site_profile: result.site_profile || null,
          has_questions: result.has_questions || false,
          questions: result.questions || [],
          landing: result.landing || null
        });
      }

    } catch (err) {
      clearTimeout(safetyTimeout);
      hideCheckingIndicator();

      // Superseded by the timeout — pending state is already cleared and the
      // timeout notice is shown. Don't releaseSend() over null state.
      if (superseded) {
        console.warn("[ToneGuard:diag] analysis rejected after timeout; dropping superseded error");
        return;
      }

      // Extension was reloaded, OR the service worker died mid-analysis
      // ("Could not establish connection. Receiving end does not exist." /
      // "The message port closed before a response was received.") — the
      // message never got a verdict. Show the reload banner and BLOCK the
      // send. Never auto-release: an unchecked message must not go out just
      // because the analysis round-trip failed. See CLAUDE.md "Never swallow
      // parse errors into a destructive default."
      const lib = globalThis.__toneGuardLib;
      const connectionLost = lib && typeof lib.isConnectionLostError === "function"
        ? lib.isConnectionLostError(err)
        : false;
      if (!isContextValid() || connectionLost) {
        console.warn("ToneGuard: service worker unreachable, prompting reload:",
          err && err.message ? err.message : err);
        if (window.__toneGuard) window.__toneGuard.showStale();
        pendingEditor = null;
        pendingText = null;
        return;
      }

      console.error("ToneGuard error:", err && err.message ? err.message : err);
      // Serialize breadcrumb: if chrome.runtime.sendMessage rejected the
      // ANALYZE payload, print the type/length of each field so we can see
      // which one was non-serializable instead of guessing.
      if (err && /serialize/i.test(err.message || "")) {
        console.warn(
          "[ToneGuard:diag] ANALYZE payload not serializable —" +
            " text:" + typeof text + "(" + (text && text.length) + ")" +
            " context:" + typeof context + "(" + (context && context.length) + ")" +
            " site:" + typeof SITE + "(" + SITE + ")"
        );
      }
      // Any other unexpected failure: surface a retryable error and BLOCK the
      // send. The message stays in the composer; nothing goes out unchecked.
      if (window.__toneGuard) {
        window.__toneGuard.showError({
          type: "analysis_failed",
          message: "ToneGuard couldn't check this message, so it wasn't sent. Try again, or reload the tab if this keeps happening.",
          retryable: true,
          diagnostic_code: "TG_ANALYZE_FAIL"
        });
      }
      pendingEditor = null;
      pendingText = null;
    }
  }

  // Visual indicator
  let indicatorEl = null;

  function showCheckingIndicator() {
    if (indicatorEl) return;

    indicatorEl = document.createElement("div");
    indicatorEl.textContent = "Checking tone...";
    indicatorEl.style.cssText = [
      "position: fixed",
      "bottom: 80px",
      "right: 20px",
      "background: #4CAF50",
      "color: white",
      "padding: 8px 16px",
      "border-radius: 8px",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "font-size: 13px",
      "z-index: 999999",
      "box-shadow: 0 2px 8px rgba(0,0,0,0.2)",
      "animation: tg-pulse 1.5s ease-in-out infinite"
    ].join(";");

    if (!document.getElementById("tg-style")) {
      const style = document.createElement("style");
      style.id = "tg-style";
      style.textContent = "@keyframes tg-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }";
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
    btn.className = "tg-review-btn";
    btn._tgEditor = editor;
    btn.textContent = "Review";
    btn.title = "Check tone and clarity with ToneGuard";
    btn.style.cssText = [
      "position: absolute",
      "bottom: 4px",
      "right: 60px",
      "background: #4CAF50",
      "color: white",
      "border: none",
      "border-radius: 4px",
      "padding: 2px 8px",
      "font-size: 11px",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "cursor: pointer",
      "z-index: 999",
      "opacity: 0.7",
      "transition: opacity 0.15s"
    ].join(";");
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.7"; });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // The captured `editor` may be detached after a composer re-render
      // (Slack Quill / Gmail rebuild their editor nodes). Read from the
      // live editor on the page, not the node we bound at injection time —
      // otherwise getEditorText returns stale/empty text and we bail
      // silently, which reads to the user as "the button does nothing."
      const liveEditor = document.contains(editor)
        ? editor
        : document.querySelector(currentPlatform.editorSelector);
      if (!liveEditor) return;

      const text = currentPlatform.getEditorText(liveEditor);
      if (!text || text.length < 10) return;

      // Run analysis in draft mode (advisory, no send interception)
      draftReview(text, liveEditor);
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
  async function draftReview(text, _editor) {
    if (!isContextValid()) {
      if (window.__toneGuard) window.__toneGuard.showStale();
      return;
    }

    if (window.__toneGuard) {
      window.__toneGuard.showLoading();
    }
    showCheckingIndicator();

    try {
      const context = getConversationContext();
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE",
        text: text,
        context: context,
        site: SITE
      });

      hideCheckingIndicator();

      if (result.error) {
        console.warn("ToneGuard:", formatErrorForLog(result.error));
        if (window.__toneGuard) window.__toneGuard.showError(result.error);
        return;
      }

      if (!result.flagged) {
        if (window.__toneGuard) window.__toneGuard.showPassed();
      } else if (window.__toneGuard) {
        window.__toneGuard.showResult({
          original: text,
          suggestion: result.suggestion,
          reasoning: result.reasoning,
          confidence: result.confidence || 0,
          mode: result.mode || "tone",
          readability: result.readability || 0,
          red_flags: result.red_flags || [],
          categories: result.categories || [],
          issues: result.issues || [],
          intent_mode: result.intent_mode || "professional",
          site_profile: result.site_profile || null,
          has_questions: result.has_questions || false,
          questions: result.questions || [],
          landing: result.landing || null
        });
      }

    } catch (err) {
      console.error("ToneGuard draft review error:", err);
      hideCheckingIndicator();
      if (window.__toneGuard) window.__toneGuard.hide();
    }
  }

  // --- Context Menu Selection Analysis (Step 7) ---

  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type !== "ANALYZE_SELECTION") return;

    const text = message.text || window.getSelection()?.toString() || "";
    if (!text || text.trim().length < 5) return;

    // Determine context from current site
    const context = SITE !== "generic"
      ? "Selected text on " + SITE + " (review mode, not send-interception)"
      : "Selected text on " + location.hostname + " (review mode)";

    selectionReview(text, context);
  });

  async function selectionReview(text, context) {
    if (!isContextValid()) {
      if (window.__toneGuard) window.__toneGuard.showStale();
      return;
    }

    if (window.__toneGuard) window.__toneGuard.showLoading();
    showCheckingIndicator();

    try {
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE",
        text: text,
        context: context,
        site: SITE
      });

      hideCheckingIndicator();

      if (result.error) {
        console.warn("ToneGuard:", formatErrorForLog(result.error));
        if (window.__toneGuard) window.__toneGuard.showError(result.error);
        return;
      }

      if (!result.flagged) {
        if (window.__toneGuard) window.__toneGuard.showPassed();
      } else if (window.__toneGuard) {
        window.__toneGuard.showResult({
          original: text,
          suggestion: result.suggestion,
          reasoning: result.reasoning,
          confidence: result.confidence || 0,
          mode: result.mode || "tone",
          readability: result.readability || 0,
          red_flags: result.red_flags || [],
          categories: result.categories || [],
          issues: result.issues || [],
          intent_mode: result.intent_mode || "professional",
          site_profile: result.site_profile || null,
          has_questions: result.has_questions || false,
          questions: result.questions || [],
          selectionMode: true // Tells overlay to show Copy/Replace instead of Send
        });
      }
    } catch (err) {
      hideCheckingIndicator();
      console.error("ToneGuard selection review error:", err);
      if (window.__toneGuard) window.__toneGuard.hide();
    }
  }

  // Initialize
  function init() {
    // Set up overlay decision handler
    setupOverlay();

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

      // Remove orphaned review buttons whose editor was detached by a
      // composer re-render — otherwise a dead button lingers on screen
      // (and in Gmail blocks a fresh one from looking right).
      document.querySelectorAll("button.tg-review-btn").forEach((b) => {
        if (!document.contains(b._tgEditor)) b.remove();
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
