const customRulesEl = document.getElementById("customRules");
const saveRulesBtn = document.getElementById("saveRules");
const rulesStatusEl = document.getElementById("rulesStatus");
const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistory");

// Load weekly stats
chrome.storage.local.get(["tg_stats"], (result) => {
  const stats = result.tg_stats;
  if (!stats) return;

  document.getElementById("weekStart").textContent =
    new Date(stats.weekStart).toLocaleDateString();
  document.getElementById("statChecked").textContent = stats.checked || 0;
  document.getElementById("statFlagged").textContent = stats.flagged || 0;

  const checked = stats.checked || 0;
  const flagged = stats.flagged || 0;
  const passRate = checked > 0 ? Math.round(((checked - flagged) / checked) * 100) : 0;
  document.getElementById("statPassRate").textContent = passRate + "%";

  // Decision breakdown bar
  const total = (stats.accepted || 0) + (stats.edited || 0) + (stats.dismissed || 0);
  if (total > 0) {
    document.getElementById("decisionBar").style.display = "block";
    const bar = document.getElementById("statBar");
    bar.textContent = "";

    const segments = [
      { class: "accepted", count: stats.accepted || 0 },
      { class: "edited", count: stats.edited || 0 },
      { class: "dismissed", count: stats.dismissed || 0 }
    ];

    for (const seg of segments) {
      if (seg.count === 0) continue;
      const div = document.createElement("div");
      div.className = "stat-bar-fill " + seg.class;
      div.style.width = ((seg.count / total) * 100) + "%";
      bar.appendChild(div);
    }
  }

  // Most common flag type
  if (stats.byMode && Object.keys(stats.byMode).length > 0) {
    const sorted = Object.entries(stats.byMode).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const modeLabels = { tone: "Tone issues", polish: "Clarity/polish", both: "Tone + clarity" };
    document.getElementById("mostCommon").textContent =
      "Most common flag: " + (modeLabels[top[0]] || top[0]) + " (" + top[1] + " times)";
  }
});

// Load custom rules
chrome.storage.sync.get(["tg_custom_rules"], (result) => {
  if (result.tg_custom_rules) {
    customRulesEl.value = result.tg_custom_rules;
  }
});

// Save custom rules
saveRulesBtn.addEventListener("click", () => {
  const rules = customRulesEl.value.trim();
  chrome.storage.sync.set({ tg_custom_rules: rules }, () => {
    rulesStatusEl.textContent = "Saved! Rules will apply to your next message.";
    setTimeout(() => { rulesStatusEl.textContent = ""; }, 3000);

    // Trigger sync push for custom rules
    chrome.runtime.sendMessage({ type: "SYNC_PUSH", dataType: "custom_rules" }).catch(() => {});
  });
});

// Show sync status
const syncStatusEl = document.getElementById("syncStatus");
const syncNowBtn = document.getElementById("syncNowBtn");

function refreshSyncStatus() {
  if (!syncStatusEl) return;
  chrome.runtime.sendMessage({ type: "SYNC_STATUS" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      syncStatusEl.textContent = "Sync: not connected";
      syncStatusEl.className = "sync-status";
      return;
    }
    if (response.connected) {
      const lastSync = response.lastSyncAt
        ? new Date(response.lastSyncAt).toLocaleString()
        : "never";
      syncStatusEl.textContent = "Sync: connected (last: " + lastSync + ")";
      syncStatusEl.className = "sync-status connected";
    } else {
      syncStatusEl.textContent = "Sync: not connected";
      syncStatusEl.className = "sync-status";
    }
  });
}

refreshSyncStatus();

if (syncNowBtn) {
  syncNowBtn.addEventListener("click", () => {
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = "Syncing...";

    // Trigger a full pull via the service worker
    chrome.runtime.sendMessage({ type: "SYNC_PULL" }, (response) => {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "Sync now";

      if (chrome.runtime.lastError) {
        syncStatusEl.textContent = "Sync failed: " + chrome.runtime.lastError.message;
        syncStatusEl.className = "sync-status";
      } else {
        refreshSyncStatus();
      }
    });
  });
}

// Load and render decision history
chrome.storage.local.get(["tg_decisions"], (result) => {
  renderHistory(result.tg_decisions || []);
});

function renderHistory(decisions) {
  historyListEl.textContent = "";

  if (decisions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.textContent = "No decisions yet. Use ToneGuard to start building your learning history.";
    historyListEl.appendChild(empty);
    return;
  }

  // Show newest first
  const reversed = [...decisions].reverse();

  for (const d of reversed) {
    const item = document.createElement("div");
    item.className = "history-item";

    const action = document.createElement("div");
    action.className = "history-action";

    if (d.action === "used_suggestion") {
      action.className += " accepted";
      action.textContent = "Accepted suggestion";
    } else if (d.action === "used_edited") {
      action.className += " edited";
      action.textContent = "Edited suggestion";
    } else {
      action.className += " dismissed";
      action.textContent = "Sent as-is (dismissed)";
    }
    item.appendChild(action);

    const original = document.createElement("div");
    original.className = "history-text";
    original.textContent = truncate(d.original, 120);
    item.appendChild(original);

    if (d.action === "used_edited") {
      const edited = document.createElement("div");
      edited.className = "history-text";
      edited.textContent = "Your version: " + truncate(d.finalText, 120);
      item.appendChild(edited);
    } else if (d.action === "used_suggestion") {
      const sugg = document.createElement("div");
      sugg.className = "history-text muted";
      sugg.textContent = "Rewritten: " + truncate(d.suggestion, 120);
      item.appendChild(sugg);
    }

    if (d.timestamp) {
      const time = document.createElement("div");
      time.className = "history-time";
      time.textContent = new Date(d.timestamp).toLocaleString();
      item.appendChild(time);
    }

    historyListEl.appendChild(item);
  }
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

// Clear history
clearHistoryBtn.addEventListener("click", () => {
  if (confirm("Clear all learning history? ToneGuard will start fresh.")) {
    chrome.storage.local.set({ tg_decisions: [] }, () => {
      renderHistory([]);
    });
  }
});
