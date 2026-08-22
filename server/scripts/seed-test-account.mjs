import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { encryptCloudPayload, validateCloudPayload } from '../src/user-state-store.js'

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)))
const defaultBinary = resolve(scriptDirectory, '../../build/test-data-seed')

function required(env, name, minimumLength = 1) {
  const value = String(env[name] || '').trim()
  if (value.length < minimumLength) throw new Error(`${name} is required.`)
  return value
}

function integer(value, field, { min = 0 } = {}) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new Error(`${field} must be a safe integer.`)
  return parsed
}

export function parseCobolSeedOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines[0] !== 'FP-SEED|1') throw new Error('Unsupported COBOL seed format.')

  const accounts = []
  const transactions = []
  const goals = []
  let footer = null

  for (const line of lines.slice(1)) {
    const fields = line.split('|')
    const kind = fields[0]
    if (kind === 'ACCOUNT') {
      if (fields.length !== 6) throw new Error('Malformed ACCOUNT seed record.')
      accounts.push({
        id: fields[1],
        name: fields[2],
        type: fields[3],
        balanceCents: integer(fields[4], 'ACCOUNT balanceCents'),
        currency: fields[5],
      })
      continue
    }
    if (kind === 'TRANSACTION') {
      if (fields.length !== 9) throw new Error('Malformed TRANSACTION seed record.')
      if (fields[5] !== 'income' && fields[5] !== 'expense') throw new Error('Invalid TRANSACTION type.')
      if (fields[8] !== 'true' && fields[8] !== 'false') throw new Error('Invalid TRANSACTION recurring flag.')
      transactions.push({
        id: fields[1],
        accountId: fields[2],
        description: fields[3],
        category: fields[4],
        type: fields[5],
        amountCents: integer(fields[6], 'TRANSACTION amountCents', { min: 1 }),
        date: fields[7],
        recurring: fields[8] === 'true',
      })
      continue
    }
    if (kind === 'GOAL') {
      if (fields.length !== 6) throw new Error('Malformed GOAL seed record.')
      goals.push({
        id: fields[1],
        name: fields[2],
        targetCents: integer(fields[3], 'GOAL targetCents', { min: 1 }),
        currentCents: integer(fields[4], 'GOAL currentCents'),
        targetDate: fields[5],
      })
      continue
    }
    if (kind === 'END') {
      if (fields.length !== 4) throw new Error('Malformed END seed record.')
      footer = {
        accounts: integer(fields[1], 'END accounts'),
        transactions: integer(fields[2], 'END transactions'),
        goals: integer(fields[3], 'END goals'),
      }
      continue
    }
    throw new Error(`Unknown COBOL seed record: ${kind || '<empty>'}`)
  }

  if (!footer) throw new Error('COBOL seed output is missing its END record.')
  if (accounts.length !== footer.accounts || transactions.length !== footer.transactions || goals.length !== footer.goals) {
    throw new Error('COBOL seed record counts do not match the END record.')
  }

  return validateCloudPayload({ state: { accounts, transactions, goals }, secureData: {} })
}

export function runCobolSeed(binary) {
  const result = spawnSync(binary, [], { encoding: 'utf8', maxBuffer: 1_000_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`COBOL test-data generator failed with exit code ${result.status}.`)
  return parseCobolSeedOutput(result.stdout)
}

export async function seedTestAccount({ env = process.env, dryRun = false } = {}) {
  const binary = String(env.COBOL_TEST_SEED_BINARY || defaultBinary).trim()
  const payload = runCobolSeed(binary)
  const summary = {
    accounts: payload.state.accounts.length,
    transactions: payload.state.transactions.length,
    goals: payload.state.goals.length,
  }
  if (dryRun) return { dryRun: true, ...summary }

  const databaseUrl = required(env, 'DATABASE_URL')
  const connectorMasterKey = required(env, 'CONNECTOR_MASTER_KEY', 32)
  const authMasterKey = String(env.AUTH_MASTER_KEY || connectorMasterKey).trim()
  const email = required(env, 'TEST_ACCOUNT_EMAIL').toLowerCase()
  const pool = createDatabase(databaseUrl)
  await migrateDatabase(pool)

  try {
    const store = new AuthStore(env.AUTH_STORE_PATH || './data/auth.enc.json', authMasterKey, pool, env.AUTH_MASTER_KEY ? connectorMasterKey : '')
    await store.load()
    const user = store.findByEmail(email)
    if (!user || !String(user.id).startsWith('test:')) {
      throw new Error('Configured TEST_ACCOUNT_EMAIL does not resolve to a provisioned test account. Refusing to seed any other user.')
    }

    const encrypted = encryptCloudPayload(payload, connectorMasterKey, user.id)
    const result = await pool.query(
      `INSERT INTO user_finance_state (user_id, encrypted_payload, version, updated_at)
       VALUES ($1,$2,1,now())
       ON CONFLICT (user_id)
       DO UPDATE SET encrypted_payload=EXCLUDED.encrypted_payload,
                     version=user_finance_state.version + 1,
                     updated_at=now()
       RETURNING version`,
      [user.id, encrypted],
    )

    return {
      seeded: true,
      userId: user.id,
      version: Number(result.rows[0].version),
      ...summary,
    }
  } finally {
    await pool.end()
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  seedTestAccount({ dryRun: process.argv.includes('--dry-run') })
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
