BEGIN;

DROP TABLE IF EXISTS user_session_revocations;

DELETE FROM schema_migrations WHERE version = 8;
COMMIT;
