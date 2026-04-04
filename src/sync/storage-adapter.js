// ToneGuard storage adapters — unified interface for Chrome extension and PWA.
// Both adapters implement: get(key), set(key, value), getAll(keys)

/**
 * Chrome extension adapter — wraps chrome.storage.local.
 */
class ChromeStorageAdapter {
  async get(key) {
    const result = await chrome.storage.local.get([key]);
    return result[key] ?? null;
  }

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  async getAll(keys) {
    const result = await chrome.storage.local.get(keys);
    return result;
  }
}

/**
 * Web/PWA adapter — wraps localStorage with JSON serialization.
 */
class WebStorageAdapter {
  async get(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async getAll(keys) {
    const result = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
}

/**
 * Detect platform and return the right adapter.
 */
function createStorageAdapter() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return new ChromeStorageAdapter();
  }
  return new WebStorageAdapter();
}

if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardStorage = {
    ChromeStorageAdapter,
    WebStorageAdapter,
    createStorageAdapter
  };
}
