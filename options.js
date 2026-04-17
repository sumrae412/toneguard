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

// --- Train Your Voice ---
//
// "Paste 5-10 messages you'd be happy to send as-is" flow. Samples are
// tagged source="trained" in storage and take precedence over auto-collected
// ones. Users can also regenerate a derived style fingerprint (see
// MCP tool regenerate_fingerprint; here we just display the current one).

const voiceTrainingEl = document.getElementById("voiceTraining");
const saveTrainingBtn = document.getElementById("saveTraining");
const regenerateFingerprintBtn = document.getElementById("regenerateFingerprint");
const voiceStatusEl = document.getElementById("voiceStatus");
const voiceSamplesListEl = document.getElementById("voiceSamplesList");
const voiceFingerprintViewEl = document.getElementById("voiceFingerprintView");

function setVoiceStatus(msg, color) {
  voiceStatusEl.textContent = msg || "";
  voiceStatusEl.style.color = color || "#4CAF50";
  if (msg) setTimeout(() => { voiceStatusEl.textContent = ""; }, 3000);
}

function splitTrainingInput(raw) {
  // Blank-line separated blocks; trim each; drop empties.
  return (raw || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function refreshVoiceProfile() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_VOICE_PROFILE" });
  renderVoiceSamples(resp);
  renderFingerprint(resp && resp.fingerprint);
}

function renderVoiceSamples(profile) {
  voiceSamplesListEl.textContent = "";
  if (!profile) return;

  const samples = [...(profile.trained_samples || []), ...(profile.auto_samples || [])];
  if (samples.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:10px; color:#999; font-size:13px;";
    empty.textContent = "No voice samples yet. Add training samples above, or keep using ToneGuard and it'll learn from your sent messages.";
    voiceSamplesListEl.appendChild(empty);
    return;
  }

  // Sort newest first
  samples.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  for (const s of samples) {
    const item = document.createElement("div");
    item.className = "tg-voice-sample-item";

    const textEl = document.createElement("div");
    textEl.className = "tg-voice-sample-text";
    textEl.textContent = s.text || "";
    item.appendChild(textEl);

    const source = s.source || "auto";
    const badge = document.createElement("span");
    badge.className = "tg-voice-source-badge " + (source === "trained" ? "trained" : "auto");
    badge.textContent = source;
    item.appendChild(badge);

    const del = document.createElement("button");
    del.className = "tg-voice-delete-btn";
    del.title = "Remove this sample";
    del.textContent = "\u00D7"; // multiplication sign
    del.addEventListener("click", async () => {
      if (!s.timestamp) return;
      const resp = await chrome.runtime.sendMessage({
        type: "DELETE_VOICE_SAMPLE",
        timestamp: s.timestamp
      });
      if (resp && resp.ok) refreshVoiceProfile();
    });
    item.appendChild(del);

    voiceSamplesListEl.appendChild(item);
  }
}

function renderFingerprint(fingerprint) {
  if (!fingerprint || !fingerprint.text) {
    voiceFingerprintViewEl.textContent = "No profile generated yet \u2014 add 3+ trained samples and hit \"Regenerate style profile\".";
    return;
  }
  const updated = fingerprint.updatedAt
    ? new Date(fingerprint.updatedAt).toLocaleString()
    : "unknown";
  voiceFingerprintViewEl.textContent =
    "Generated " + updated + " from " + (fingerprint.sample_count || 0) + " samples\n\n" +
    fingerprint.text;
}

saveTrainingBtn.addEventListener("click", async () => {
  const samples = splitTrainingInput(voiceTrainingEl.value);
  if (!samples.length) {
    setVoiceStatus("Paste at least one sample (separated by blank lines).", "#e53935");
    return;
  }
  saveTrainingBtn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "TRAIN_VOICE", samples });
    if (!resp) throw new Error("no response from background");
    const parts = [];
    if (resp.accepted) parts.push(resp.accepted + " saved");
    if (resp.rejected) parts.push(resp.rejected + " rejected (too short or duplicate)");
    setVoiceStatus(parts.join(", "), resp.accepted ? "#4CAF50" : "#FF9800");
    voiceTrainingEl.value = "";
    refreshVoiceProfile();
  } catch (err) {
    setVoiceStatus("Couldn't save: " + (err.message || err), "#e53935");
  } finally {
    saveTrainingBtn.disabled = false;
  }
});

regenerateFingerprintBtn.addEventListener("click", async () => {
  regenerateFingerprintBtn.disabled = true;
  setVoiceStatus("Generating style profile\u2026", "#2196F3");
  try {
    // Fingerprint generation lives in the MCP server, not the service worker
    // (needs API access and the analyzer's Sonnet call). The extension's
    // service worker doesn't have that pipeline today; wire a
    // REGENERATE_FINGERPRINT message so users see the error path clearly
    // until the extension-side generator lands.
    const resp = await chrome.runtime.sendMessage({ type: "REGENERATE_FINGERPRINT" });
    if (resp && resp.ok) {
      setVoiceStatus("Style profile regenerated.", "#4CAF50");
      refreshVoiceProfile();
    } else {
      setVoiceStatus(
        (resp && resp.error) ||
          "Fingerprint generation is only available via the MCP server for now.",
        "#FF9800"
      );
    }
  } catch (err) {
    setVoiceStatus("Couldn't regenerate: " + (err.message || err), "#e53935");
  } finally {
    regenerateFingerprintBtn.disabled = false;
  }
});

// Initial load
refreshVoiceProfile();
