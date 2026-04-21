-- ToneGuard sync table (Postgres, Railway-managed).
-- Replaces Supabase sync_data. Auth enforced at server layer via JWT — no RLS.

CREATE TABLE IF NOT EXISTS sync_data (
  user_hash   TEXT NOT NULL,
  data_type   TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_hash, data_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_data_user_hash ON sync_data (user_hash);
