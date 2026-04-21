// ToneGuard sync server — Express + ws + Postgres.
// Deployed to Railway. Replaces Supabase sync_data table + auth-by-hash function.

import express from "express";
import { WebSocketServer } from "ws";
import pg from "pg";
import crypto from "node:crypto";
import http from "node:http";

const PORT = process.env.PORT || 8080;
const JWT_SECRET = requireEnv("JWT_SECRET");
const DATABASE_URL = requireEnv("DATABASE_URL");
const JWT_EXPIRY_SECONDS = 3600;

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// In-memory fan-out: user_hash -> Set<WebSocket>.
// Single Railway instance, so in-process is sufficient. If scaled to multiple
// replicas, swap for Postgres LISTEN/NOTIFY.
const subscribers = new Map();

function addSubscriber(userHash, ws) {
  let set = subscribers.get(userHash);
  if (!set) {
    set = new Set();
    subscribers.set(userHash, set);
  }
  set.add(ws);
}

function removeSubscriber(userHash, ws) {
  const set = subscribers.get(userHash);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subscribers.delete(userHash);
}

function broadcast(userHash, message) {
  const set = subscribers.get(userHash);
  if (!set) return;
  const msg = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(msg);
      } catch {
        // Socket died between check and send; will be cleaned up by 'close' handler.
      }
    }
  }
}

// ── Routes ──

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/auth", (req, res) => {
  const { hash } = req.body ?? {};
  if (!hash || typeof hash !== "string" || hash.length !== 64) {
    return res.status(400).json({ error: "Invalid hash" });
  }
  const token = signJwt({ user_hash: hash }, JWT_SECRET, JWT_EXPIRY_SECONDS);
  res.json({ token });
});

app.get("/sync", async (req, res) => {
  const claims = verifyBearer(req);
  if (!claims) return res.status(401).json({ error: "Unauthorized" });

  const { rows } = await pool.query(
    "SELECT data_type, payload, version, updated_at FROM sync_data WHERE user_hash = $1",
    [claims.user_hash]
  );
  res.json(
    rows.map((r) => ({
      data_type: r.data_type,
      payload: r.payload,
      version: r.version,
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    }))
  );
});

app.post("/sync", async (req, res) => {
  const claims = verifyBearer(req);
  if (!claims) return res.status(401).json({ error: "Unauthorized" });

  const { data_type: dataType, payload, version } = req.body ?? {};
  if (!dataType || typeof dataType !== "string") {
    return res.status(400).json({ error: "data_type required" });
  }
  if (payload === undefined) {
    return res.status(400).json({ error: "payload required" });
  }

  const newVersion = (typeof version === "number" ? version : 0) + 1;
  const updatedAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO sync_data (user_hash, data_type, payload, version, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_hash, data_type) DO UPDATE SET
       payload = EXCLUDED.payload,
       version = EXCLUDED.version,
       updated_at = EXCLUDED.updated_at`,
    [claims.user_hash, dataType, payload, newVersion, updatedAt]
  );

  broadcast(claims.user_hash, {
    event: "UPDATE",
    data_type: dataType,
    payload,
    version: newVersion,
    updated_at: updatedAt,
  });

  res.json({ ok: true, version: newVersion, updated_at: updatedAt });
});

// ── HTTP + WebSocket server ──

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const token = url.searchParams.get("token");
  const claims = token ? verifyJwt(token, JWT_SECRET) : null;
  if (!claims) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userHash = claims.user_hash;
    addSubscriber(claims.user_hash, ws);
    ws.on("close", () => removeSubscriber(claims.user_hash, ws));
    ws.on("error", () => removeSubscriber(claims.user_hash, ws));
  });
});

// Periodic WS liveness check — drop zombies, keep fan-out set accurate.
const HEARTBEAT_MS = 30000;
setInterval(() => {
  for (const set of subscribers.values()) {
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.ping();
        } catch {
          // ignore; close handler will clean up
        }
      }
    }
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  console.log(`toneguard-sync listening on :${PORT}`);
});

// ── Helpers ──

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function verifyBearer(req) {
  const auth = req.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return verifyJwt(auth.slice(7), JWT_SECRET);
}

// ── JWT (HS256) ──

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function signJwt(payload, secret, expirySeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = { ...payload, iat: now, exp: now + expirySeconds };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
}

function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = base64urlDecode(sigB64);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }
  let claims;
  try {
    claims = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!claims.user_hash || typeof claims.user_hash !== "string") return null;
  if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return { user_hash: claims.user_hash };
}
