// ToneGuard Side Panel
// Shows original vs suggested rewrite when a message is flagged.

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const emptyEl = document.getElementById("empty");
const originalEl = document.getElementById("original");
const suggestionEl = document.getElementById("suggestion");
const reasoningEl = document.getElementById("reasoning");
const useSuggestionBtn = document.getElementById("useSuggestion");
const sendOriginalBtn = document.getElementById("sendOriginal");

let currentResult = null;

// On panel open, fetch the latest analysis result
loadResult();

// Also listen for new results while panel is open
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.tg_latest_result) {
    showResult(changes.tg_latest_result.newValue);
  }
});

async function loadResult() {
  const response = await chrome.runtime.sendMessage({ type: "GET_RESULT" });
  if (response) {
    showResult(response);
  } else {
    showEmpty();
  }
}

function showResult(result) {
  currentResult = result;

  originalEl.textContent = result.original;
  suggestionEl.textContent = result.suggestion;
  reasoningEl.textContent = result.reasoning;

  loadingEl.style.display = "none";
  emptyEl.style.display = "none";
  contentEl.style.display = "block";
}

function showEmpty() {
  loadingEl.style.display = "none";
  contentEl.style.display = "none";
  emptyEl.style.display = "block";
}

// Button handlers
useSuggestionBtn.addEventListener("click", () => {
  if (!currentResult) return;

  chrome.runtime.sendMessage({
    type: "PANEL_ACTION",
    action: "use_suggestion",
    suggestion: currentResult.suggestion,
    tabId: currentResult.tabId
  });

  showSent("Suggestion applied!");
});

sendOriginalBtn.addEventListener("click", () => {
  if (!currentResult) return;

  chrome.runtime.sendMessage({
    type: "PANEL_ACTION",
    action: "send_original",
    tabId: currentResult.tabId
  });

  showSent("Sent as-is.");
});

function showSent(message) {
  contentEl.style.display = "none";

  const sent = document.createElement("div");
  sent.style.cssText = "padding: 40px 0; text-align: center; color: #4CAF50; font-size: 14px;";
  sent.textContent = message;
  document.querySelector(".panel").appendChild(sent);

  // Reset after a moment
  setTimeout(() => {
    sent.remove();
    showEmpty();
    currentResult = null;
  }, 2000);
}
