BEGIN;

CREATE TABLE IF NOT EXISTS user_budget_learning_profiles (
  user_id text PRIMARY KEY,
  encrypted_payload jsonb NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES (7) ON CONFLICT DO NOTHING;
COMMIT;
