import type { AppState } from './types'

/**
 * Production state is intentionally empty. A signed-in account receives no
 * sample balances, transactions, goals, or subscriptions from application
 * code. Test/acceptance fixtures live outside this production-state module.
 */
export const emptyProductionState: AppState = {
  accounts: [],
  transactions: [],
  goals: [],
}

/**
 * Application default. Keeping this as an alias preserves existing imports
 * while guaranteeing that a new or reset vault starts with no financial data.
 */
export const initialState: AppState = emptyProductionState
