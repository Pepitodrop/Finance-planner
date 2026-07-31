BEGIN;

CREATE TABLE IF NOT EXISTS user_finance_state (
  user_id text PRIMARY KEY,
  encrypted_payload jsonb NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_store (
  id smallint PRIMARY KEY CHECK (id = 1),
  encrypted_payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES (6) ON CONFLICT DO NOTHING;
COMMIT;
