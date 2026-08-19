BEGIN;

ALTER TABLE connector_connections DROP CONSTRAINT IF EXISTS connector_connections_provider_check;
ALTER TABLE connector_connections ADD CONSTRAINT connector_connections_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal'));

ALTER TABLE oauth_nonces DROP CONSTRAINT IF EXISTS oauth_nonces_provider_check;
ALTER TABLE oauth_nonces ADD CONSTRAINT oauth_nonces_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal'));

DELETE FROM schema_migrations WHERE version = 9;
COMMIT;
