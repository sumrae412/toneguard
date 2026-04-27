// ToneGuard Overlay (parent-side host)
//
// Thin wrapper that injects an extension iframe into the page and forwards
// content.js calls to it via postMessage. The actual UI lives in overlay.html
// + overlay-frame.js, which run inside the iframe.
//
// Why an iframe? Shadow DOM does not isolate composed events from the host
// page — Slack/Gmail/LinkedIn register window-level keyboard listeners in
// capture phase that always fire before any listener inside our shadow root,
// so they steal keystrokes from our inputs/contentEditable. An iframe is a
// real browser-enforced boundary: events inside it don't propagate to the
// parent at all.
//
// Public API (called from content.js):
//   window.__toneGuard.showLoading()
//   window.__toneGuard.showResult(result)
//   window.__toneGuard.showPassed()
//   window.__toneGuard.showStale()
//   window.__toneGuard.showError(error)
//   window.__toneGuard.hide()
//   window.__toneGuard.setOnDecision(fn)

(function () {
  "use strict";

  if (window.__toneGuard) return; // double-injection guard

  let iframe = null;
  let iframeReady = false;
  let onDecision = null;
  let pendingMessages = [];
  const FRAME_ORIGIN = "chrome-extension://" + chrome.runtime.id;

  // --- Iframe creation ---

  function ensureIframe() {
    if (iframe) return;

    iframe = document.createElement("iframe");
    iframe.id = "toneguard-overlay-frame";
    iframe.src = chrome.runtime.getURL("overlay.html");
    iframe.setAttribute("aria-label", "ToneGuard overlay");

    // Fullscreen, transparent, click-through by default. The iframe contents
    // (drawer + backdrop) toggle pointer-events on themselves, and we mirror
    // that on the iframe element via the "size" message from the frame.
    Object.assign(iframe.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      width: "100vw",
      height: "100vh",
      border: "none",
      margin: "0",
      padding: "0",
      background: "transparent",
      colorScheme: "light dark",
      zIndex: "2147483647",
      pointerEvents: "none"
    });
    iframe.allowTransparency = "true";

    document.documentElement.appendChild(iframe);
  }

  // --- Message protocol ---

  function postToFrame(msg) {
    if (!iframe || !iframeReady) {
      pendingMessages.push(msg);
      return;
    }
    iframe.contentWindow.postMessage({ source: "toneguard-content", ...msg }, FRAME_ORIGIN);
  }

  function flushPending() {
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift();
      iframe.contentWindow.postMessage({ source: "toneguard-content", ...msg }, FRAME_ORIGIN);
    }
  }

  // Forward a decision to content.js's onDecision callback and ack the iframe
  // with ok/error based on what the callback returned or threw.
  //
  // onDecision may:
  //   - return undefined / void (legacy) → treated as ok:true
  //   - return an object { ok: bool, error?: string } → use as-is
  //   - return a Promise resolving to either of the above → await it
  //   - throw synchronously or reject → ok:false with the error message
  async function handleDecision(msg) {
    const id = msg.id;
    if (!onDecision) {
      sendAck(id, false, "no decision handler bound");
      return;
    }
    try {
      const result = await onDecision(msg.decision);
      if (result && typeof result === "object" && "ok" in result) {
        sendAck(id, !!result.ok, result.error);
      } else {
        sendAck(id, true);
      }
    } catch (err) {
      sendAck(id, false, err && err.message ? err.message : String(err));
    }
  }

  function sendAck(id, ok, error) {
    postToFrame({ type: "decision_ack", id, ok, error: error || undefined });
  }

  window.addEventListener("message", (e) => {
    // Only accept messages from our own iframe
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (e.origin !== FRAME_ORIGIN) return;
    const msg = e.data;
    if (!msg || msg.source !== "toneguard-frame") return;

    switch (msg.type) {
      case "ready":
        iframeReady = true;
        flushPending();
        break;

      case "size":
        // Toggle pointer-events on the iframe element so the page is
        // click-through when overlay is closed and modal when open.
        iframe.style.pointerEvents = msg.open ? "auto" : "none";
        break;

      case "decision":
        handleDecision(msg);
        break;

      case "replace_selection":
        try {
          document.execCommand("insertText", false, msg.text);
        } catch (_) { /* noop */ }
        break;

      case "reload_tab":
        location.reload();
        break;
    }
  });

  // --- Public API ---

  window.__toneGuard = Object.freeze({
    showLoading() {
      ensureIframe();
      postToFrame({ type: "show_loading" });
    },
    showResult(result) {
      ensureIframe();
      // Tag whether the current selection is in an editable field so the
      // frame can decide whether to render a "Replace selection" button.
      if (result && result.selectionMode) {
        const sel = window.getSelection();
        const anchor = sel?.anchorNode;
        const editable = anchor && (
          anchor.nodeType === Node.ELEMENT_NODE
            ? anchor.isContentEditable || anchor.tagName === "TEXTAREA" || anchor.tagName === "INPUT"
            : anchor.parentElement?.isContentEditable
        );
        result = { ...result, editable: !!editable };
      }
      postToFrame({ type: "show_result", result });
    },
    showPassed() {
      ensureIframe();
      postToFrame({ type: "show_passed" });
    },
    showStale() {
      ensureIframe();
      postToFrame({ type: "show_stale" });
    },
    showError(error) {
      ensureIframe();
      postToFrame({ type: "show_error", error });
    },
    hide() {
      if (!iframe) return;
      postToFrame({ type: "hide" });
    },
    setOnDecision(fn) {
      onDecision = fn;
    }
  });
})();
