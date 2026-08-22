import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { HttpError } from './runtime-security.js'

const ACCOUNT_TYPES = new Set(['checking', 'savings', 'cash', 'investment', 'credit-card'])
const TRANSACTION_TYPES = new Set(['income', 'expense'])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_SECURE_DATA_BYTES = 512_000
const MAX_TRANSACTIONS = 30_000

function keyFromSecret(secret) {
  if (!secret || String(secret).length < 32) throw new Error('CONNECTOR_MASTER_KEY must contain at least 32 characters.')
  return createHash('sha256').update(String(secret), 'utf8').digest()
}

function bindingData(userId) {
  if (typeof userId !== 'string' || !userId || userId.length > 256) throw new Error('A valid authenticated user binding is required.')
  return Buffer.from(`finance-planner-user-state:v1:${userId}`, 'utf8')
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, allowed, field) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new HttpError(400, 'invalid_cloud_state', `Unexpected ${field} field: ${key}`)
}

function boundedString(value, field, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maxLength) {
    throw new HttpError(400, 'invalid_cloud_state', `${field} is invalid.`)
  }
  return value
}

function safeInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, 'invalid_cloud_state', `${field} must be a safe integer.`)
  return value
}

function validateJsonValue(value, field, depth = 0, counter = { count: 0 }) {
  counter.count += 1
  if (counter.count > 25_000 || depth > 12) throw new HttpError(400, 'invalid_cloud_state', `${field} is too complex.`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HttpError(400, 'invalid_cloud_state', `${field} contains a non-finite number.`)
    return value
  }
  if (Array.isArray(value)) return value.map((entry, index) => validateJsonValue(entry, `${field}[${index}]`, depth + 1, counter))
  if (!isPlainRecord(value)) throw new HttpError(400, 'invalid_cloud_state', `${field} contains an unsupported value.`)
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 160) throw new HttpError(400, 'invalid_cloud_state', `${field} contains an invalid key.`)
    result[key] = validateJsonValue(entry, `${field}.${key}`, depth + 1, counter)
  }
  return result
}

function validateAccount(value, index) {
  if (!isPlainRecord(value)) throw new HttpError(400, 'invalid_cloud_state', `accounts[${index}] must be an object.`)
  exactKeys(value, new Set(['id', 'name', 'type', 'balanceCents', 'currency']), `accounts[${index}]`)
  const type = boundedString(value.type, `accounts[${index}].type`, 32)
  if (!ACCOUNT_TYPES.has(type)) throw new HttpError(400, 'invalid_cloud_state', `accounts[${index}].type is invalid.`)
  if (value.currency !== 'EUR') throw new HttpError(400, 'invalid_cloud_state', `accounts[${index}].currency must be EUR.`)
  return {
    id: boundedString(value.id, `accounts[${index}].id`, 128),
    name: boundedString(value.name, `accounts[${index}].name`, 160),
    type,
    balanceCents: safeInteger(value.balanceCents, `accounts[${index}].balanceCents`),
    currency: 'EUR',
  }
}

function validateTransaction(value, index) {
  if (!isPlainRecord(value)) throw new HttpError(400, 'invalid_cloud_state', `transactions[${index}] must be an object.`)
  exactKeys(value, new Set(['id', 'accountId', 'description', 'category', 'type', 'amountCents', 'date', 'recurring']), `transactions[${index}]`)
  const type = boundedString(value.type, `transactions[${index}].type`, 16)
  if (!TRANSACTION_TYPES.has(type)) throw new HttpError(400, 'invalid_cloud_state', `transactions[${index}].type is invalid.`)
  const date = boundedString(value.date, `transactions[${index}].date`, 10)
  if (!DATE_PATTERN.test(date)) throw new HttpError(400, 'invalid_cloud_state', `transactions[${index}].date is invalid.`)
  if (value.recurring !== undefined && typeof value.recurring !== 'boolean') throw new HttpError(400, 'invalid_cloud_state', `transactions[${index}].recurring must be boolean.`)
  return {
    id: boundedString(value.id, `transactions[${index}].id`, 128),
    accountId: boundedString(value.accountId, `transactions[${index}].accountId`, 128),
    description: boundedString(value.description, `transactions[${index}].description`, 160),
    category: boundedString(value.category, `transactions[${index}].category`, 80),
    type,
    amountCents: safeInteger(value.amountCents, `transactions[${index}].amountCents`, { min: 1 }),
    date,
    ...(value.recurring === undefined ? {} : { recurring: value.recurring }),
  }
}

function validateGoal(value, index) {
  if (!isPlainRecord(value)) throw new HttpError(400, 'invalid_cloud_state', `goals[${index}] must be an object.`)
  exactKeys(value, new Set(['id', 'name', 'targetCents', 'currentCents', 'targetDate']), `goals[${index}]`)
  const targetDate = boundedString(value.targetDate, `goals[${index}].targetDate`, 10)
  if (!DATE_PATTERN.test(targetDate)) throw new HttpError(400, 'invalid_cloud_state', `goals[${index}].targetDate is invalid.`)
  return {
    id: boundedString(value.id, `goals[${index}].id`, 128),
    name: boundedString(value.name, `goals[${index}].name`, 160),
    targetCents: safeInteger(value.targetCents, `goals[${index}].targetCents`, { min: 1 }),
    currentCents: safeInteger(value.currentCents, `goals[${index}].currentCents`, { min: 0 }),
    targetDate,
  }
}

export function validateCloudPayload(value) {
  if (!isPlainRecord(value)) throw new HttpError(400, 'invalid_cloud_state', 'payload must be an object.')
  exactKeys(value, new Set(['state', 'secureData']), 'payload')
  if (!isPlainRecord(value.state)) throw new HttpError(400, 'invalid_cloud_state', 'payload.state must be an object.')
  exactKeys(value.state, new Set(['accounts', 'transactions', 'goals']), 'payload.state')
  if (!Array.isArray(value.state.accounts) || value.state.accounts.length > 1_000) throw new HttpError(400, 'invalid_cloud_state', 'accounts must be an array with at most 1,000 entries.')
  if (!Array.isArray(value.state.transactions) || value.state.transactions.length > MAX_TRANSACTIONS) throw new HttpError(400, 'invalid_cloud_state', `transactions must be an array with at most ${MAX_TRANSACTIONS.toLocaleString('en-US')} entries.`)
  if (!Array.isArray(value.state.goals) || value.state.goals.length > 1_000) throw new HttpError(400, 'invalid_cloud_state', 'goals must be an array with at most 1,000 entries.')

  const accounts = value.state.accounts.map(validateAccount)
  const transactions = value.state.transactions.map(validateTransaction)
  const goals = value.state.goals.map(validateGoal)
  const accountIds = new Set(accounts.map((account) => account.id))
  if (accountIds.size !== accounts.length) throw new HttpError(400, 'invalid_cloud_state', 'Account IDs must be unique.')
  if (new Set(transactions.map((transaction) => transaction.id)).size !== transactions.length) throw new HttpError(400, 'invalid_cloud_state', 'Transaction IDs must be unique.')
  if (new Set(goals.map((goal) => goal.id)).size !== goals.length) throw new HttpError(400, 'invalid_cloud_state', 'Goal IDs must be unique.')
  if (transactions.some((transaction) => !accountIds.has(transaction.accountId))) throw new HttpError(400, 'invalid_cloud_state', 'Every transaction must reference an existing account.')

  if (!isPlainRecord(value.secureData)) throw new HttpError(400, 'invalid_cloud_state', 'payload.secureData must be an object.')
  if (Object.keys(value.secureData).length > 200) throw new HttpError(400, 'invalid_cloud_state', 'payload.secureData has too many keys.')
  const secureData = validateJsonValue(value.secureData, 'payload.secureData')
  if (Buffer.byteLength(JSON.stringify(secureData), 'utf8') > MAX_SECURE_DATA_BYTES) throw new HttpError(400, 'invalid_cloud_state', 'payload.secureData is too large.')

  return { state: { accounts, transactions, goals }, secureData }
}

export function encryptCloudPayload(payload, secret, userId) {
  const key = keyFromSecret(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(bindingData(userId))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    format: 'finance-planner-user-state',
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }
}

export function decryptCloudPayload(envelope, secret, userId) {
  if (!isPlainRecord(envelope) || envelope.format !== 'finance-planner-user-state' || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('Unsupported encrypted user-state format.')
  }
  const iv = Buffer.from(String(envelope.iv || ''), 'base64url')
  const tag = Buffer.from(String(envelope.tag || ''), 'base64url')
  if (iv.length !== 12 || tag.length !== 16 || typeof envelope.ciphertext !== 'string') throw new Error('Invalid encrypted user-state envelope.')
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  decipher.setAAD(bindingData(userId))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  return validateCloudPayload(JSON.parse(plaintext))
}

export class StateVersionConflictError extends Error {
  constructor(currentVersion) {
    super('Cloud state changed on another device.')
    this.name = 'StateVersionConflictError'
    this.currentVersion = currentVersion
  }
}

export class PostgresUserStateStore {
  constructor(pool, secret) {
    if (!pool) throw new Error('PostgreSQL is required for cloud state persistence.')
    this.pool = pool
    this.secret = secret
  }

  async get(userId) {
    const result = await this.pool.query('SELECT encrypted_payload, version, updated_at FROM user_finance_state WHERE user_id=$1', [userId])
    if (!result.rowCount) return { payload: null, version: 0, updatedAt: null }
    const row = result.rows[0]
    return { payload: decryptCloudPayload(row.encrypted_payload, this.secret, userId), version: Number(row.version), updatedAt: new Date(row.updated_at).toISOString() }
  }

  async save(userId, value, expectedVersion) {
    const payload = validateCloudPayload(value)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new HttpError(400, 'invalid_cloud_state_version', 'expectedVersion must be a non-negative safe integer.')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query('SELECT version FROM user_finance_state WHERE user_id=$1 FOR UPDATE', [userId])
      const currentVersion = current.rowCount ? Number(current.rows[0].version) : 0
      if (currentVersion !== expectedVersion) throw new StateVersionConflictError(currentVersion)
      const nextVersion = currentVersion + 1
      const encrypted = encryptCloudPayload(payload, this.secret, userId)
      const result = currentVersion === 0
        ? await client.query('INSERT INTO user_finance_state (user_id, encrypted_payload, version, updated_at) VALUES ($1,$2,$3,now()) RETURNING version, updated_at', [userId, encrypted, nextVersion])
        : await client.query('UPDATE user_finance_state SET encrypted_payload=$2, version=$3, updated_at=now() WHERE user_id=$1 RETURNING version, updated_at', [userId, encrypted, nextVersion])
      await client.query('COMMIT')
      return { version: Number(result.rows[0].version), updatedAt: new Date(result.rows[0].updated_at).toISOString() }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}
