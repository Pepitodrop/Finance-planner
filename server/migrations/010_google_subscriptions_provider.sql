BEGIN;

-- Google Subscriptions uses the shared connector store for its OAuth setup
-- and connection state, so both provider allow-lists must accept it.
ALTER TABLE connector_connections DROP CONSTRAINT IF EXISTS connector_connections_provider_check;
ALTER TABLE connector_connections ADD CONSTRAINT connector_connections_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking', 'google-subscriptions'));

ALTER TABLE oauth_nonces DROP CONSTRAINT IF EXISTS oauth_nonces_provider_check;
ALTER TABLE oauth_nonces ADD CONSTRAINT oauth_nonces_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal', 'enablebanking', 'google-subscriptions'));

INSERT INTO schema_migrations (version) VALUES (10) ON CONFLICT DO NOTHING;
COMMIT;
