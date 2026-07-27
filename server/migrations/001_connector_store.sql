BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version bigint PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connector_connections (
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gocardless', 'finapi', 'paypal')),
  encrypted_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS oauth_nonces (
  nonce_hash text PRIMARY KEY,
  consent_id text NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gocardless', 'finapi', 'paypal')),
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_nonces_expiry_idx ON oauth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  lease_token text,
  lease_until timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS webhook_events_lease_idx ON webhook_events (lease_until) WHERE completed_at IS NULL;

INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
