BEGIN;

CREATE TABLE IF NOT EXISTS request_rate_limits (
  namespace text NOT NULL,
  client_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (namespace, client_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_request_rate_limits_expires_at
  ON request_rate_limits (expires_at);

INSERT INTO schema_migrations (version) VALUES (5)
ON CONFLICT (version) DO NOTHING;

COMMIT;
