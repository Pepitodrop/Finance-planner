import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL('../migrations/010_google_subscriptions_provider.sql', import.meta.url), 'utf8')
const rollback = await readFile(new URL('../migrations/down/010_google_subscriptions_provider.sql', import.meta.url), 'utf8')

test('Google Subscriptions is accepted by every shared connector provider constraint', () => {
  assert.equal((migration.match(/'google-subscriptions'/g) || []).length, 2)
  assert.match(migration, /ALTER TABLE connector_connections/)
  assert.match(migration, /ALTER TABLE oauth_nonces/)
  assert.match(migration, /VALUES \(10\)/)
})

test('Google Subscriptions migration has a matching rollback', () => {
  assert.doesNotMatch(rollback, /google-subscriptions/)
  assert.match(rollback, /DELETE FROM schema_migrations WHERE version = 10/)
})
