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

/**
 * Compatibility hook for vaults created by older builds. The legacy sample
 * values themselves are deliberately no longer bundled in production code;
 * operator cleanup is handled by the explicit finance-data clear tool.
 */
export function isLegacyDemoState(_state: AppState): boolean {
  return false
}

// Acceptance fixtures are isolated from production defaults. Existing imports
// remain source-compatible while the acceptance harness is migrated fully to
// the dedicated fixture module.
export { accountsAcceptanceState, planningAcceptanceState } from './acceptance/financeStateFixtures'
