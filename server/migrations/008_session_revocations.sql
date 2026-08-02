BEGIN;

CREATE TABLE IF NOT EXISTS user_session_revocations (
  session_key text PRIMARY KEY,
  revoked_before timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_session_revocations_updated_at_idx
  ON user_session_revocations (updated_at);

INSERT INTO schema_migrations (version) VALUES (8) ON CONFLICT DO NOTHING;
COMMIT;
