import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptUrl = new URL('../scripts/clear-all-finance-data.mjs', import.meta.url)
const source = await readFile(scriptUrl, 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('whole-finance reset script is valid Node syntax and explicitly confirmation-gated', async () => {
  await execFileAsync(process.execPath, ['--check', fileURLToPath(scriptUrl)])
  assert.equal(packageJson.scripts['finance-data:clear-all'], 'node scripts/clear-all-finance-data.mjs')
  assert.match(source, /CLEAR_ALL_FINANCE_DATA/)
  assert.match(source, /FINANCE_DATA_RESET_CONFIRM/)
})

test('whole-finance reset publishes encrypted empty cloud states instead of deleting them', () => {
  assert.match(source, /state: \{ accounts: \[\], transactions: \[\], goals: \[\] \}/)
  assert.match(source, /encryptCloudPayload\(emptyPayload, env\.CONNECTOR_MASTER_KEY, user\.id\)/)
  assert.match(source, /INSERT INTO user_finance_state/)
  assert.match(source, /version = user_finance_state\.version \+ 1/)
  assert.doesNotMatch(source, /DELETE FROM user_finance_state/)
})

test('whole-finance reset preserves authentication/security infrastructure and clears local finance/provider state', () => {
  assert.match(source, /Object\.values\(store\.data\.users\)/)
  assert.match(source, /DELETE FROM connector_connections/)
  assert.match(source, /DELETE FROM oauth_nonces/)
  assert.match(source, /DELETE FROM user_budget_learning_profiles/)
  assert.match(source, /DELETE FROM webhook_events/)
  assert.doesNotMatch(source, /DELETE FROM auth_store|DELETE FROM schema_migrations|DELETE FROM user_session_revocations|DELETE FROM request_rate_limits|TRUNCATE/i)
  assert.match(source, /providerRevocationAttempted: false/)
})
