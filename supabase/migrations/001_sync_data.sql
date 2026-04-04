-- ToneGuard sync table: stores learning data per user per data type.
-- User identity is SHA-256 hash of their Anthropic API key.

CREATE TABLE sync_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_hash TEXT NOT NULL,
  data_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_hash, data_type)
);

CREATE INDEX idx_sync_data_user_hash ON sync_data (user_hash);

-- Row Level Security: users only see their own rows.
ALTER TABLE sync_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_data" ON sync_data
  FOR SELECT
  USING (user_hash = current_setting('request.jwt.claims', true)::json ->> 'user_hash');

CREATE POLICY "users_write_own_data" ON sync_data
  FOR ALL
  USING (user_hash = current_setting('request.jwt.claims', true)::json ->> 'user_hash')
  WITH CHECK (user_hash = current_setting('request.jwt.claims', true)::json ->> 'user_hash');

-- Enable Realtime for this table.
ALTER PUBLICATION supabase_realtime ADD TABLE sync_data;
