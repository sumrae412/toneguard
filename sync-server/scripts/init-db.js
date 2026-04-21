// One-shot: create the sync_data table on the Railway Postgres.
// Run with: DATABASE_URL=... node scripts/init-db.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

try {
  await pool.query(sql);
  console.log("Schema applied.");
} finally {
  await pool.end();
}
