// Generated from src/sync/sync-client.js. Do not edit directly.

// ToneGuard sync client — talks to the Railway-hosted sync server.
// Replaces the old Supabase client. Same surface: authenticate/pull/push/subscribeToChanges.

const SYNC_SERVER_URL = "https://sync-server-production-3a24.up.railway.app";

class ToneGuardSyncClient {
  constructor(url) {
    this.url = url || SYNC_SERVER_URL;
    this.jwt = null;
    this.apiKeyHash = null;
  }

  /**
   * Authenticate using SHA-256 of the API key.
   * Returns a short-lived JWT scoped to this user_hash.
   */
  async authenticate(apiKeyHash) {
    this.apiKeyHash = apiKeyHash;
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
   * Fetch with a single re-auth retry on 401. The JWT expires after an hour;
   * without this, every pull/push after expiry fails until the client is
   * recreated (the poll loop would silently error forever).
   */
  async _request(path, options) {
    const doFetch = () =>
      fetch(this.url + path, Object.assign({}, options, { headers: this._authHeaders() }));
    let resp = await doFetch();
    if (resp.status === 401 && this.apiKeyHash) {
      await this.authenticate(this.apiKeyHash);
      resp = await doFetch();
    }
    return resp;
  }

  /**
   * Pull all sync data for the authenticated user.
   * Returns { decisions: {payload, version, updatedAt}, ... }.
   */
  async pull(_userHash) {
    if (!this.jwt) throw new Error("Sync client not authenticated");
    const resp = await this._request("/sync", {});
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
   * Push a single data type. Server increments version and broadcasts to
   * subscribers. Returns { ok, version, updated_at } so callers can adopt the
   * server-assigned version instead of guessing.
   */
  async push(_userHash, dataType, payload, version) {
    if (!this.jwt) throw new Error("Sync client not authenticated");
    const resp = await this._request("/sync", {
      method: "POST",
      body: JSON.stringify({
        data_type: dataType,
        payload: payload,
        version: version || 0
      })
    });
    if (!resp.ok) {
      throw new Error("Sync push failed: " + resp.status);
    }
    try {
      return await resp.json();
    } catch {
      return { ok: true };
    }
  }

  /**
   * Subscribe to realtime updates for this user via WebSocket.
   * Returns an object with close().
   */
  subscribeToChanges(_userHash, callback) {
    if (!this.jwt) throw new Error("Sync client not authenticated");

    // Reconnect with capped exponential backoff. A dropped socket (network
    // blip, server redeploy, heartbeat teardown) otherwise silently ends
    // realtime updates until app restart — the 5-min poll would be the only
    // fallback. Re-auth before reconnecting since the JWT may have expired.
    const RECONNECT_BASE_MS = 1000;
    const RECONNECT_MAX_MS = 60000;
    let ws = null;
    let closed = false;
    let attempt = 0;
    let reconnectTimer = null;
    const self = this;

    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        if (closed) return;
        if (self.apiKeyHash) {
          try {
            await self.authenticate(self.apiKeyHash);
          } catch {
            // Still offline — try again on the next backoff step.
            scheduleReconnect();
            return;
          }
        }
        connect();
      }, delay);
    };

    const connect = () => {
      if (closed) return;
      const wsUrl = self.url.replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(self.jwt);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        attempt = 0;
      };

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

      ws.onclose = () => {
        if (!closed) scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose fires after onerror; reconnect is scheduled there.
        try { ws.close(); } catch { /* already closed */ }
      };
    };

    connect();

    return {
      close() {
        closed = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        try { ws && ws.close(); } catch { /* already closed */ }
      }
    };
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.__toneGuardSyncClient = { ToneGuardSyncClient };
}
