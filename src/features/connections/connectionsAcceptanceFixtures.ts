import type { ConnectorConnection, ProviderDescriptor, SyncPreview } from '../../connectors'
import type { StatementPreview } from '../../statementImport'

/**
 * Deterministic, build-time-gated fixtures for Step 10C screenshot evidence.
 * Only ever read when VITE_ACCEPTANCE_FIXTURES=true (see ConnectionsPage and
 * App.tsx). Never touches persisted state, never calls a real provider.
 */
export type ConnectionsAcceptanceMode =
  | 'empty'
  | 'populated'
  | 'institution-selector'
  | 'institution-search'
  | 'account-type'
  | 'bank-confirmation'
  | 'paypal-confirmation'
  | 'checking'
  | 'sync-selection'
  | 'attention'
  | 'manual'
  | 'statement-preview'
  | 'provider-unavailable'

export const ACCEPTANCE_CONNECTIONS: ConnectorConnection[] = [
  { id: 'accept-sparkasse', provider: 'gocardless', displayName: 'Sparkasse', status: 'connected', lastSyncAt: '2026-08-05T09:15:00.000Z' },
  { id: 'accept-paypal', provider: 'paypal', displayName: 'PayPal', status: 'connected', consentExpiresAt: '2026-12-10T00:00:00.000Z' },
  { id: 'accept-deutsche-bank', provider: 'finapi', displayName: 'Deutsche Bank', status: 'error', error: 'Reauthorization required' },
]

export const ACCEPTANCE_PROVIDER_STATUS_UNAVAILABLE: ProviderDescriptor[] = [
  { id: 'gocardless', displayName: 'Bank (GoCardless)', kind: 'psd2-account-information', available: true, configured: true },
  { id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: true, mode: 'owner' },
  { id: 'finapi', displayName: 'Bank (finAPI)', kind: 'unavailable', available: false, configured: false, reason: 'finAPI adapter is not configured.' },
]

export const ACCEPTANCE_SYNC_PREVIEWS: SyncPreview[] = [{
  accountsToCreate: [
    { id: 'accept-sync-checking', name: 'Checking account', type: 'checking', balanceCents: 274_568, currency: 'EUR', lastSyncedAt: '2026-08-05T09:15:00.000Z' },
    { id: 'accept-sync-savings', name: 'Savings account', type: 'savings', balanceCents: 825_000, currency: 'EUR', lastSyncedAt: '2026-08-05T09:15:00.000Z' },
    { id: 'accept-sync-card', name: 'Credit card', type: 'credit-card', balanceCents: -120_435, currency: 'EUR', lastSyncedAt: '2026-08-05T09:15:00.000Z', creditCard: { amountOwedCents: 120_435, creditLimitCents: 300_000, availableCreditCents: 179_565, pendingAmountCents: 0 } },
  ],
  transactionsToImport: [
    { id: 'accept-sync-tx-1', accountId: 'accept-sync-checking', description: 'Grocery store', category: 'Groceries', type: 'expense', amountCents: 4_832, date: '2026-08-01' },
    { id: 'accept-sync-tx-2', accountId: 'accept-sync-checking', description: 'Salary payment', category: 'Income', type: 'income', amountCents: 218_000, date: '2026-08-03' },
  ],
  duplicateCount: 4,
  pendingCount: 2,
  quality: { score: 82, smartCategorized: 3, needsReview: 1, warnings: [] },
}]

export const ACCEPTANCE_STATEMENT_PREVIEW: StatementPreview = {
  format: 'csv',
  account: { id: 'accept-statement-account', name: 'Everyday checking', type: 'checking', balanceCents: 0, currency: 'EUR' },
  accountIsNew: true,
  transactions: [
    { id: 'accept-statement-tx-1', accountId: 'accept-statement-account', description: 'Grocery store', category: 'Unkategorisiert', type: 'expense', amountCents: 4_832, date: '2026-03-01' },
    { id: 'accept-statement-tx-2', accountId: 'accept-statement-account', description: 'Salary payment', category: 'Unkategorisiert', type: 'income', amountCents: 218_000, date: '2026-03-03' },
    { id: 'accept-statement-tx-3', accountId: 'accept-statement-account', description: 'Utility bill', category: 'Unkategorisiert', type: 'expense', amountCents: 7_645, date: '2026-03-05' },
    { id: 'accept-statement-tx-4', accountId: 'accept-statement-account', description: 'Streaming subscription', category: 'Unkategorisiert', type: 'expense', amountCents: 1_299, date: '2026-03-06' },
    { id: 'accept-statement-tx-5', accountId: 'accept-statement-account', description: 'Restaurant', category: 'Unkategorisiert', type: 'expense', amountCents: 3_450, date: '2026-03-07' },
  ],
  duplicates: 3,
  rejected: 1,
}
