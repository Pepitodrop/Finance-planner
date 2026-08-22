import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { AuthStore } from '../src/auth-store.js'
import { BudgetProfileStore } from '../src/budget-profile-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { PostgresStore } from '../src/postgres-store.js'
import { testAccountUserId } from '../src/test-account-provisioning.js'
import { decryptCloudPayload } from '../src/user-state-store.js'

const execFileAsync = promisify(execFile)
const serverRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const createScript = join(serverRoot, 'scripts', 'create-test-account.mjs')
const clearScript = join(serverRoot, 'scripts', 'clear-test-account-data.mjs')
const cobolSource = join(repoRoot, 'core', 'cobol', 'test_seed_generator.cob')
const cobcAvailable = spawnSync('cobc', ['--version'], { stdio: 'ignore' }).status === 0

function databaseUrlFor(baseUrl, databaseName) {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

test('test-account COBOL seed and clear workflow round-trips against PostgreSQL without deleting the login identity', { timeout: 120_000 }, async (t) => {
  const baseUrl = process.env.TEST_DATABASE_URL
  if (!baseUrl) return t.skip('TEST_DATABASE_URL is required for the PostgreSQL integration test.')
  if (!cobcAvailable) return t.skip('GnuCOBOL is required for the test-data integration test.')

  const databaseName = `finance_planner_test_data_${process.pid}_${Date.now()}`
  const databaseUrl = databaseUrlFor(baseUrl, databaseName)
  const adminPool = new Pool({ connectionString: databaseUrlFor(baseUrl, 'postgres'), max: 1 })
  const workdir = await mkdtemp(join(tmpdir(), 'finance-planner-test-data-'))
  const binary = join(workdir, 'test-seed')
  const connectorKey = 'test-data-connector-master-key-with-more-than-32-characters'
  const authKey = 'test-data-auth-master-key-with-more-than-32-characters'
  const email = 'isolated-seed@example.test'
  const name = 'Isolated Seed User'
  const userId = testAccountUserId(email)
  let pool

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
    pool = createDatabase(databaseUrl, { max: 3 })
    await migrateDatabase(pool)

    await execFileAsync('cobc', ['-Wall', '-Wextra', '-x', '-o', binary, cobolSource], { timeout: 10_000 })

    const scriptEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      CONNECTOR_MASTER_KEY: connectorKey,
      AUTH_MASTER_KEY: authKey,
      TEST_ACCOUNT_EMAIL: email,
      TEST_ACCOUNT_NAME: name,
      COBOL_TEST_SEED_BINARY: binary,
    }

    const seeded = await execFileAsync(process.execPath, [createScript, '--seed-cobol'], {
      cwd: serverRoot,
      env: scriptEnv,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 1_000_000,
    })
    assert.equal(seeded.stderr, '')
    const seedSummary = JSON.parse(seeded.stdout)
    assert.equal(seedSummary.status, 'ok')
    assert.equal(seedSummary.seedApplied, true)
    assert.equal(seedSummary.seed.source, 'gnucobol')
    assert.equal(seedSummary.seed.accounts, 1)
    assert.equal(seedSummary.seed.transactions, 5)
    assert.equal(seedSummary.seed.goals, 0)

    const financeBefore = await pool.query('SELECT encrypted_payload, version FROM user_finance_state WHERE user_id=$1', [userId])
    assert.equal(financeBefore.rowCount, 1)
    const financeBeforeVersion = Number(financeBefore.rows[0].version)
    const seededPayload = decryptCloudPayload(financeBefore.rows[0].encrypted_payload, connectorKey, userId)
    assert.equal(seededPayload.state.accounts[0].balanceCents, 695950)
    assert.deepEqual(seededPayload.state.transactions.map((transaction) => transaction.amountCents), [250000, 9000, 4999, 12000, 5000])
    assert.deepEqual(seededPayload.secureData, { testSeed: { generator: 'gnucobol', version: 1 } })

    const authStore = new AuthStore(join(workdir, 'unused-auth.enc.json'), authKey, pool, connectorKey)
    await authStore.load()
    assert.equal(authStore.findByEmail(email)?.id, userId)
    assert.equal(authStore.findByEmail(email)?.name, name)

    const connectorStore = new PostgresStore(pool, connectorKey)
    await connectorStore.set(userId, 'paypal', { consentId: 'test-consent', redirectUri: 'https://finance.example.test/connections' })
    await connectorStore.registerOAuthNonce({
      nonce: 'test-data-nonce',
      consentId: 'test-data-consent',
      userId,
      provider: 'paypal',
      redirectUri: 'https://finance.example.test/connections',
      expiresAt: Date.now() + 600_000,
    })
    const budgetStore = new BudgetProfileStore(pool, connectorKey)
    await budgetStore.update(userId, () => ({ monthlyBudgetCents: 100000, source: 'integration-test' }))

    const cleared = await execFileAsync(process.execPath, [clearScript], {
      cwd: serverRoot,
      env: { ...scriptEnv, TEST_DATA_RESET_CONFIRM: 'CLEAR_TEST_ACCOUNT_FINANCE_DATA' },
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 1_000_000,
    })
    assert.equal(cleared.stderr, '')
    const clearSummary = JSON.parse(cleared.stdout)
    assert.equal(clearSummary.status, 'ok')
    assert.equal(clearSummary.userId, userId)
    assert.equal(clearSummary.accountPreserved, true)
    assert.equal(clearSummary.financeStateReset, true)
    assert.equal(clearSummary.financeStateVersion, financeBeforeVersion + 1)
    assert.equal(clearSummary.providerRevocationAttempted, false)
    assert.equal(clearSummary.deleted.connectorConnections, 1)
    assert.equal(clearSummary.deleted.oauthNonces, 1)
    assert.equal(clearSummary.deleted.learningProfiles, 1)

    const financeAfter = await pool.query('SELECT encrypted_payload, version FROM user_finance_state WHERE user_id=$1', [userId])
    assert.equal(financeAfter.rowCount, 1)
    assert.equal(Number(financeAfter.rows[0].version), financeBeforeVersion + 1)
    const emptyPayload = decryptCloudPayload(financeAfter.rows[0].encrypted_payload, connectorKey, userId)
    assert.deepEqual(emptyPayload, { state: { accounts: [], transactions: [], goals: [] }, secureData: {} })

    assert.equal((await pool.query('SELECT count(*)::int AS count FROM connector_connections WHERE user_id=$1', [userId])).rows[0].count, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM oauth_nonces WHERE user_id=$1', [userId])).rows[0].count, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM user_budget_learning_profiles WHERE user_id=$1', [userId])).rows[0].count, 0)

    const authAfter = new AuthStore(join(workdir, 'unused-auth-after.enc.json'), authKey, pool, connectorKey)
    await authAfter.load()
    assert.equal(authAfter.findByEmail(email)?.id, userId)
  } finally {
    if (pool) await pool.end().catch(() => {})
    await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [databaseName]).catch(() => {})
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {})
    await adminPool.end()
    await rm(workdir, { recursive: true, force: true })
  }
})
