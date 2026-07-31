import { projectSavingsBalance } from './cobol-engine.js'
import { getActiveDatabasePool } from './database.js'
import { HttpError } from './runtime-security.js'
import { PostgresUserStateStore, StateVersionConflictError } from './user-state-store.js'

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

export function createFinanceRouter({ env = process.env, send, body, userId, projectSavings = projectSavingsBalance }) {
  return async function handleFinance(request, response, url) {
    if (url.pathname === '/api/finance/state') {
      const user = userId(request)
      const store = stateStore(env)
      if (request.method === 'GET') {
        send(response, 200, await store.get(user))
        return true
      }
      if (request.method === 'POST') {
        const input = await body(request)
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
