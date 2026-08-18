BEGIN;

-- Starting or reconnecting a connector previously overwrote the live,
-- working connector_connections row immediately (before the provider
-- callback ever confirmed anything), so an abandoned or failed reconnect
-- permanently lost the previously-working connection instead of just
-- failing to add a new one. The pending credential now lives here,
-- alongside the single-use nonce, and only gets promoted into
-- connector_connections by activateConnection() once the callback is
-- cryptographically verified.
ALTER TABLE oauth_nonces ADD COLUMN IF NOT EXISTS pending_payload jsonb;

INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
