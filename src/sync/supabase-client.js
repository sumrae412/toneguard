// ToneGuard Supabase client — thin wrapper for sync backend.
// Requires SUPABASE_URL and SUPABASE_ANON_KEY to be configured.

const SUPABASE_URL = "https://jimjfaaaccqtcbbxsrys.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NyUr9I9amTiVVWT5H8ysvg_lB054qK0";
const TABLE = "sync_data";

/**
 * Lightweight Supabase client using fetch (no SDK dependency).
 * Keeps the extension lean — no npm packages needed.
 */
class ToneGuardSupabase {
  constructor(url, anonKey) {
    this.url = url || SUPABASE_URL;
    this.anonKey = anonKey || SUPABASE_ANON_KEY;
    this.jwt = null;
  }

  /**
   * Authenticate using API key hash.
   * Calls the auth-by-hash Edge Function to get a short-lived JWT.
   */
  async authenticate(apiKeyHash) {
    const resp = await fetch(this.url + "/functions/v1/auth-by-hash", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + this.anonKey
      },
      body: JSON.stringify({ hash: apiKeyHash })
    });

    if (!resp.ok) {
      throw new Error("Sync auth failed: " + resp.status);
    }

    const data = await resp.json();
    this.jwt = data.token;
    return this.jwt;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      "apikey": this.anonKey,
      "Authorization": "Bearer " + (this.jwt || this.anonKey)
    };
  }

  /**
   * Pull all sync data for a user hash.
   * Returns { decisions: {...}, voice_samples: {...}, ... }
   */
  async pull(userHash) {
    const params = new URLSearchParams({
      user_hash: "eq." + userHash,
      select: "data_type,payload,version,updated_at"
    });

    const resp = await fetch(
      this.url + "/rest/v1/" + TABLE + "?" + params.toString(),
      { headers: this._headers() }
    );

    if (!resp.ok) {
      throw new Error("Sync pull failed: " + resp.status);
    }

    const rows = await resp.json();
    const result = {};
    for (const row of rows) {
      result[row.data_type] = {
        payload: row.payload,
        version: row.version,
        updatedAt: row.updated_at
      };
    }
    return result;
  }

  /**
   * Push a single data type. Uses upsert with version check.
   */
  async push(userHash, dataType, payload, version) {
    const resp = await fetch(
      this.url + "/rest/v1/" + TABLE,
      {
        method: "POST",
        headers: {
          ...this._headers(),
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          user_hash: userHash,
          data_type: dataType,
          payload: payload,
          version: (version || 0) + 1,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!resp.ok) {
      throw new Error("Sync push failed: " + resp.status);
    }
  }

  /**
   * Subscribe to Realtime changes for a user hash.
   * Uses Supabase Realtime over WebSocket.
   */
  subscribeToChanges(userHash, callback) {
    const wsUrl = this.url.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=" + this.anonKey;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Join the channel filtered by user_hash
      ws.send(JSON.stringify({
        topic: "realtime:" + TABLE + ":user_hash=eq." + userHash,
        event: "phx_join",
        payload: { config: { broadcast: { self: false } } },
        ref: "1"
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "INSERT" || msg.event === "UPDATE") {
          const record = msg.payload?.record;
          if (record && record.data_type) {
            callback(record.data_type, record.payload);
          }
        }
      } catch {
        // Ignore parse errors from heartbeats etc.
      }
    };

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          topic: "phoenix",
          event: "heartbeat",
          payload: {},
          ref: Date.now().toString()
        }));
      }
    }, 30000);

    return {
      close() {
        clearInterval(heartbeat);
        ws.close();
      }
    };
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardSupabase = { ToneGuardSupabase };
}
