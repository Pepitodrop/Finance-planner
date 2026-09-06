BEGIN;

ALTER TABLE connector_connections DROP CONSTRAINT IF EXISTS connector_connections_provider_check;
ALTER TABLE connector_connections ADD CONSTRAINT connector_connections_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking'));

ALTER TABLE oauth_nonces DROP CONSTRAINT IF EXISTS oauth_nonces_provider_check;
ALTER TABLE oauth_nonces ADD CONSTRAINT oauth_nonces_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking'));

DELETE FROM schema_migrations WHERE version = 10;
COMMIT;
