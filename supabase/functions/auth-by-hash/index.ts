// Supabase Edge Function: authenticate by API key hash.
// Receives { hash: "sha256hex" }, returns a short-lived JWT with user_hash claim.
// The raw API key never reaches the server.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { create } from "https://deno.land/x/djwt@v2.8/mod.ts";

const JWT_SECRET = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || "";
const JWT_EXPIRY_SECONDS = 3600; // 1 hour

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const { hash } = await req.json();

    if (!hash || typeof hash !== "string" || hash.length !== 64) {
      return new Response(JSON.stringify({ error: "Invalid hash" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const token = await create(
      { alg: "HS256", typ: "JWT" },
      {
        user_hash: hash,
        role: "authenticated",
        iat: now,
        exp: now + JWT_EXPIRY_SECONDS,
      },
      key
    );

    return new Response(JSON.stringify({ token }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
