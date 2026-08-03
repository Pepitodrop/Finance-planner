BEGIN;

DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS oauth_nonces;
DROP TABLE IF EXISTS connector_connections;

DELETE FROM schema_migrations WHERE version = 1;
COMMIT;
