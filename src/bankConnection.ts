import type { Transaction, TransactionType } from './types'

export type BankConsentStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'failed'
export type BankScope = 'accounts' | 'balances' | 'transactions'

export interface BankConsent {
  provider: string
  status: BankConsentStatus
  scopes: BankScope[]
  expiresAt: string
}

export interface BankSyncState {
  consent: BankConsent
  connectedAccounts: number
  lastSuccessfulSyncAt?: string
  paginationComplete: boolean
  idempotencyVerified: boolean
  retryPolicyConfigured: boolean
  webhookSignatureVerified: boolean
}

export interface BankConnectionReadiness {
  score: number
  productionReady: boolean
  passed: string[]
  failed: string[]
}

export interface BankTransactionRecord {
  providerTransactionId: string
  accountId: string
  description: string
  bookedAt: string
  amountCents: number
  currency: string
  category?: string
  recurring?: boolean
}

const REQUIRED_SCOPES: BankScope[] = ['accounts', 'balances', 'transactions']

export function assessBankConnectionReadiness(state: BankSyncState, now = new Date()): BankConnectionReadiness {
  const lastSyncAgeHours = state.lastSuccessfulSyncAt
    ? (now.getTime() - new Date(state.lastSuccessfulSyncAt).getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY
  const checks: Array<[string, boolean]> = [
    ['Consent is active', state.consent.status === 'active'],
    ['Consent is not expired', new Date(state.consent.expiresAt).getTime() > now.getTime()],
    ['Required PSD2 scopes granted', REQUIRED_SCOPES.every((scope) => state.consent.scopes.includes(scope))],
    ['At least one account connected', state.connectedAccounts > 0],
    ['Successful sync within 24 hours', lastSyncAgeHours <= 24],
    ['Pagination completed', state.paginationComplete],
    ['Idempotent imports verified', state.idempotencyVerified],
    ['Retry policy configured', state.retryPolicyConfigured],
    ['Webhook signatures verified', state.webhookSignatureVerified],
  ]
  const passed = checks.filter(([, ok]) => ok).map(([label]) => label)
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
  const score = Math.round(100 * passed.length / checks.length)
  return { score, productionReady: failed.length === 0, passed, failed }
}

function stableId(provider: string, providerTransactionId: string): string {
  return `bank:${provider}:${providerTransactionId}`
}

export function importBankTransactions(
  provider: string,
  records: BankTransactionRecord[],
  existing: Transaction[],
): { imported: Transaction[]; duplicates: number; rejected: string[] } {
  const known = new Set(existing.map((item) => item.id))
  const imported: Transaction[] = []
  const rejected: string[] = []
  let duplicates = 0

  for (const record of records) {
    const id = stableId(provider, record.providerTransactionId)
    if (known.has(id)) {
      duplicates += 1
      continue
    }
    if (record.currency !== 'EUR' || !record.providerTransactionId || !record.accountId || !record.bookedAt) {
      rejected.push(record.providerTransactionId || 'missing-id')
      continue
    }
    const type: TransactionType = record.amountCents >= 0 ? 'income' : 'expense'
    imported.push({
      id,
      accountId: record.accountId,
      description: record.description.trim() || 'Bank transaction',
      category: record.category ?? 'Uncategorized',
      type,
      amountCents: Math.abs(record.amountCents),
      date: record.bookedAt.slice(0, 10),
      recurring: record.recurring,
    })
    known.add(id)
  }

  return { imported, duplicates, rejected }
}
