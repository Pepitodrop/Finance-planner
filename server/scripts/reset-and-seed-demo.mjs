import { chmod, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { AuthStore } from '../src/auth-store.js'
import { decryptCloudPayload, encryptCloudPayload, validateCloudPayload } from '../src/user-state-store.js'

export const REQUIRED_CONFIRMATION = 'RESET_ALL_FINANCE_PLANNER_DATA'

const isoDate = (date) => date.toISOString().slice(0, 10)
const addMonths = (date, amount) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`

function required(env, name, minimumLength = 1) {
  const value = String(env[name] || '').trim()
  if (value.length < minimumLength) throw new Error(`${name} is required${minimumLength > 1 ? ` and must contain at least ${minimumLength} characters` : ''}.`)
  return value
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`)
}

function databaseUrlFor(baseUrl, databaseName) {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

export function buildDemoPayload(referenceDate = new Date()) {
  const monthStart = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
  const accounts = [
    ['demo-checking', 'Hauptkonto', 'checking', 1284732],
    ['demo-savings', 'Tagesgeld', 'savings', 2475000],
    ['demo-investment', 'ETF-Depot', 'investment', 3852400],
    ['demo-travel', 'Reisekonto', 'checking', 365000],
    ['demo-cash', 'Bargeld', 'cash', 18500],
    ['demo-emergency', 'Notgroschen', 'savings', 900000],
  ].map(([id, name, type, balanceCents]) => ({ id, name, type, balanceCents, currency: 'EUR' }))

  const fixed = [
    ['Miete Wohnpark Karlsruhe', 'Wohnen', 108000], ['Stadtwerke Energie', 'Wohnen', 11900],
    ['Telekom MagentaMobil', 'Kommunikation', 4995], ['HanseMerkur Versicherung', 'Versicherung', 8450],
    ['Spotify', 'Abonnements', 1099], ['Netflix', 'Abonnements', 1799], ['Fitnessstudio', 'Gesundheit', 3490],
  ]
  const variable = [
    ['REWE Markt', 'Lebensmittel', 6824], ['EDEKA', 'Lebensmittel', 4389], ['Shell Tankstelle', 'Mobilität', 7420],
    ['Deutsche Bahn', 'Mobilität', 2990], ['Restaurant Mediterran', 'Freizeit', 5890], ['Amazon Marketplace', 'Shopping', 7999],
    ['Apotheke am Markt', 'Gesundheit', 2345], ['Golfclub St. Leon-Rot', 'Freizeit', 4500],
  ]
  const transactions = []
  let sequence = 1
  const add = (accountId, description, category, type, amountCents, date, recurring = false) => transactions.push({
    id: `demo-tx-${String(sequence++).padStart(4, '0')}`, accountId, description, category, type, amountCents, date: isoDate(date), recurring,
  })

  for (let offset = -17; offset <= 0; offset += 1) {
    const month = addMonths(monthStart, offset)
    const date = (day) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day))
    add('demo-checking', 'Gehalt Tech Solutions GmbH', 'Einkommen', 'income', 365000 + ((offset + 18) % 4) * 7500, date(1), true)
    if (offset % 3 === 0) add('demo-checking', 'Freelance Projekt', 'Einkommen', 'income', 85000 + ((offset + 18) % 5) * 10000, date(12))
    fixed.forEach(([description, category, amount], index) => add('demo-checking', description, category, 'expense', amount, date(Math.min(28, 2 + index * 3)), true))
    variable.forEach(([description, category, amount], index) => add(index === 5 ? 'demo-travel' : 'demo-checking', description, category, 'expense', amount + (((offset + 18) * 173 + index * 311) % 2400), date(4 + ((index * 3 + offset + 18) % 23))))
    add('demo-checking', 'Übertrag Tagesgeld', 'Transfer', 'expense', 50000, date(5), true)
    add('demo-savings', 'Übertrag vom Hauptkonto', 'Transfer', 'income', 50000, date(5), true)
    add('demo-checking', 'ETF Sparplan', 'Investieren', 'expense', 30000, date(8), true)
    add('demo-investment', 'ETF Sparplan Eingang', 'Investieren', 'income', 30000, date(8), true)
  }
  add('demo-checking', 'Steuererstattung', 'Einkommen', 'income', 124500, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 14)))
  add('demo-travel', 'Hotel Straßburg', 'Reisen', 'expense', 38900, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 16)))
  add('demo-checking', 'MacBook Reparatur', 'Technik', 'expense', 21900, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 19)))
  add('demo-cash', 'Flohmarkt Verkauf', 'Einkommen', 'income', 12500, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 21)))

  const goals = [
    ['goal-emergency', 'Notgroschen', 1200000, 900000, 8], ['goal-travel', 'Japan-Reise', 450000, 228000, 10],
    ['goal-car', 'Auto-Anzahlung', 1500000, 625000, 24], ['goal-laptop', 'Neuer Laptop', 250000, 175000, 5],
    ['goal-investment', 'ETF-Meilenstein', 5000000, 3852400, 30],
  ].map(([id, name, targetCents, currentCents, months]) => ({ id, name, targetCents, currentCents, targetDate: isoDate(addMonths(monthStart, months)) }))

  return validateCloudPayload({ state: { accounts, transactions, goals }, secureData: {
    demoSeed: { version: 2, generatedAt: referenceDate.toISOString(), description: 'Comprehensive deterministic demo dataset' },
    preferences: { currency: 'EUR', locale: 'de-DE', monthlyBudgetCents: 260000, analysisEnabled: true },
    categoryRules: { REWE: 'Lebensmittel', EDEKA: 'Lebensmittel', Shell: 'Mobilität', Spotify: 'Abonnements', Netflix: 'Abonnements', Telekom: 'Kommunikation' },
    assistantMemory: [{ topic: 'savings', note: 'Prioritize the emergency fund until it reaches €12,000.' }, { topic: 'budget', note: 'Keep discretionary spending below €500 per month.' }],
    recurringAnalysis: { lastRunAt: referenceDate.toISOString(), detectedCount: fixed.length + 4, automatic: true },
  } })
}

export async function createVerifiedBackup(databaseUrl, backupPath, env = process.env) {
  const absolutePath = resolve(backupPath)
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 })
  run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${absolutePath}`, `--dbname=${databaseUrl}`], env)
  await chmod(absolutePath, 0o600)
  run('pg_restore', ['--list', absolutePath], env)

  const restoreDatabase = `finance_planner_restore_${process.pid}_${Date.now()}`
  const adminUrl = databaseUrlFor(databaseUrl, 'postgres')
  const restoreUrl = databaseUrlFor(databaseUrl, restoreDatabase)
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 })
  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(restoreDatabase)}`)
    run('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', `--dbname=${restoreUrl}`, absolutePath], env)
    const restored = new Pool({ connectionString: restoreUrl, max: 1 })
    try {
      const tables = await restored.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
      const names = new Set(tables.rows.map((row) => row.tablename))
      if (!names.has('schema_migrations') || !names.has('auth_store') || !names.has('user_finance_state')) throw new Error('Backup restore verification did not contain the expected schema.')
      const migrations = await restored.query('SELECT count(*)::int AS count FROM schema_migrations')
      if (migrations.rows[0].count < 1) throw new Error('Backup restore verification found no migration history.')
    } finally {
      await restored.end()
    }
  } finally {
    await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [restoreDatabase]).catch(() => {})
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(restoreDatabase)}`).catch(() => {})
    await adminPool.end()
  }
  return absolutePath
}

export async function resetAndSeed({ env = process.env, dryRun = false, referenceDate = new Date() } = {}) {
  const payload = buildDemoPayload(referenceDate)
  const email = String(env.DEMO_USER_EMAIL || 'demo@finance-planner.test').trim().toLowerCase()
  const name = String(env.DEMO_USER_NAME || 'Demo User').trim()
  if (dryRun) return { dryRun: true, email, accounts: payload.state.accounts.length, transactions: payload.state.transactions.length, goals: payload.state.goals.length }
  if (env.RESET_CONFIRM !== REQUIRED_CONFIRMATION) throw new Error(`Refusing destructive reset. Set RESET_CONFIRM=${REQUIRED_CONFIRMATION}.`)

  const databaseUrl = required(env, 'DATABASE_URL')
  const connectorMasterKey = required(env, 'CONNECTOR_MASTER_KEY', 32)
  const authMasterKey = required(env, 'AUTH_MASTER_KEY', 32)
  const backup = await createVerifiedBackup(databaseUrl, required(env, 'RESET_BACKUP_PATH'), env)
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tableResult = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations' ORDER BY tablename")
    const tables = tableResult.rows.map((row) => row.tablename)
    if (!tables.includes('auth_store') || !tables.includes('user_finance_state')) throw new Error('Expected application tables are missing; aborting reset.')
    await client.query(`TRUNCATE TABLE ${tables.map(quoteIdentifier).join(', ')} RESTART IDENTITY CASCADE`)

    const now = referenceDate.toISOString()
    const authStore = new AuthStore('./data/reset-seed-auth.enc.json', authMasterKey, client)
    authStore.data = { users: { 'demo-user': { id: 'demo-user', email, name, passkeys: [], createdAt: now, updatedAt: now } }, challenges: {} }
    await authStore.persist()
    await client.query('INSERT INTO user_finance_state (user_id, encrypted_payload, version, updated_at) VALUES ($1,$2,1,now())', ['demo-user', encryptCloudPayload(payload, connectorMasterKey, 'demo-user')])
    await client.query('COMMIT')

    const financeRow = await pool.query('SELECT encrypted_payload FROM user_finance_state WHERE user_id=$1', ['demo-user'])
    const verifiedPayload = decryptCloudPayload(financeRow.rows[0].encrypted_payload, connectorMasterKey, 'demo-user')
    return { reset: true, backup, preservedTable: 'schema_migrations', seededUser: { id: 'demo-user', email, name }, accounts: verifiedPayload.state.accounts.length, transactions: verifiedPayload.state.transactions.length, goals: verifiedPayload.state.goals.length }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  resetAndSeed({ dryRun: new Set(process.argv.slice(2)).has('--dry-run') })
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
