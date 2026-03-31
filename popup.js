const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const enabledToggle = document.getElementById("enabled");
const keyDot = document.getElementById("keyDot");
const keyLabel = document.getElementById("keyLabel");
const strictnessSlider = document.getElementById("strictness");
const strictnessLabel = document.getElementById("strictnessLabel");
const siteListEl = document.getElementById("siteList");
const newSiteInput = document.getElementById("newSite");
const addSiteBtn = document.getElementById("addSiteBtn");

const BUILT_IN_SITES = [
  "app.slack.com",
  "mail.google.com",
  "www.linkedin.com",
  "*.turbotenant.com"
];

// Load saved settings
const STRICTNESS_LABELS = { 1: "Gentle", 2: "Balanced", 3: "Strict" };

chrome.storage.sync.get(["tg_api_key", "tg_enabled", "tg_custom_sites", "tg_strictness"], (result) => {
  if (result.tg_api_key) {
    apiKeyInput.value = result.tg_api_key;
    keyDot.classList.add("active");
    keyLabel.textContent = "API key saved";
  } else {
    keyDot.classList.add("missing");
    keyLabel.textContent = "No API key set";
  }

  enabledToggle.checked = result.tg_enabled !== false;

  const strictVal = result.tg_strictness || 2;
  strictnessSlider.value = strictVal;
  strictnessLabel.textContent = STRICTNESS_LABELS[strictVal];

  renderSiteList(result.tg_custom_sites || []);
});

// Save API key
saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    statusEl.textContent = "Please enter an API key";
    statusEl.className = "status error";
    return;
  }

  if (!key.startsWith("sk-ant-")) {
    statusEl.textContent = "Key should start with sk-ant-";
    statusEl.className = "status error";
    return;
  }

  chrome.storage.sync.set({ tg_api_key: key }, () => {
    statusEl.textContent = "Saved! Syncs across your devices.";
    statusEl.className = "status saved";
    keyDot.className = "dot active";
    keyLabel.textContent = "API key saved";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  });
});

// Toggle enabled/disabled
enabledToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ tg_enabled: enabledToggle.checked });
});

// Strictness slider
strictnessSlider.addEventListener("input", () => {
  const val = parseInt(strictnessSlider.value);
  strictnessLabel.textContent = STRICTNESS_LABELS[val];
  chrome.storage.sync.set({ tg_strictness: val });
});

// Render site list
function renderSiteList(customSites) {
  siteListEl.textContent = "";

  // Built-in sites
  BUILT_IN_SITES.forEach((site) => {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = site;
    li.appendChild(name);

    const badge = document.createElement("span");
    badge.className = "built-in";
    badge.textContent = "built-in";
    li.appendChild(badge);

    siteListEl.appendChild(li);
  });

  // Custom sites
  customSites.forEach((site) => {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = site;
    li.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "\u00d7";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => removeSite(site));
    li.appendChild(removeBtn);

    siteListEl.appendChild(li);
  });
}

// Add custom site
addSiteBtn.addEventListener("click", addSite);
newSiteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

function addSite() {
  let site = newSiteInput.value.trim().toLowerCase();
  if (!site) return;

  // Clean up: remove protocol and trailing slashes
  site = site.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  if (!site.includes(".")) {
    return; // not a valid domain
  }

  chrome.storage.sync.get(["tg_custom_sites"], (result) => {
    const sites = result.tg_custom_sites || [];
    if (sites.includes(site)) return; // already added

    sites.push(site);
    chrome.storage.sync.set({ tg_custom_sites: sites }, () => {
      renderSiteList(sites);
      newSiteInput.value = "";

      // Register content script for the new site
      chrome.runtime.sendMessage({
        type: "REGISTER_SITE",
        site: site
      });
    });
  });
}

// Remove custom site
function removeSite(site) {
  chrome.storage.sync.get(["tg_custom_sites"], (result) => {
    const sites = (result.tg_custom_sites || []).filter((s) => s !== site);
    chrome.storage.sync.set({ tg_custom_sites: sites }, () => {
      renderSiteList(sites);

      // Unregister content script for the site
      chrome.runtime.sendMessage({
        type: "UNREGISTER_SITE",
        site: site
      });
    });
  });
}
