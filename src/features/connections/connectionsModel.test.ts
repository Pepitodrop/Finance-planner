import { describe, expect, it } from 'vitest'
import type { ConnectorConnection, ProviderDescriptor } from '../../connectors'
import {
  connectionAttentionReason,
  connectionNeedsAttention,
  defaultAccountTypeForInstitution,
  filterInstitutions,
  institutionAvailability,
  institutionById,
  nextSetupStepAfterInstitution,
  previousSetupStepFromConfirmation,
  providerDescriptorFor,
  summarizeAccountSelection,
  validateManualAccount,
  type ProviderStatus,
} from './connectionsModel'

describe('institutionAvailability', () => {
  const loading: ProviderStatus = { status: 'loading' }
  const errored: ProviderStatus = { status: 'error' }
  const providers: ProviderDescriptor[] = [
    { id: 'gocardless', displayName: 'Bank (GoCardless)', kind: 'psd2-account-information', available: true, configured: true },
    { id: 'finapi', displayName: 'Bank (finAPI)', kind: 'unavailable', available: false, configured: false, reason: 'finAPI adapter is not configured.' },
    { id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: false },
  ]
  const ready: ProviderStatus = { status: 'ready', providers }

  it('is always available for manual institutions regardless of provider status', () => {
    expect(institutionAvailability({ provider: 'manual' }, loading).unavailable).toBe(false)
    expect(institutionAvailability({ provider: 'manual' }, errored).unavailable).toBe(false)
    expect(institutionAvailability({ provider: 'manual' }, ready).unavailable).toBe(false)
  })

  it('fails closed for an external provider while status is loading, never optimistically available', () => {
    expect(institutionAvailability({ provider: 'gocardless' }, loading)).toEqual({ unavailable: true, reason: 'Checking availability…' })
  })

  it('fails closed for an external provider when status failed to load', () => {
    expect(institutionAvailability({ provider: 'gocardless' }, errored)).toEqual({ unavailable: true, reason: 'Availability could not be checked.' })
  })

  it('fails closed when a successful response is missing a descriptor for the provider (never defaults to available)', () => {
    expect(institutionAvailability({ provider: 'gocardless' }, { status: 'ready', providers: [] })).toEqual({ unavailable: true, reason: 'This provider is not available.' })
  })

  it('marks an explicitly unavailable provider (finAPI) as unavailable with its reason, never as a normal selectable institution', () => {
    expect(institutionAvailability({ provider: 'finapi' }, ready)).toEqual({ unavailable: true, reason: 'finAPI adapter is not configured.' })
  })

  it('marks an available-but-unconfigured provider as unavailable', () => {
    expect(institutionAvailability({ provider: 'paypal' }, ready)).toEqual({ unavailable: true, reason: 'PayPal is not configured yet.' })
  })

  it('is available only once status is ready and its provider reports both available and configured', () => {
    expect(institutionAvailability({ provider: 'gocardless' }, ready)).toEqual({ unavailable: false })
  })
})

describe('providerDescriptorFor', () => {
  const providers: ProviderDescriptor[] = [{ id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: true, mode: 'owner' }]

  it('returns undefined while loading or on error, never a stale/guessed descriptor', () => {
    expect(providerDescriptorFor('paypal', { status: 'loading' })).toBeUndefined()
    expect(providerDescriptorFor('paypal', { status: 'error' })).toBeUndefined()
  })

  it('returns the matching descriptor once ready', () => {
    expect(providerDescriptorFor('paypal', { status: 'ready', providers })?.mode).toBe('owner')
  })

  it('returns undefined for a provider missing from a successful response', () => {
    expect(providerDescriptorFor('gocardless', { status: 'ready', providers })).toBeUndefined()
  })
})

describe('filterInstitutions', () => {
  it('filters by category, mapping "popular" to popularOnly', () => {
    expect(filterInstitutions('', 'popular').every((institution) => institution.popular)).toBe(true)
    expect(filterInstitutions('', 'wallet').map((institution) => institution.id)).toEqual(['paypal'])
    expect(filterInstitutions('', 'manual').map((institution) => institution.id)).toEqual(['manual'])
    expect(filterInstitutions('', 'card').map((institution) => institution.id)).toEqual(['credit-card'])
  })

  it('supports search combined with a category', () => {
    expect(filterInstitutions('ing', 'bank').map((institution) => institution.id)).toEqual(['ing'])
    expect(filterInstitutions('paypal', 'bank')).toEqual([])
  })

  it('finds institutions with unusually long names without truncating the underlying data', () => {
    const hypo = institutionById('hypovereinsbank')
    expect(hypo?.name).toBe('UniCredit Bank – HypoVereinsbank')
    expect(filterInstitutions('hvb', 'popular').map((institution) => institution.id)).toContain('hypovereinsbank')
  })
})

describe('defaultAccountTypeForInstitution', () => {
  it('defaults card institutions to credit-card and brokers to investment', () => {
    expect(defaultAccountTypeForInstitution({ kind: 'card' } as never)).toBe('credit-card')
    expect(defaultAccountTypeForInstitution({ kind: 'broker' } as never)).toBe('investment')
    expect(defaultAccountTypeForInstitution({ kind: 'bank' } as never)).toBe('checking')
    expect(defaultAccountTypeForInstitution({ kind: 'wallet' } as never)).toBe('checking')
  })
})

describe('setup step transitions', () => {
  it('sends account-type-required institutions to step 2, others straight to step 3', () => {
    expect(nextSetupStepAfterInstitution({ accountTypeRequired: true } as never)).toBe(2)
    expect(nextSetupStepAfterInstitution({ accountTypeRequired: false } as never)).toBe(3)
    expect(nextSetupStepAfterInstitution({} as never)).toBe(3)
  })

  it('returns to step 2 from confirmation only when the institution required an account-type step', () => {
    expect(previousSetupStepFromConfirmation({ accountTypeRequired: true } as never)).toBe(2)
    expect(previousSetupStepFromConfirmation({ accountTypeRequired: false } as never)).toBe(1)
    expect(previousSetupStepFromConfirmation(undefined)).toBe(1)
  })
})

describe('connectionAttentionReason', () => {
  const base: ConnectorConnection = { id: 'c', provider: 'gocardless', displayName: 'Test bank', status: 'connected' }
  const now = Date.parse('2026-08-05T00:00:00.000Z')

  it('flags a provider error regardless of consent expiry', () => {
    expect(connectionAttentionReason({ ...base, status: 'error' }, now)).toBe('provider-error')
  })
  it('flags expired consent', () => {
    expect(connectionAttentionReason({ ...base, consentExpiresAt: '2026-08-01T00:00:00.000Z' }, now)).toBe('consent-expired')
  })
  it('flags consent expiring within 7 days', () => {
    expect(connectionAttentionReason({ ...base, consentExpiresAt: '2026-08-10T00:00:00.000Z' }, now)).toBe('consent-expiring-soon')
  })
  it('reports no attention needed for a healthy connection', () => {
    expect(connectionAttentionReason({ ...base, consentExpiresAt: '2026-12-01T00:00:00.000Z' }, now)).toBeNull()
    expect(connectionNeedsAttention({ ...base, consentExpiresAt: '2026-12-01T00:00:00.000Z' }, now)).toBe(false)
  })
})

describe('summarizeAccountSelection', () => {
  it('reconciles selected count against only the currently discovered accounts', () => {
    const summary = summarizeAccountSelection(['a', 'b', 'c'], new Set(['a', 'c', 'stale-id-not-discovered']))
    expect(summary).toEqual({ selectedCount: 2, totalCount: 3 })
  })
  it('reports zero selected when nothing is checked', () => {
    expect(summarizeAccountSelection(['a', 'b'], new Set())).toEqual({ selectedCount: 0, totalCount: 2 })
  })
})

describe('validateManualAccount', () => {
  it('requires a non-empty name', () => {
    const result = validateManualAccount({ name: '  ', accountType: 'checking', balanceInput: '10', creditLimitInput: '' })
    expect(result.error).toBe('Enter an account name.')
  })

  it('requires a finite current balance', () => {
    const result = validateManualAccount({ name: 'Cash', accountType: 'checking', balanceInput: 'not-a-number', creditLimitInput: '' })
    expect(result.error).toMatch(/current balance/)
  })

  it('accepts a valid checking account without a credit limit field', () => {
    const result = validateManualAccount({ name: 'Everyday', accountType: 'checking', balanceInput: '1234.56', creditLimitInput: '' })
    expect(result).toEqual({ balanceCents: 123_456 })
  })

  it('leaves the credit limit optional for credit cards', () => {
    const result = validateManualAccount({ name: 'Visa', accountType: 'credit-card', balanceInput: '250,75', creditLimitInput: '' })
    expect(result).toEqual({ balanceCents: 25_075 })
  })

  it('rejects a negative credit limit', () => {
    const result = validateManualAccount({ name: 'Visa', accountType: 'credit-card', balanceInput: '100', creditLimitInput: '-50' })
    expect(result.error).toBe('Credit limit cannot be negative.')
  })

  it('parses a valid credit limit for credit cards', () => {
    const result = validateManualAccount({ name: 'Visa', accountType: 'credit-card', balanceInput: '250.75', creditLimitInput: '3000' })
    expect(result).toEqual({ balanceCents: 25_075, creditLimitCents: 300_000 })
  })

  it('never produces a non-finite balance', () => {
    const result = validateManualAccount({ name: 'Cash', accountType: 'checking', balanceInput: 'Infinity', creditLimitInput: '' })
    expect(result.error).toMatch(/current balance/)
  })
})
