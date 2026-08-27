BEGIN;

DROP TABLE IF EXISTS connector_account_exclusions;

DELETE FROM schema_migrations WHERE version = 11;
COMMIT;
