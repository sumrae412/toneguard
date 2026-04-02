const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const doneIcon = document.getElementById("doneIcon");
const doneLabel = document.getElementById("doneLabel");
const doneBtn = document.getElementById("doneBtn");

// Check if key already saved
chrome.storage.sync.get(["tg_api_key"], (result) => {
  if (result.tg_api_key) {
    apiKeyInput.value = result.tg_api_key;
    showReady();
  }
});

saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    statusEl.textContent = "Please enter an API key.";
    statusEl.className = "status error";
    return;
  }

  if (!key.startsWith("sk-ant-")) {
    statusEl.textContent = "API keys start with sk-ant-. Check your key and try again.";
    statusEl.className = "status error";
    return;
  }

  chrome.storage.sync.set({ tg_api_key: key }, () => {
    statusEl.textContent = "Saved! Your key syncs across Chrome devices.";
    statusEl.className = "status saved";
    showReady();
  });
});

function showReady() {
  doneIcon.textContent = "\u2713";
  doneIcon.className = "check-icon";
  doneLabel.textContent = "You're all set!";
  doneBtn.disabled = false;
}

doneBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://app.slack.com" });
});
