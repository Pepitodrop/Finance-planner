BEGIN;

-- Adds Enable Banking as a registered provider. Postgres has no ALTER CHECK,
-- so the provider allow-list constraint on both tables that reference it has
-- to be dropped and re-added. Constraint names below are Postgres's default
-- auto-generated names from migration 001 (<table>_<column>_check).
ALTER TABLE connector_connections DROP CONSTRAINT IF EXISTS connector_connections_provider_check;
ALTER TABLE connector_connections ADD CONSTRAINT connector_connections_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking'));

ALTER TABLE oauth_nonces DROP CONSTRAINT IF EXISTS oauth_nonces_provider_check;
ALTER TABLE oauth_nonces ADD CONSTRAINT oauth_nonces_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking'));

INSERT INTO schema_migrations (version) VALUES (9) ON CONFLICT DO NOTHING;
COMMIT;
