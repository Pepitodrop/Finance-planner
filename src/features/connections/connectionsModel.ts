import type { ConnectorAccountType, ConnectorConnection } from '../../connectors'
import { consentDaysRemaining } from '../../connectors'
import { commonInstitutions, institutionById, searchInstitutions, type Institution, type InstitutionKind } from '../../institutions'

export type InstitutionCategory = 'popular' | InstitutionKind
export type SetupStep = 1 | 2 | 3

export const CATEGORY_OPTIONS: Array<{ id: InstitutionCategory; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'bank', label: 'Banks' },
  { id: 'wallet', label: 'PayPal' },
  { id: 'broker', label: 'Investments' },
  { id: 'card', label: 'Cards' },
  { id: 'manual', label: 'Manual' },
]

export const ACCOUNT_TYPE_OPTIONS: Array<{ id: ConnectorAccountType; label: string; description: string }> = [
  { id: 'checking', label: 'Checking account', description: 'Daily transactions and cash access' },
  { id: 'savings', label: 'Savings account', description: 'Save for goals and emergencies' },
  { id: 'credit-card', label: 'Credit card', description: 'Track spending and manage payments' },
  { id: 'investment', label: 'Investment account', description: 'Build wealth over time' },
]

export function filterInstitutions(searchTerm: string, category: InstitutionCategory, institutions: Institution[] = commonInstitutions): Institution[] {
  return searchInstitutions(searchTerm, institutions, category === 'popular' ? { popularOnly: true } : { kinds: [category] })
}

export function defaultAccountTypeForInstitution(institution: Institution): ConnectorAccountType {
  if (institution.kind === 'card') return 'credit-card'
  if (institution.kind === 'broker') return 'investment'
  return 'checking'
}

export function nextSetupStepAfterInstitution(institution: Institution): SetupStep {
  return institution.accountTypeRequired ? 2 : 3
}

export function previousSetupStepFromConfirmation(institution: Institution | undefined): SetupStep {
  return institution?.accountTypeRequired ? 2 : 1
}

export type ConnectionAttentionReason = 'provider-error' | 'consent-expired' | 'consent-expiring-soon' | null

export function connectionAttentionReason(connection: ConnectorConnection, now = Date.now()): ConnectionAttentionReason {
  if (connection.status === 'error') return 'provider-error'
  const days = consentDaysRemaining(connection, now)
  if (days !== null && days < 0) return 'consent-expired'
  if (days !== null && days <= 7) return 'consent-expiring-soon'
  return null
}

export function connectionNeedsAttention(connection: ConnectorConnection, now = Date.now()): boolean {
  return connectionAttentionReason(connection, now) !== null
}

export const ATTENTION_REASON_COPY: Record<Exclude<ConnectionAttentionReason, null>, { title: string; description: string }> = {
  'provider-error': { title: 'Provider error', description: 'The provider reported a problem while updating this connection.' },
  'consent-expired': { title: 'Consent expired', description: 'This can happen when consent has expired or the data provider returned an error.' },
  'consent-expiring-soon': { title: 'Consent expiring soon', description: 'Reauthorize soon to avoid an interruption in updates.' },
}

export interface AccountSelectionSummary { selectedCount: number; totalCount: number }
export function summarizeAccountSelection(discoveredAccountIds: string[], selectedAccountIds: ReadonlySet<string>): AccountSelectionSummary {
  const total = new Set(discoveredAccountIds)
  const selectedCount = discoveredAccountIds.filter((id) => selectedAccountIds.has(id)).length
  return { selectedCount, totalCount: total.size }
}

export const MAX_STATEMENT_FILE_BYTES = 5 * 1024 * 1024

export function parseEuroToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

export interface ManualAccountInput {
  name: string
  accountType: ConnectorAccountType
  balanceInput: string
  creditLimitInput: string
}

export interface ManualAccountValidationResult {
  error?: string
  balanceCents: number
  creditLimitCents?: number
}

export function validateManualAccount({ name, accountType, balanceInput, creditLimitInput }: ManualAccountInput): ManualAccountValidationResult {
  if (!name.trim()) return { error: 'Enter an account name.', balanceCents: 0 }

  const balanceCents = parseEuroToCents(balanceInput)
  if (balanceCents === null || !Number.isFinite(balanceCents)) return { error: 'Enter a valid current balance.', balanceCents: 0 }

  if (accountType !== 'credit-card') return { balanceCents }

  if (!creditLimitInput.trim()) return { balanceCents }
  const creditLimitCents = parseEuroToCents(creditLimitInput)
  if (creditLimitCents === null || !Number.isFinite(creditLimitCents)) return { error: 'Enter a valid credit limit, or leave it empty.', balanceCents: 0 }
  if (creditLimitCents < 0) return { error: 'Credit limit cannot be negative.', balanceCents: 0 }
  return { balanceCents, creditLimitCents }
}

export function institutionIcon(institution: Institution): 'bank' | 'wallet' | 'broker' | 'card' | 'manual' {
  if (institution.kind === 'wallet') return 'wallet'
  if (institution.kind === 'broker') return 'broker'
  if (institution.kind === 'card') return 'card'
  if (institution.kind === 'manual') return 'manual'
  return 'bank'
}

export { institutionById }
