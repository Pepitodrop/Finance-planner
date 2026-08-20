BEGIN;

-- Intentionally fails (transaction aborts, nothing is rolled back) if any
-- row with provider='enablebanking' still exists in either table -- Postgres
-- validates existing rows against a re-added CHECK constraint, and this
-- narrower one no longer allows that value. That's the correct, safe
-- behavior: silently deleting a user's live bank connection to force the
-- schema downgrade through would be worse than refusing the rollback.
-- Disconnect/remove any enablebanking rows first if a genuine downgrade is
-- needed.
ALTER TABLE connector_connections DROP CONSTRAINT IF EXISTS connector_connections_provider_check;
ALTER TABLE connector_connections ADD CONSTRAINT connector_connections_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal'));

ALTER TABLE oauth_nonces DROP CONSTRAINT IF EXISTS oauth_nonces_provider_check;
ALTER TABLE oauth_nonces ADD CONSTRAINT oauth_nonces_provider_check
  CHECK (provider IN ('gocardless', 'finapi', 'paypal'));

DELETE FROM schema_migrations WHERE version = 9;
COMMIT;
