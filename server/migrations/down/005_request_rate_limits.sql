BEGIN;

DROP TABLE IF EXISTS request_rate_limits;

DELETE FROM schema_migrations WHERE version = 5;
COMMIT;
