// Tests for src/sync/sync-client.js — JWT re-auth on 401 and WebSocket
// reconnect. The client is a classic script that registers itself on
// globalThis (PWA/extension can't use ESM here).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "../src/sync/sync-client.js";

const { ToneGuardSyncClient } = globalThis.__toneGuardSyncClient;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  close() {
    if (this.onclose) this.onclose();
  }
}
FakeWebSocket.instances = [];

describe("ToneGuardSyncClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("authenticate stores the jwt and the api key hash for later re-auth", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { token: "jwt-1" })));
    const client = new ToneGuardSyncClient("https://sync.test");
    await client.authenticate("a".repeat(64));
    expect(client.jwt).toBe("jwt-1");
    expect(client.apiKeyHash).toBe("a".repeat(64));
  });

  it("pull re-authenticates once on 401 and retries", async () => {
    let authCount = 0;
    let syncCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/auth")) {
        authCount += 1;
        return jsonResponse(200, { token: "jwt-" + authCount });
      }
      syncCount += 1;
      // First /sync call hits an expired JWT; the retry succeeds.
      if (syncCount === 1) return jsonResponse(401, { error: "Unauthorized" });
      return jsonResponse(200, [
        { data_type: "decisions", payload: [], version: 3, updated_at: "2026-01-01T00:00:00Z" }
      ]);
    }));

    const client = new ToneGuardSyncClient("https://sync.test");
    await client.authenticate("b".repeat(64));
    const result = await client.pull("ignored");

    expect(authCount).toBe(2); // initial + re-auth
    expect(syncCount).toBe(2); // 401 then success
    expect(client.jwt).toBe("jwt-2");
    expect(result.decisions.version).toBe(3);
  });

  it("push returns the server-assigned version", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/auth")) return jsonResponse(200, { token: "jwt-1" });
      return jsonResponse(200, { ok: true, version: 7, updated_at: "2026-01-01T00:00:00Z" });
    }));

    const client = new ToneGuardSyncClient("https://sync.test");
    await client.authenticate("c".repeat(64));
    const pushed = await client.push("ignored", "decisions", [], 5);
    expect(pushed.version).toBe(7);
  });

  it("subscribeToChanges reconnects with a fresh token after the socket drops", async () => {
    vi.useFakeTimers();
    let authCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      authCount += 1;
      return jsonResponse(200, { token: "jwt-" + authCount });
    }));

    const client = new ToneGuardSyncClient("https://sync.test");
    await client.authenticate("d".repeat(64));

    const events = [];
    client.subscribeToChanges("ignored", (dataType, payload) => events.push([dataType, payload]));
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Deliver a message through the live socket.
    FakeWebSocket.instances[0].onmessage({
      data: JSON.stringify({ event: "UPDATE", data_type: "decisions", payload: [1] })
    });
    expect(events).toEqual([["decisions", [1]]]);

    // Drop the socket: a reconnect should be scheduled (1s backoff) and
    // re-authenticate before opening a new socket.
    FakeWebSocket.instances[0].onclose();
    await vi.advanceTimersByTimeAsync(1100);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(authCount).toBe(2);
    expect(FakeWebSocket.instances[1].url).toContain("jwt-2");
  });

  it("close() stops reconnect attempts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { token: "jwt-1" })));

    const client = new ToneGuardSyncClient("https://sync.test");
    await client.authenticate("e".repeat(64));

    const sub = client.subscribeToChanges("ignored", () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);

    sub.close();
    await vi.advanceTimersByTimeAsync(120000);
    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect after close
  });
});
