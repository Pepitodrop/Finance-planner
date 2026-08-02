import { chmod, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'
import { AuthStore } from '../src/auth-store.js'
import { encryptCloudPayload, validateCloudPayload } from '../src/user-state-store.js'

const REQUIRED_CONFIRMATION = 'RESET_ALL_FINANCE_PLANNER_DATA'
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')

function requireValue(name, minimumLength = 1) {
  const value = String(process.env[name] || '').trim()
  if (value.length < minimumLength) throw new Error(`${name} is required${minimumLength > 1 ? ` and must contain at least ${minimumLength} characters` : ''}.`)
  return value
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function addMonths(date, amount) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))
  return result
}

function transaction(id, accountId, description, category, type, amountCents, date, recurring = false) {
  return { id, accountId, description, category, type, amountCents, date: isoDate(date), recurring }
}

export function buildDemoPayload(referenceDate = new Date()) {
  const monthStart = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
  const accounts = [
    { id: 'demo-checking', name: 'Hauptkonto', type: 'checking', balanceCents: 1284732, currency: 'EUR' },
    { id: 'demo-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 2475000, currency: 'EUR' },
    { id: 'demo-investment', name: 'ETF-Depot', type: 'investment', balanceCents: 3852400, currency: 'EUR' },
    { id: 'demo-travel', name: 'Reisekonto', type: 'checking', balanceCents: 365000, currency: 'EUR' },
    { id: 'demo-cash', name: 'Bargeld', type: 'cash', balanceCents: 18500, currency: 'EUR' },
    { id: 'demo-emergency', name: 'Notgroschen', type: 'savings', balanceCents: 900000, currency: 'EUR' },
  ]

  const transactions = []
  let sequence = 1
  const add = (accountId, description, category, type, amountCents, date, recurring = false) => {
    transactions.push(transaction(`demo-tx-${String(sequence++).padStart(4, '0')}`, accountId, description, category, type, amountCents, date, recurring))
  }

  const monthlyExpenses = [
    ['Miete Wohnpark Karlsruhe', 'Wohnen', 108000],
    ['Stadtwerke Energie', 'Wohnen', 11900],
    ['Telekom MagentaMobil', 'Kommunikation', 4995],
    ['HanseMerkur Versicherung', 'Versicherung', 8450],
    ['Spotify', 'Abonnements', 1099],
    ['Netflix', 'Abonnements', 1799],
    ['Fitnessstudio', 'Gesundheit', 3490],
  ]
  const variableExpenses = [
    ['REWE Markt', 'Lebensmittel', 6824],
    ['EDEKA', 'Lebensmittel', 4389],
    ['Shell Tankstelle', 'Mobilität', 7420],
    ['Deutsche Bahn', 'Mobilität', 2990],
    ['Restaurant Mediterran', 'Freizeit', 5890],
    ['Amazon Marketplace', 'Shopping', 7999],
    ['Apotheke am Markt', 'Gesundheit', 2345],
    ['Golfclub St. Leon-Rot', 'Freizeit', 4500],
  ]

  for (let offset = -17; offset <= 0; offset += 1) {
    const month = addMonths(monthStart, offset)
    add('demo-checking', 'Gehalt Tech Solutions GmbH', 'Einkommen', 'income', 365000 + ((offset + 18) % 4) * 7500, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)), true)
    if (offset % 3 === 0) add('demo-checking', 'Freelance Projekt', 'Einkommen', 'income', 85000 + ((offset + 18) % 5) * 10000, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 12)))
    for (const [index, entry] of monthlyExpenses.entries()) {
      add('demo-checking', entry[0], entry[1], 'expense', entry[2], new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(28, 2 + index * 3))), true)
    }
    for (let index = 0; index < variableExpenses.length; index += 1) {
      const entry = variableExpenses[index]
      const variation = ((offset + 18) * 173 + index * 311) % 2400
      add(index === 5 ? 'demo-travel' : 'demo-checking', entry[0], entry[1], 'expense', entry[2] + variation, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 4 + ((index * 3 + offset + 18) % 23))))
    }
    add('demo-checking', 'Übertrag Tagesgeld', 'Transfer', 'expense', 50000, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 5)), true)
    add('demo-savings', 'Übertrag vom Hauptkonto', 'Transfer', 'income', 50000, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 5)), true)
    add('demo-checking', 'ETF Sparplan', 'Investieren', 'expense', 30000, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 8)), true)
    add('demo-investment', 'ETF Sparplan Eingang', 'Investieren', 'income', 30000, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 8)), true)
  }

  add('demo-checking', 'Steuererstattung', 'Einkommen', 'income', 124500, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 14)))
  add('demo-travel', 'Hotel Straßburg', 'Reisen', 'expense', 38900, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 16)))
  add('demo-checking', 'MacBook Reparatur', 'Technik', 'expense', 21900, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 19)))
  add('demo-cash', 'Flohmarkt Verkauf', 'Einkommen', 'income', 12500, new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 21)))

  const goals = [
    { id: 'goal-emergency', name: 'Notgroschen', targetCents: 1200000, currentCents: 900000, targetDate: isoDate(addMonths(monthStart, 8)) },
    { id: 'goal-travel', name: 'Japan-Reise', targetCents: 450000, currentCents: 228000, targetDate: isoDate(addMonths(monthStart, 10)) },
    { id: 'goal-car', name: 'Auto-Anzahlung', targetCents: 1500000, currentCents: 625000, targetDate: isoDate(addMonths(monthStart, 24)) },
    { id: 'goal-laptop', name: 'Neuer Laptop', targetCents: 250000, currentCents: 175000, targetDate: isoDate(addMonths(monthStart, 5)) },
    { id: 'goal-investment', name: 'ETF-Meilenstein', targetCents: 5000000, currentCents: 3852400, targetDate: isoDate(addMonths(monthStart, 30)) },
  ]

  return validateCloudPayload({
    state: { accounts, transactions, goals },
    secureData: {
      demoSeed: { version: 1, generatedAt: referenceDate.toISOString(), description: 'Comprehensive deterministic demo dataset' },
      preferences: { currency: 'EUR', locale: 'de-DE', monthlyBudgetCents: 260000, analysisEnabled: true },
      categoryRules: {
        REWE: 'Lebensmittel', EDEKA: 'Lebensmittel', Shell: 'Mobilität', Spotify: 'Abonnements', Netflix: 'Abonnements', Telekom: 'Kommunikation',
      },
      assistantMemory: [
        { topic: 'savings', note: 'Prioritize the emergency fund until it reaches €12,000.' },
        { topic: 'budget', note: 'Keep discretionary spending below €500 per month.' },
      ],
      recurringAnalysis: { lastRunAt: referenceDate.toISOString(), detectedCount: monthlyExpenses.length + 4, automatic: true },
    },
  })
}

function runCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`)
}

async function createVerifiedBackup(databaseUrl, backupPath) {
  const absolutePath = resolve(backupPath)
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 })
  runCommand('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${absolutePath}`, `--dbname=${databaseUrl}`])
  await chmod(absolutePath, 0o600)
  runCommand('pg_restore', ['--list', absolutePath])
  return absolutePath
}

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function resetAndSeed() {
  const payload = buildDemoPayload()
  const email = String(process.env.DEMO_USER_EMAIL || 'demo@finance-planner.test').trim().toLowerCase()
  const name = String(process.env.DEMO_USER_NAME || 'Demo User').trim()

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, email, accounts: payload.state.accounts.length, transactions: payload.state.transactions.length, goals: payload.state.goals.length }, null, 2))
    return
  }

  if (process.env.RESET_CONFIRM !== REQUIRED_CONFIRMATION) throw new Error(`Refusing destructive reset. Set RESET_CONFIRM=${REQUIRED_CONFIRMATION}.`)
  const databaseUrl = requireValue('DATABASE_URL')
  const connectorMasterKey = requireValue('CONNECTOR_MASTER_KEY', 32)
  const authMasterKey = requireValue('AUTH_MASTER_KEY', 32)
  const backupPath = requireValue('RESET_BACKUP_PATH')
  const backup = await createVerifiedBackup(databaseUrl, backupPath)

  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tableResult = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations' ORDER BY tablename")
    const tables = tableResult.rows.map((row) => row.tablename)
    if (!tables.includes('auth_store') || !tables.includes('user_finance_state')) throw new Error('Expected application tables are missing; aborting reset.')
    await client.query(`TRUNCATE TABLE ${tables.map(quotedIdentifier).join(', ')} RESTART IDENTITY CASCADE`)

    const now = new Date().toISOString()
    const authStore = new AuthStore('./data/reset-seed-auth.enc.json', authMasterKey, client)
    authStore.data = {
      users: {
        'demo-user': { id: 'demo-user', email, name, passkeys: [], createdAt: now, updatedAt: now },
      },
      challenges: {},
    }
    await authStore.persist()

    const encryptedPayload = encryptCloudPayload(payload, connectorMasterKey, 'demo-user')
    await client.query('INSERT INTO user_finance_state (user_id, encrypted_payload, version, updated_at) VALUES ($1,$2,1,now())', ['demo-user', encryptedPayload])
    await client.query('COMMIT')

    console.log(JSON.stringify({ reset: true, backup, preservedTable: 'schema_migrations', seededUser: { id: 'demo-user', email, name }, accounts: payload.state.accounts.length, transactions: payload.state.transactions.length, goals: payload.state.goals.length }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

resetAndSeed().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
