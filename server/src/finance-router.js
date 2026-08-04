import { CobolBankingCore } from './cobol-banking-core.js'
import { projectSavingsBalance } from './cobol-engine.js'
import { getActiveDatabasePool } from './database.js'
import { HttpError } from './runtime-security.js'
import { PostgresUserStateStore, StateVersionConflictError } from './user-state-store.js'

const MAX_CLOUD_STATE_REQUEST_BYTES = 10_000_000
let cachedStateStore = null
let cachedPool = null

function stateStore(env) {
  const pool = getActiveDatabasePool()
  if (!pool) throw new HttpError(503, 'cloud_state_unavailable', 'Cloud state requires PostgreSQL persistence.')
  if (!cachedStateStore || cachedPool !== pool) {
    cachedPool = pool
    cachedStateStore = new PostgresUserStateStore(pool, env.CONNECTOR_MASTER_KEY || '')
  }
  return cachedStateStore
}

async function readCloudStateBody(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.')
  const declaredSize = Number(request.headers['content-length'] || 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_CLOUD_STATE_REQUEST_BYTES) throw new HttpError(413, 'payload_too_large', 'Cloud state request is too large.')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_CLOUD_STATE_REQUEST_BYTES) throw new HttpError(413, 'payload_too_large', 'Cloud state request is too large.')
    chunks.push(chunk)
  }
  if (!chunks.length) throw new HttpError(400, 'invalid_json', 'Cloud state request body is required.')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json', 'Invalid JSON request body.')
  }
}

function validateManualCreditCardInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'invalid_credit_card_input', 'Credit-card input must be an object.')
  }
  const allowed = new Set(['providerBalanceCents', 'creditLimitCents', 'pendingAmountCents'])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new HttpError(400, 'invalid_credit_card_input', `Unexpected credit-card field: ${key}`)
  }
  const providerBalanceCents = input.providerBalanceCents
  const creditLimitCents = input.creditLimitCents ?? 0
  const pendingAmountCents = input.pendingAmountCents ?? 0
  if (!Number.isSafeInteger(providerBalanceCents)) {
    throw new HttpError(400, 'invalid_credit_card_input', 'The outstanding balance must use integer cents.')
  }
  if (!Number.isSafeInteger(creditLimitCents) || creditLimitCents < 0) {
    throw new HttpError(400, 'invalid_credit_card_input', 'The credit limit must be a non-negative integer-cent value.')
  }
  if (!Number.isSafeInteger(pendingAmountCents) || pendingAmountCents < 0) {
    throw new HttpError(400, 'invalid_credit_card_input', 'The pending amount must be a non-negative integer-cent value.')
  }
  return { providerBalanceCents, creditLimitCents, pendingAmountCents }
}

export function createFinanceRouter({ env = process.env, send, body, userId, projectSavings = projectSavingsBalance, bankingCore } = {}) {
  const authoritativeBankingCore = bankingCore || new CobolBankingCore({
    binary: env.COBOL_BANKING_BINARY,
    required: env.COBOL_BANKING_REQUIRED === 'true',
  })

  return async function handleFinance(request, response, url) {
    if (url.pathname === '/api/finance/state') {
      const user = userId(request)
      const store = stateStore(env)
      if (request.method === 'GET') {
        send(response, 200, await store.get(user))
        return true
      }
      if (request.method === 'POST') {
        const input = await readCloudStateBody(request)
        try {
          const result = await store.save(user, input.payload, input.expectedVersion)
          send(response, 200, result)
        } catch (error) {
          if (error instanceof StateVersionConflictError) {
            send(response, 409, {
              error: { code: 'cloud_state_conflict', message: 'Cloud state changed on another device.' },
              currentVersion: error.currentVersion,
            })
          } else {
            throw error
          }
        }
        return true
      }
      return false
    }

    if (request.method === 'POST' && url.pathname === '/api/finance/normalize-credit-card') {
      userId(request)
      const input = validateManualCreditCardInput(await body(request))
      const normalized = await authoritativeBankingCore.normalizeCreditCard(input)
      send(response, 200, {
        ...input,
        ...normalized,
        calculationEngine: 'cobol',
      })
      return true
    }

    if (request.method !== 'POST' || url.pathname !== '/api/finance/project-savings') return false

    userId(request)
    const input = await body(request)
    const balanceCents = input.balanceCents
    const monthlyContributionCents = input.monthlyContributionCents
    const months = input.months

    if (!Number.isSafeInteger(balanceCents) || !Number.isSafeInteger(monthlyContributionCents)) {
      throw new HttpError(400, 'invalid_projection_input', 'Balance and monthly contribution must use integer cents.')
    }
    if (!Number.isSafeInteger(months) || months < 0 || months > 1200) {
      throw new HttpError(400, 'invalid_projection_input', 'Months must be an integer between 0 and 1200.')
    }

    const projectedBalanceCents = await projectSavings(balanceCents, monthlyContributionCents, months, env)
    send(response, 200, {
      balanceCents,
      monthlyContributionCents,
      months,
      projectedBalanceCents,
      calculationEngine: 'cobol',
    })
    return true
  }
}
