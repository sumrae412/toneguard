// ToneGuard Side Panel
// Shows original vs suggested rewrite when a message is flagged.
// Tracks every decision to learn from user choices.

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const emptyEl = document.getElementById("empty");
const originalEl = document.getElementById("original");
const suggestionEl = document.getElementById("suggestion");
const reasoningEl = document.getElementById("reasoning");
const useSuggestionBtn = document.getElementById("useSuggestion");
const sendOriginalBtn = document.getElementById("sendOriginal");

let currentResult = null;
let suggestionWasEdited = false;

// Track when user edits the suggestion
suggestionEl.addEventListener("input", () => {
  suggestionWasEdited = true;
  useSuggestionBtn.textContent = "Use edited version";
});

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
  suggestionWasEdited = false;
  useSuggestionBtn.textContent = "Use suggestion";

  originalEl.textContent = result.original;
  suggestionEl.textContent = result.suggestion;
  reasoningEl.textContent = result.reasoning;

  // Badge: show mode
  const badge = document.getElementById("badge");
  if (result.mode === "polish") {
    badge.textContent = "Polish";
    badge.className = "badge polish";
  } else if (result.mode === "both") {
    badge.textContent = "Tone + Polish";
    badge.className = "badge both";
  } else {
    badge.textContent = "Tone";
    badge.className = "badge";
  }

  // Confidence bar
  let barContainer = document.querySelector(".confidence-bar");
  if (!barContainer) {
    barContainer = document.createElement("div");
    barContainer.className = "confidence-bar";
    const fill = document.createElement("div");
    fill.className = "confidence-fill";
    barContainer.appendChild(fill);
    reasoningEl.after(barContainer);
  }
  const fill = barContainer.querySelector(".confidence-fill");
  const conf = result.confidence || 0;
  fill.style.width = (conf * 100) + "%";
  fill.className = "confidence-fill " + (conf >= 0.9 ? "high" : conf >= 0.6 ? "medium" : "low");

  // Red flags
  const redFlagsEl = document.getElementById("redFlags");
  const flagsListEl = document.getElementById("flagsList");
  flagsListEl.textContent = "";

  if (result.red_flags && result.red_flags.length > 0) {
    redFlagsEl.style.display = "block";
    for (const flag of result.red_flags) {
      const chip = document.createElement("span");
      chip.className = "flag-chip";
      chip.textContent = flag;
      flagsListEl.appendChild(chip);
    }
  } else {
    redFlagsEl.style.display = "none";
  }

  // Clarifying questions
  const questionsSection = document.getElementById("questionsSection");
  const questionsList = document.getElementById("questionsList");
  const refiningIndicator = document.getElementById("refiningIndicator");
  questionsList.textContent = "";
  refiningIndicator.style.display = "none";

  if (result.has_questions && result.questions && result.questions.length > 0) {
    questionsSection.style.display = "block";
    for (const q of result.questions) {
      const item = document.createElement("div");
      item.className = "question-item";

      const label = document.createElement("div");
      label.className = "question-label";
      label.textContent = q;
      item.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "question-input";
      input.placeholder = "Your answer...";
      input.dataset.question = q;
      item.appendChild(input);

      questionsList.appendChild(item);
    }

    // Focus the first input
    const firstInput = questionsList.querySelector(".question-input");
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  } else {
    questionsSection.style.display = "none";
  }

  // Show "Refined" badge if this is a refined result
  if (result.refined) {
    const badge = document.getElementById("badge");
    badge.textContent = "Refined";
    badge.className = "badge polish";
  }

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

  const finalText = suggestionEl.innerText.trim();

  // Log the decision
  logDecision({
    action: suggestionWasEdited ? "used_edited" : "used_suggestion",
    original: currentResult.original,
    suggestion: currentResult.suggestion,
    finalText: finalText,
    reasoning: currentResult.reasoning,
    wasEdited: suggestionWasEdited
  });

  chrome.runtime.sendMessage({
    type: "PANEL_ACTION",
    action: "use_suggestion",
    suggestion: finalText,
    tabId: currentResult.tabId
  });

  showSent(suggestionWasEdited ? "Edited version sent!" : "Suggestion applied!");
});

sendOriginalBtn.addEventListener("click", () => {
  if (!currentResult) return;

  // Log the dismissal
  logDecision({
    action: "sent_original",
    original: currentResult.original,
    suggestion: currentResult.suggestion,
    finalText: currentResult.original,
    reasoning: currentResult.reasoning,
    wasEdited: false
  });

  chrome.runtime.sendMessage({
    type: "PANEL_ACTION",
    action: "send_original",
    tabId: currentResult.tabId
  });

  showSent("Sent as-is.");
});

// Submit answers to clarifying questions
document.getElementById("submitAnswers").addEventListener("click", async () => {
  if (!currentResult) return;

  const inputs = document.querySelectorAll(".question-input");
  const answers = [];
  for (const input of inputs) {
    const answer = input.value.trim();
    if (!answer) {
      input.style.borderColor = "#e53935";
      input.focus();
      return; // require all answers
    }
    answers.push({ question: input.dataset.question, answer: answer });
  }

  // Show refining indicator
  document.getElementById("questionsSection").style.display = "none";
  document.getElementById("refiningIndicator").style.display = "flex";

  // Send to service worker for refinement
  chrome.runtime.sendMessage({
    type: "REFINE",
    original: currentResult.original,
    answers: answers,
    tabId: currentResult.tabId
  });

  // The refined result will come back via storage.session listener
  // and showResult will be called again with the refined version
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
    suggestionWasEdited = false;
    useSuggestionBtn.textContent = "Use suggestion";
  }, 2000);
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (!currentResult) return;

  // Don't capture keys when editing the suggestion
  if (document.activeElement === suggestionEl) return;

  if (e.key === "Enter") {
    e.preventDefault();
    useSuggestionBtn.click();
  } else if (e.key === "Escape") {
    e.preventDefault();
    sendOriginalBtn.click();
  }
});

// Learning: log every decision to storage
async function logDecision(decision) {
  decision.timestamp = new Date().toISOString();
  decision.url = ""; // we don't track URLs for privacy

  const { tg_decisions: existing } = await chrome.storage.local.get(["tg_decisions"]);
  const decisions = existing || [];

  decisions.push(decision);

  // Keep last 100 decisions
  if (decisions.length > 100) {
    decisions.splice(0, decisions.length - 100);
  }

  await chrome.storage.local.set({ tg_decisions: decisions });

  // Update weekly stats with the decision type
  const { tg_stats: stats } = await chrome.storage.local.get(["tg_stats"]);
  if (stats) {
    if (decision.action === "used_suggestion") stats.accepted++;
    else if (decision.action === "used_edited") stats.edited++;
    else if (decision.action === "sent_original") stats.dismissed++;
    await chrome.storage.local.set({ tg_stats: stats });
  }
}
