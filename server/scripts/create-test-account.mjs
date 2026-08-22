import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import {
  decryptCloudPayload,
  encryptCloudPayload,
  validateCloudPayload,
} from '../src/user-state-store.js'
import {
  normalizeTestAccountEmail,
  provisionTestAccount,
  requireTestAccountName,
  verifyProvisionedTestAccount,
} from '../src/test-account-provisioning.js'

const execFileAsync = promisify(execFile)
const env = process.env
const args = process.argv.slice(2)
const seedWithCobol = args.includes('--seed-cobol')
const emptyWithCobol = args.includes('--empty-cobol')
const emailArgument = args.find((argument) => !argument.startsWith('--'))
const email = normalizeTestAccountEmail(emailArgument || env.TEST_ACCOUNT_EMAIL)
const name = requireTestAccountName(env.TEST_ACCOUNT_NAME)
const seedFile = String(env.TEST_ACCOUNT_SEED_FILE || '').trim()
const defaultCobolEmptyBinary = fileURLToPath(new URL('../build/test-account-empty', import.meta.url))
const defaultCobolSeedBinary = fileURLToPath(new URL('../build/test-seed', import.meta.url))
const cobolEmptyBinary = String(env.COBOL_TEST_ACCOUNT_EMPTY_BINARY || defaultCobolEmptyBinary).trim()
const cobolSeedBinary = String(env.COBOL_TEST_SEED_BINARY || defaultCobolSeedBinary).trim()

if (seedWithCobol && emptyWithCobol) {
  throw new Error('Choose one test-account mode: --empty-cobol or --seed-cobol.')
}
if (seedWithCobol && seedFile) {
  throw new Error('Choose exactly one test-data seed source: --seed-cobol or TEST_ACCOUNT_SEED_FILE, not both.')
}
if (emptyWithCobol && seedFile) {
  throw new Error('TEST_ACCOUNT_SEED_FILE cannot be combined with --empty-cobol.')
}

async function loadCobolPayload(binary, label) {
  const { stdout, stderr } = await execFileAsync(binary, [], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 2_000_000,
    env: { PATH: env.PATH || '/usr/local/bin:/usr/bin:/bin' },
  })
  if (stderr?.trim()) throw new Error(`The COBOL ${label} generator wrote unexpected stderr output.`)
  return { payload: validateCloudPayload(JSON.parse(stdout)), source: `gnucobol:${label}` }
}

async function loadRequestedSeedPayload() {
  if (seedWithCobol) return loadCobolPayload(cobolSeedBinary, 'comprehensive-seed')
  if (seedFile) {
    const parsed = JSON.parse(await readFile(seedFile, 'utf8'))
    return { payload: validateCloudPayload(parsed), source: 'file' }
  }
  return { payload: null, source: null }
}

const requiresEmptyBootstrap = emptyWithCobol || seedWithCobol || Boolean(seedFile)
// The deterministic COBOL empty-state program deliberately executes before
// any database/auth mutation for empty-account and seed workflows.
const emptyInput = requiresEmptyBootstrap
  ? await loadCobolPayload(cobolEmptyBinary, 'empty-account')
  : { payload: null, source: null }
const seedInput = await loadRequestedSeedPayload()

const pool = createDatabase(env.DATABASE_URL)
await migrateDatabase(pool)

try {
  const createStore = () => new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )

  const store = createStore()
  await store.load()

  const provisioned = await provisionTestAccount({ store, email, name })
  await verifyProvisionedTestAccount({
    store: createStore(),
    email,
    expectedUserId: provisioned.userId,
  })

  async function persistPayload(input) {
    const encryptedPayload = encryptCloudPayload(
      input.payload,
      env.CONNECTOR_MASTER_KEY,
      provisioned.userId,
    )
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `INSERT INTO user_finance_state
           (user_id, encrypted_payload, version, updated_at)
         VALUES ($1, $2, 1, now())
         ON CONFLICT (user_id)
         DO UPDATE SET
           encrypted_payload = EXCLUDED.encrypted_payload,
           version = user_finance_state.version + 1,
           updated_at = now()
         RETURNING version, encrypted_payload`,
        [provisioned.userId, encryptedPayload],
      )
      const verifiedPayload = decryptCloudPayload(
        result.rows[0].encrypted_payload,
        env.CONNECTOR_MASTER_KEY,
        provisioned.userId,
      )
      if (JSON.stringify(verifiedPayload) !== JSON.stringify(input.payload)) {
        throw new Error(`Encrypted ${input.source} persistence verification failed.`)
      }
      await client.query('COMMIT')
      return {
        source: input.source,
        version: Number(result.rows[0].version),
        verified: true,
        accounts: input.payload.state.accounts.length,
        transactions: input.payload.state.transactions.length,
        goals: input.payload.state.goals.length,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  let emptyBootstrapSummary = null
  if (emptyWithCobol || (provisioned.created && seedInput.payload)) {
    emptyBootstrapSummary = await persistPayload(emptyInput)
  }

  let seedSummary = null
  if (seedInput.payload) seedSummary = await persistPayload(seedInput)

  console.log(JSON.stringify({
    status: 'ok',
    mode: emptyWithCobol ? 'empty' : seedInput.payload ? 'seeded' : 'provision-only',
    created: provisioned.created,
    persisted: true,
    emptyBootstrapApplied: Boolean(emptyBootstrapSummary),
    emptyBootstrap: emptyBootstrapSummary,
    seedApplied: Boolean(seedInput.payload),
    seed: seedSummary,
  }, null, 2))
} finally {
  await pool.end()
}
