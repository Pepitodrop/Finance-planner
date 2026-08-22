import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import {
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
const emailArgument = args.find((argument) => !argument.startsWith('--'))
const email = normalizeTestAccountEmail(emailArgument || env.TEST_ACCOUNT_EMAIL)
const name = requireTestAccountName(env.TEST_ACCOUNT_NAME)
const seedFile = String(env.TEST_ACCOUNT_SEED_FILE || '').trim()
const cobolSeedBinary = String(env.COBOL_TEST_SEED_BINARY || '/app/build/test-seed').trim()

if (seedWithCobol && seedFile) {
  throw new Error('Choose exactly one test-data seed source: --seed-cobol or TEST_ACCOUNT_SEED_FILE, not both.')
}

async function loadSeedPayload() {
  if (seedWithCobol) {
    const { stdout, stderr } = await execFileAsync(cobolSeedBinary, [], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1_000_000,
      env: { PATH: env.PATH || '/usr/local/bin:/usr/bin:/bin' },
    })
    if (stderr?.trim()) throw new Error('The COBOL test-seed generator wrote unexpected stderr output.')
    return { payload: validateCloudPayload(JSON.parse(stdout)), source: 'gnucobol' }
  }
  if (seedFile) {
    const parsed = JSON.parse(await readFile(seedFile, 'utf8'))
    return { payload: validateCloudPayload(parsed), source: 'file' }
  }
  return { payload: null, source: null }
}

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

  const seedInput = await loadSeedPayload()
  let seedSummary = null
  if (seedInput.payload) {
    const encryptedPayload = encryptCloudPayload(
      seedInput.payload,
      env.CONNECTOR_MASTER_KEY,
      provisioned.userId,
    )

    const result = await pool.query(
      `INSERT INTO user_finance_state
         (user_id, encrypted_payload, version, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (user_id)
       DO UPDATE SET
         encrypted_payload = EXCLUDED.encrypted_payload,
         version = user_finance_state.version + 1,
         updated_at = now()
       RETURNING version`,
      [provisioned.userId, encryptedPayload],
    )

    seedSummary = {
      source: seedInput.source,
      version: Number(result.rows[0].version),
      accounts: seedInput.payload.state.accounts.length,
      transactions: seedInput.payload.state.transactions.length,
      goals: seedInput.payload.state.goals.length,
    }
  }

  console.log(JSON.stringify({
    status: 'ok',
    created: provisioned.created,
    persisted: true,
    seedApplied: Boolean(seedInput.payload),
    seed: seedSummary,
  }, null, 2))
} finally {
  await pool.end()
}
