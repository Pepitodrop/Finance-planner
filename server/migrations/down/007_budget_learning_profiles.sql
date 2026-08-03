BEGIN;

DROP TABLE IF EXISTS user_budget_learning_profiles;

DELETE FROM schema_migrations WHERE version = 7;
COMMIT;
