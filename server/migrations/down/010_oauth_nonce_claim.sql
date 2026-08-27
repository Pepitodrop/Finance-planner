BEGIN;

ALTER TABLE oauth_nonces DROP COLUMN IF EXISTS claim_token;

DELETE FROM schema_migrations WHERE version = 10;
COMMIT;
