// ToneGuard SyncManager — orchestrates local-first sync with Supabase.
// Init with API key → auto-pairs via hash → pull/push/subscribe.

const DATA_TYPES = ["decisions", "voice_samples", "relationships", "custom_rules", "stats_history"];

const STORAGE_KEYS = {
  decisions: "tg_decisions",
  voice_samples: "tg_voice_samples",
  relationships: "tg_relationships",
  custom_rules: "tg_custom_rules",
  stats_history: "tg_stats_history"
};

const DEBOUNCE_MS = 5000;
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class SyncManager {
  constructor(storage, supabase, merge) {
    this.storage = storage;
    this.supabase = supabase;
    this.merge = merge;
    this.userHash = null;
    this.remoteVersions = {};
    this.pendingPush = new Set();
    this.debounceTimer = null;
    this.pollTimer = null;
    this.subscription = null;
    this.onConflict = null; // callback for custom rules conflict notification
    this.lastSyncAt = null;
  }

  /**
   * Initialize sync: hash the API key, authenticate, pull, subscribe.
   */
  async init(apiKey) {
    if (!apiKey) return;

    this.userHash = await hashApiKey(apiKey);

    try {
      await this.supabase.authenticate(this.userHash);
      await this.pull();
      this._startSubscription();
      this._startPolling();
    } catch (err) {
      console.error("ToneGuard sync init failed:", err.message);
      // Sync is optional — app works offline without it
    }
  }

  /**
   * Pull all remote data and merge with local.
   */
  async pull() {
    if (!this.userHash) return;

    let remoteData;
    try {
      remoteData = await this.supabase.pull(this.userHash);
    } catch (err) {
      console.error("ToneGuard sync pull failed:", err.message);
      return;
    }

    for (const dataType of DATA_TYPES) {
      const remote = remoteData[dataType];
      if (!remote) continue;

      this.remoteVersions[dataType] = remote.version;
      const storageKey = STORAGE_KEYS[dataType];
      const localData = await this.storage.get(storageKey);

      const merged = this._merge(dataType, localData, remote.payload);

      if (merged !== undefined) {
        await this.storage.set(storageKey, merged);
      }
    }

    this.lastSyncAt = new Date().toISOString();
  }

  /**
   * Mark a data type as dirty and schedule a debounced push.
   */
  schedulePush(dataType) {
    this.pendingPush.add(dataType);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => this._flushPush(), DEBOUNCE_MS);
  }

  /**
   * Push all pending data types to Supabase.
   */
  async _flushPush() {
    if (!this.userHash) return;

    const types = [...this.pendingPush];
    this.pendingPush.clear();

    for (const dataType of types) {
      try {
        const storageKey = STORAGE_KEYS[dataType];
        let payload = await this.storage.get(storageKey);

        // For custom_rules, wrap with updatedAt for LWW
        if (dataType === "custom_rules" && typeof payload === "string") {
          payload = { rules: payload, updatedAt: new Date().toISOString() };
        }

        const version = this.remoteVersions[dataType] || 0;
        await this.supabase.push(this.userHash, dataType, payload, version);
        this.remoteVersions[dataType] = version + 1;
      } catch (err) {
        console.error("ToneGuard sync push failed for " + dataType + ":", err.message);
        // Re-queue for next attempt
        this.pendingPush.add(dataType);
      }
    }

    this.lastSyncAt = new Date().toISOString();
  }

  /**
   * Apply the correct merge strategy for a data type.
   */
  _merge(dataType, local, remote) {
    switch (dataType) {
      case "decisions":
        return this.merge.mergeDecisions(local, remote);
      case "voice_samples":
        return this.merge.mergeVoiceSamples(local, remote);
      case "relationships":
        return this.merge.mergeRelationships(local, remote);
      case "custom_rules": {
        const localWrapped = typeof local === "string"
          ? { rules: local, updatedAt: "" }
          : (local || { rules: "", updatedAt: "" });
        const remoteWrapped = remote || { rules: "", updatedAt: "" };
        const result = this.merge.mergeCustomRules(localWrapped, remoteWrapped);
        if (result.source === "remote" && this.onConflict) {
          this.onConflict("custom_rules", "Rules updated from another device");
        }
        return result.rules;
      }
      case "stats_history":
        return this.merge.mergeStatsHistory(local, remote);
      default:
        return remote;
    }
  }

  /**
   * Subscribe to Realtime changes from other devices.
   */
  _startSubscription() {
    if (this.subscription) {
      this.subscription.close();
    }

    this.subscription = this.supabase.subscribeToChanges(
      this.userHash,
      async (dataType, payload) => {
        const storageKey = STORAGE_KEYS[dataType];
        if (!storageKey) return;

        const localData = await this.storage.get(storageKey);
        const merged = this._merge(dataType, localData, payload);

        if (merged !== undefined) {
          await this.storage.set(storageKey, merged);
        }
      }
    );
  }

  /**
   * Periodic full sync as fallback for missed Realtime events.
   */
  _startPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(() => this.pull(), POLL_INTERVAL_MS);
  }

  /**
   * Clean shutdown.
   */
  destroy() {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

/**
 * Hash an API key using SHA-256. Returns hex string.
 * The raw key never leaves the device.
 */
async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardSync = { SyncManager, hashApiKey };
}
