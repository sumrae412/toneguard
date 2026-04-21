// ToneGuard sync client — talks to the Railway-hosted sync server.
// Replaces the old Supabase client. Same surface: authenticate/pull/push/subscribeToChanges.

const SYNC_SERVER_URL = "https://toneguard-sync.up.railway.app";

class ToneGuardSyncClient {
  constructor(url) {
    this.url = url || SYNC_SERVER_URL;
    this.jwt = null;
  }

  /**
   * Authenticate using SHA-256 of the API key.
   * Returns a short-lived JWT scoped to this user_hash.
   */
  async authenticate(apiKeyHash) {
    const resp = await fetch(this.url + "/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: apiKeyHash })
    });
    if (!resp.ok) {
      throw new Error("Sync auth failed: " + resp.status);
    }
    const data = await resp.json();
    this.jwt = data.token;
    return this.jwt;
  }

  _authHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + this.jwt
    };
  }

  /**
   * Pull all sync data for the authenticated user.
   * Returns { decisions: {payload, version, updatedAt}, ... }.
   */
  async pull(_userHash) {
    if (!this.jwt) throw new Error("Sync client not authenticated");
    const resp = await fetch(this.url + "/sync", { headers: this._authHeaders() });
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
   * Push a single data type. Server increments version and broadcasts to subscribers.
   */
  async push(_userHash, dataType, payload, version) {
    if (!this.jwt) throw new Error("Sync client not authenticated");
    const resp = await fetch(this.url + "/sync", {
      method: "POST",
      headers: this._authHeaders(),
      body: JSON.stringify({
        data_type: dataType,
        payload: payload,
        version: version || 0
      })
    });
    if (!resp.ok) {
      throw new Error("Sync push failed: " + resp.status);
    }
  }

  /**
   * Subscribe to realtime updates for this user via WebSocket.
   * Returns an object with close().
   */
  subscribeToChanges(_userHash, callback) {
    if (!this.jwt) throw new Error("Sync client not authenticated");
    const wsUrl = this.url.replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(this.jwt);
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "UPDATE" && msg.data_type) {
          callback(msg.data_type, msg.payload);
        }
      } catch {
        // Ignore parse errors.
      }
    };

    return {
      close() {
        try { ws.close(); } catch { /* already closed */ }
      }
    };
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardSyncClient = { ToneGuardSyncClient };
}
