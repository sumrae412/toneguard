// One-shot: copy all sync_data rows from Supabase to Railway Postgres.
// Run once after Railway is deployed and before switching clients.
//
// Env:
//   SUPABASE_URL       — e.g. https://jimjfaaaccqtcbbxsrys.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase project settings (NOT the anon key)
//   DATABASE_URL       — Railway Postgres URL

import pg from "pg";

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const DATABASE_URL = requireEnv("DATABASE_URL");

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function main() {
  console.log("Fetching rows from Supabase...");
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/sync_data?select=user_hash,data_type,payload,version,updated_at`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    }
  );
  if (!resp.ok) {
    throw new Error(`Supabase fetch failed: ${resp.status} ${await resp.text()}`);
  }
  const rows = await resp.json();
  console.log(`Fetched ${rows.length} rows.`);

  let inserted = 0;
  for (const r of rows) {
    await pool.query(
      `INSERT INTO sync_data (user_hash, data_type, payload, version, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_hash, data_type) DO UPDATE SET
         payload = EXCLUDED.payload,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at`,
      [r.user_hash, r.data_type, r.payload, r.version, r.updated_at]
    );
    inserted++;
  }
  console.log(`Inserted/updated ${inserted} rows.`);
}

try {
  await main();
} finally {
  await pool.end();
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
