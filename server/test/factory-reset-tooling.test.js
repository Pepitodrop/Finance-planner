import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptUrl = new URL('../scripts/factory-reset.mjs', import.meta.url)
const source = await readFile(scriptUrl, 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('factory reset is valid Node syntax and requires explicit destructive confirmation', async () => {
  await execFileAsync(process.execPath, ['--check', fileURLToPath(scriptUrl)])
  assert.equal(packageJson.scripts['factory-reset'], 'node scripts/factory-reset.mjs')
  assert.match(source, /DELETE_ALL_FINANCE_PLANNER_DATA/)
  assert.match(source, /FACTORY_RESET_CONFIRM/)
  assert.match(source, /AUTH_MODE=local/)
})

test('factory reset clears every application-data table but preserves schema history', () => {
  for (const table of [
    'webhook_events',
    'oauth_nonces',
    'connector_connections',
    'user_budget_learning_profiles',
    'user_finance_state',
    'user_session_revocations',
    'request_rate_limits',
    'auth_store',
  ]) {
    assert.match(source, new RegExp(`DELETE FROM \\${table}`.replace('\\', '')))
  }
  assert.doesNotMatch(source, /DELETE FROM schema_migrations|TRUNCATE/i)
  assert.match(source, /schemaMigrationsPreserved/)
  assert.match(source, /verifiedEmpty: true/)
  assert.match(source, /usersPreserved: 0/)
})

test('factory reset removes obsolete file stores and requires runtime/browser cleanup', () => {
  assert.match(source, /auth\.enc\.json/)
  assert.match(source, /connectors\.enc\.json/)
  assert.match(source, /connectorRestartRequired: true/)
  assert.match(source, /browserSiteDataMustBeCleared: true/)
  assert.match(source, /providerRevocationAttempted: false/)
})
