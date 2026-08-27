BEGIN;

-- Durable, connection-independent record of a user's decision to exclude one
-- stable provider account from future syncs (Dashboard "Remove account",
-- PR #154). Previously stored as excludedStableAccountIds inside the live
-- connector_connections row -- found by independent review (2026-08-27) to
-- directly violate the explicit requirement that a removed account survive
-- a full disconnect + reconnect of the same economic bank account, since
-- disconnecting deletes the whole connector_connections row. Keyed only by
-- the server-derived HMAC stable_account_id (see providers.js's
-- stableAccountId()), never a raw IBAN/account number. account_name is a
-- non-sensitive display label (e.g. "Savings account"), captured at removal
-- time, so the Connections page can render a friendly "Restore" list
-- without needing to re-derive or store anything account-number-shaped.
CREATE TABLE IF NOT EXISTS connector_account_exclusions (
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking')),
  stable_account_id text NOT NULL CHECK (stable_account_id ~ '^[a-f0-9]{64}$'),
  account_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, stable_account_id)
);

INSERT INTO schema_migrations (version) VALUES (11) ON CONFLICT DO NOTHING;
COMMIT;
