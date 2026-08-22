import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const createScriptUrl = new URL('../scripts/create-test-account.mjs', import.meta.url)
const clearScriptUrl = new URL('../scripts/clear-test-account-data.mjs', import.meta.url)
const createSource = await readFile(createScriptUrl, 'utf8')
const clearSource = await readFile(clearScriptUrl, 'utf8')
const emptyCobolSourceUrl = new URL('../../core/cobol/test_account_empty_generator.cob', import.meta.url)
const seedCobolSourceUrl = new URL('../../core/cobol/test_seed_generator.cob', import.meta.url)
const emptyCobolSourcePath = fileURLToPath(emptyCobolSourceUrl)
const seedCobolSourcePath = fileURLToPath(seedCobolSourceUrl)
const emptyCobolSource = await readFile(emptyCobolSourceUrl, 'utf8')
const seedCobolSource = await readFile(seedCobolSourceUrl, 'utf8')
const cobcAvailable = spawnSync('cobc', ['--version'], { stdio: 'ignore' }).status === 0

test('server package exposes isolated empty/seed/reset test-account commands, not a global demo reset', () => {
  assert.equal(packageJson.scripts['database:reset-demo'], undefined)
  assert.equal(packageJson.scripts['database:reset-demo:dry-run'], undefined)
  assert.equal(packageJson.scripts['test-account:provision'], 'node scripts/create-test-account.mjs')
  assert.match(packageJson.scripts['test-account:build-empty'], /cobc -free .*test_account_empty_generator\.cob/)
  assert.match(packageJson.scripts['test-account:build-seed'], /cobc -free .*test_seed_generator\.cob/)
  assert.equal(packageJson.scripts['test-account:create-empty'], 'npm run test-account:build-empty && node scripts/create-test-account.mjs --empty-cobol')
  assert.equal(packageJson.scripts['test-account:seed'], 'npm run test-account:build-empty && npm run test-account:build-seed && node scripts/create-test-account.mjs --seed-cobol')
  assert.equal(packageJson.scripts['test-account:clear-data'], 'node scripts/clear-test-account-data.mjs')
})

test('maintenance scripts are valid Node syntax', async () => {
  await Promise.all([
    execFileAsync(process.execPath, ['--check', fileURLToPath(createScriptUrl)]),
    execFileAsync(process.execPath, ['--check', fileURLToPath(clearScriptUrl)]),
  ])
})

test('empty COBOL bootstrap executes before account/database mutation and seed mode auto-creates missing account first', () => {
  assert.match(createSource, /args\.includes\('--empty-cobol'\)/)
  assert.match(createSource, /args\.includes\('--seed-cobol'\)/)
  assert.match(createSource, /new URL\('\.\.\/build\/test-account-empty', import\.meta\.url\)/)
  assert.match(createSource, /new URL\('\.\.\/build\/test-seed', import\.meta\.url\)/)
  assert.match(createSource, /validateCloudPayload\(JSON\.parse\(stdout\)\)/)
  assert.ok(createSource.indexOf('await loadCobolPayload(cobolEmptyBinary') < createSource.indexOf('const pool = createDatabase'))
  assert.match(createSource, /emptyWithCobol \|\| \(provisioned\.created && seedInput\.payload\)/)
  assert.match(createSource, /encryptCloudPayload\(/)
  assert.match(createSource, /emptyBootstrapApplied/)
  assert.doesNotMatch(createSource, /TRUNCATE\s+/i)
})

test('test-account clear command is confirmation-gated, refuses non-test accounts, and publishes an encrypted empty cloud version', () => {
  assert.match(clearSource, /CLEAR_TEST_ACCOUNT_FINANCE_DATA/)
  assert.match(clearSource, /user\.id !== expectedUserId/)
  assert.match(clearSource, /startsWith\('test:'\)/)
  assert.match(clearSource, /validateCloudPayload\(/)
  assert.match(clearSource, /state: \{ accounts: \[\], transactions: \[\], goals: \[\] \}/)
  assert.match(clearSource, /encryptCloudPayload\(emptyPayload, env\.CONNECTOR_MASTER_KEY, user\.id\)/)
  assert.match(clearSource, /DELETE FROM connector_connections WHERE user_id=\$1/)
  assert.match(clearSource, /DELETE FROM oauth_nonces WHERE user_id=\$1/)
  assert.match(clearSource, /DELETE FROM user_budget_learning_profiles WHERE user_id=\$1/)
  assert.match(clearSource, /INSERT INTO user_finance_state/)
  assert.match(clearSource, /version = user_finance_state\.version \+ 1/)
  assert.doesNotMatch(clearSource, /DELETE FROM user_finance_state/)
  assert.doesNotMatch(clearSource, /DELETE FROM auth_users|TRUNCATE/i)
  assert.match(clearSource, /accountPreserved: true/)
  assert.match(clearSource, /financeStateReset: true/)
  assert.match(clearSource, /providerRevocationAttempted: false/)
})

test('COBOL test-data generators contain finance fixtures only and no credentials', () => {
  assert.match(emptyCobolSource, />>SOURCE FORMAT IS FREE/)
  assert.match(emptyCobolSource, /"accounts": \[\]/)
  assert.match(emptyCobolSource, /"transactions": \[\]/)
  assert.match(emptyCobolSource, /"goals": \[\]/)
  assert.match(emptyCobolSource, /"secureData": \{\}/)
  assert.match(seedCobolSource, />>SOURCE FORMAT IS FREE/)
  assert.match(seedCobolSource, /Test Girokonto/)
  assert.match(seedCobolSource, /Test Kreditkarte/)
  assert.match(seedCobolSource, /Emergency fund/)
  assert.match(seedCobolSource, /Transfer to savings/)
  assert.doesNotMatch(seedCobolSource, /"recurring":true/)
  assert.doesNotMatch(`${emptyCobolSource}\n${seedCobolSource}`, /\b(?:password|secret|token|session|iban|pin|tan)\b/i)
})

async function compileAndRun(sourcePath, binaryName) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'finance-planner-cobol-test-'))
  const binary = join(tempDirectory, binaryName)
  try {
    await execFileAsync('cobc', ['-free', '-Wall', '-Wextra', '-x', '-o', binary, sourcePath], { timeout: 10_000 })
    const { stdout, stderr } = await execFileAsync(binary, [], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2_000_000 })
    assert.equal(stderr, '')
    return JSON.parse(stdout)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

test('compiled COBOL empty-account generator emits valid zero-data state', { skip: !cobcAvailable }, async () => {
  const payload = await compileAndRun(emptyCobolSourcePath, 'test-account-empty')
  assert.deepEqual(payload.state, { accounts: [], transactions: [], goals: [] })
  assert.deepEqual(payload.secureData, {})
})

test('compiled comprehensive COBOL seed exercises accounts, repeated history, transfers, categories, and goals', { skip: !cobcAvailable }, async () => {
  const payload = await compileAndRun(seedCobolSourcePath, 'test-seed')
  assert.equal(payload.state.accounts.length, 5)
  assert.equal(payload.state.transactions.length, 111)
  assert.equal(payload.state.goals.length, 5)
  assert.deepEqual(new Set(payload.state.accounts.map(({ type }) => type)), new Set(['checking', 'savings', 'cash', 'investment', 'credit-card']))
  assert.equal(payload.state.transactions.filter(({ recurring }) => recurring).length, 0)
  assert.equal(payload.state.transactions.filter(({ description }) => description === 'Test Rent').length, 8)
  assert.equal(payload.state.transactions.filter(({ category }) => category === 'Transfer').length, 16)
  assert.ok(payload.state.transactions.some(({ category }) => category === 'Travel'))
  assert.ok(payload.state.transactions.some(({ category }) => category === 'Investment'))
  assert.ok(payload.state.transactions.some(({ type }) => type === 'income'))
  assert.ok(payload.state.transactions.some(({ type }) => type === 'expense'))
  assert.deepEqual(payload.secureData, { testSeed: { generator: 'gnucobol', mode: 'comprehensive', version: 2, scenario: 'full-ui' } })
})
