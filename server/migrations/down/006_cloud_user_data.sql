BEGIN;

DROP TABLE IF EXISTS auth_store;
DROP TABLE IF EXISTS user_finance_state;

DELETE FROM schema_migrations WHERE version = 6;
COMMIT;
