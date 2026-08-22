import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const createSource = await readFile(new URL('../scripts/create-test-account.mjs', import.meta.url), 'utf8')
const clearSource = await readFile(new URL('../scripts/clear-test-account-data.mjs', import.meta.url), 'utf8')
const cobolSource = await readFile(new URL('../../core/cobol/test_seed_generator.cob', import.meta.url), 'utf8')
const cobolSeedBinary = String(process.env.COBOL_TEST_SEED_BINARY || '').trim()

test('server package exposes only isolated test-account seed/reset commands, not a global demo reset', () => {
  assert.equal(packageJson.scripts['database:reset-demo'], undefined)
  assert.equal(packageJson.scripts['database:reset-demo:dry-run'], undefined)
  assert.equal(packageJson.scripts['test-account:provision'], 'node scripts/create-test-account.mjs')
  assert.match(packageJson.scripts['test-account:build-seed'], /cobc .*test_seed_generator\.cob/)
  assert.equal(packageJson.scripts['test-account:seed'], 'npm run test-account:build-seed && node scripts/create-test-account.mjs --seed-cobol')
  assert.equal(packageJson.scripts['test-account:clear-data'], 'node scripts/clear-test-account-data.mjs')
})

test('COBOL-generated seed is opt-in, validated, and encrypted before persistence', () => {
  assert.match(createSource, /args\.includes\('--seed-cobol'\)/)
  assert.match(createSource, /validateCloudPayload\(JSON\.parse\(stdout\)\)/)
  assert.match(createSource, /encryptCloudPayload\(/)
  assert.match(createSource, /Choose exactly one test-data seed source/)
  assert.match(createSource, /new URL\('\.\.\/build\/test-seed', import\.meta\.url\)/)
  assert.doesNotMatch(createSource, /TRUNCATE\s+/i)
})

test('test-account clear command is confirmation-gated and refuses non-test accounts', () => {
  assert.match(clearSource, /CLEAR_TEST_ACCOUNT_FINANCE_DATA/)
  assert.match(clearSource, /user\.id !== expectedUserId/)
  assert.match(clearSource, /startsWith\('test:'\)/)
  assert.match(clearSource, /DELETE FROM connector_connections WHERE user_id=\$1/)
  assert.match(clearSource, /DELETE FROM oauth_nonces WHERE user_id=\$1/)
  assert.match(clearSource, /DELETE FROM user_finance_state WHERE user_id=\$1/)
  assert.match(clearSource, /DELETE FROM user_budget_learning_profiles WHERE user_id=\$1/)
  assert.doesNotMatch(clearSource, /DELETE FROM auth_users|TRUNCATE/i)
  assert.match(clearSource, /accountPreserved: true/)
  assert.match(clearSource, /providerRevocationAttempted: false/)
})

test('COBOL seed contains deterministic finance fixtures only and no credentials', () => {
  assert.match(cobolSource, /Finance Planner Test Girokonto/)
  assert.match(cobolSource, /balanceCents":695950/)
  assert.match(cobolSource, /amountCents":250000/)
  assert.match(cobolSource, /amountCents":9000/)
  assert.match(cobolSource, /amountCents":4999/)
  assert.match(cobolSource, /amountCents":12000/)
  assert.match(cobolSource, /amountCents":5000/)
  assert.doesNotMatch(cobolSource, /password|secret|token|session|iban|pin|tan/i)
})

test('compiled COBOL seed emits valid deterministic JSON', { skip: !cobolSeedBinary }, async () => {
  const { stdout, stderr } = await execFileAsync(cobolSeedBinary, [], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(stderr, '')
  const payload = JSON.parse(stdout)
  assert.deepEqual(payload.state.accounts, [{
    id: 'seed-checking',
    name: 'Finance Planner Test Girokonto',
    type: 'checking',
    balanceCents: 695950,
    currency: 'EUR',
  }])
  assert.equal(payload.state.transactions.length, 5)
  assert.deepEqual(payload.state.transactions.map(({ type, amountCents }) => [type, amountCents]), [
    ['income', 250000],
    ['expense', 9000],
    ['expense', 4999],
    ['expense', 12000],
    ['income', 5000],
  ])
  assert.deepEqual(payload.state.goals, [])
  assert.deepEqual(payload.secureData, { testSeed: { generator: 'gnucobol', version: 1 } })
})
