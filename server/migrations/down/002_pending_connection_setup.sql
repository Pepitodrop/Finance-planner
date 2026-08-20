BEGIN;

ALTER TABLE oauth_nonces DROP COLUMN IF EXISTS pending_payload;

DELETE FROM schema_migrations WHERE version = 2;
COMMIT;
