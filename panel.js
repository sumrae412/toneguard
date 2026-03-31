// ToneGuard Side Panel
// Shows original vs suggested rewrite when a message is flagged.
// Opens immediately on send, shows loading, then results or "all good."

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const emptyEl = document.getElementById("empty");
const originalEl = document.getElementById("original");
const suggestionEl = document.getElementById("suggestion");
const reasoningEl = document.getElementById("reasoning");
const useSuggestionBtn = document.getElementById("useSuggestion");
const sendOriginalBtn = document.getElementById("sendOriginal");

let currentResult = null;

// On panel open, show loading state and check for results
showLoading();
loadResult();

// Listen for new results while panel is open
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.tg_latest_result) {
    handleResult(changes.tg_latest_result.newValue);
  }
});

async function loadResult() {
  const response = await chrome.runtime.sendMessage({ type: "GET_RESULT" });
  if (response) {
    handleResult(response);
  }
  // Otherwise stay in loading state — results will come via storage listener
}

function handleResult(result) {
  if (!result) return;

  if (result.passed) {
    showPassed();
  } else if (result.original) {
    showResult(result);
  }
}

function showLoading() {
  loadingEl.style.display = "flex";
  contentEl.style.display = "none";
  emptyEl.style.display = "none";
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

function showPassed() {
  loadingEl.style.display = "none";
  contentEl.style.display = "none";
  emptyEl.style.display = "none";

  const passed = document.createElement("div");
  passed.style.cssText = "padding: 40px 0; text-align: center; color: #4CAF50; font-size: 14px;";
  passed.textContent = "Looks good! Message sent.";
  document.querySelector(".panel").appendChild(passed);

  setTimeout(() => {
    passed.remove();
    showEmpty();
  }, 2000);
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

  setTimeout(() => {
    sent.remove();
    showEmpty();
    currentResult = null;
  }, 2000);
}
