import { describe, expect, it } from 'vitest'
import { isAppState, validateTransactionInput } from './validation'

describe('runtime validation', () => {
  it('rejects transactions referencing missing accounts', () => {
    expect(isAppState({
      accounts: [],
      transactions: [{ id: 't', accountId: 'missing', description: 'Test', category: 'Sonstiges', type: 'expense', amountCents: 100, date: '2026-07-01' }],
      goals: [],
    })).toBe(false)
  })

  it('accepts a valid empty state', () => {
    expect(isAppState({ accounts: [], transactions: [], goals: [] })).toBe(true)
  })

  it('accepts credit-card accounts used by the liability UI', () => {
    expect(isAppState({
      accounts: [{ id: 'card-1', name: 'Test Kreditkarte', type: 'credit-card', balanceCents: -84530, currency: 'EUR' }],
      transactions: [{ id: 'tx-1', accountId: 'card-1', description: 'Test Streaming', category: 'Subscriptions', type: 'expense', amountCents: 1799, date: '2026-08-08', recurring: true }],
      goals: [],
    })).toBe(true)
  })

  it('rejects non-positive amounts', () => {
    expect(validateTransactionInput({ accountId: 'a', description: 'Test', category: 'Sonstiges', amount: 0, date: '2026-07-01' })).not.toBeNull()
  })

  // Found live 2026-08-26 (PR #154, sixth Mock ASPSP pass): this file
  // validated only the always-required Account fields, so a connector-
  // imported account (buildSyncPreview() in src/connectors.ts) that this
  // function accepted as a normal Account could still be predictably
  // rejected by /api/finance/state the moment it actually reached the
  // server's own validator (server/src/user-state-store.js). These tests
  // keep the two coherent going forward.
  it('accepts a real connector-imported account (the exact shape buildSyncPreview() creates)', () => {
    expect(isAppState({
      accounts: [{
        id: 'connector:enablebanking:acct-1',
        externalId: 'acct-1',
        institutionId: 'DE:ING-DiBa',
        name: 'Girokonto',
        type: 'checking',
        balanceCents: 695950,
        currency: 'EUR',
        lastSyncedAt: '2026-08-26T14:19:00.000Z',
      }],
      transactions: [],
      goals: [],
    })).toBe(true)
  })

  it('accepts valid creditCard metadata on a connector-imported credit-card account', () => {
    expect(isAppState({
      accounts: [{
        id: 'connector:enablebanking:card-1',
        externalId: 'card-1',
        name: 'Kreditkarte',
        type: 'credit-card',
        balanceCents: -84530,
        currency: 'EUR',
        creditCard: {
          amountOwedCents: 84530,
          availableCreditCents: 415470,
          creditLimitCents: 500000,
          statementDate: '2026-08-01',
          paymentDueDate: '2026-08-20',
        },
      }],
      transactions: [],
      goals: [],
    })).toBe(true)
  })

  it('rejects a malformed lastSyncedAt', () => {
    expect(isAppState({
      accounts: [{ id: 'a', name: 'Test', type: 'checking', balanceCents: 0, currency: 'EUR', lastSyncedAt: 'not-a-real-date' }],
      transactions: [],
      goals: [],
    })).toBe(false)
  })

  it('rejects an empty (present-but-blank) externalId', () => {
    expect(isAppState({
      accounts: [{ id: 'a', name: 'Test', type: 'checking', balanceCents: 0, currency: 'EUR', externalId: '' }],
      transactions: [],
      goals: [],
    })).toBe(false)
  })

  it('rejects malformed/unknown creditCard fields', () => {
    expect(isAppState({
      accounts: [{ id: 'a', name: 'Test', type: 'credit-card', balanceCents: -100, currency: 'EUR', creditCard: { amountOwedCents: 100, providerRawBalance: 1 } }],
      transactions: [],
      goals: [],
    })).toBe(false)
    expect(isAppState({
      accounts: [{ id: 'a', name: 'Test', type: 'credit-card', balanceCents: -100, currency: 'EUR', creditCard: { amountOwedCents: -100 } }],
      transactions: [],
      goals: [],
    })).toBe(false)
  })

  it('accepts a state with no subscriptions key at all', () => {
    expect(isAppState({ accounts: [], transactions: [], goals: [] })).toBe(true)
  })

  it('accepts a well-formed subscriptions array', () => {
    expect(isAppState({
      accounts: [],
      transactions: [],
      goals: [],
      subscriptions: [{
        id: 'google:sub-1',
        provider: 'google-subscriptions',
        product: 'YouTube Premium',
        amountCents: 1299,
        currency: 'EUR',
        billingInterval: 'monthly',
        status: 'active',
        source: 'google',
      }],
    })).toBe(true)
  })

  it('rejects a subscriptions entry with an invalid status/billingInterval/source', () => {
    const base = { id: 's', provider: 'google-subscriptions', product: 'X', amountCents: 100, currency: 'EUR', billingInterval: 'monthly', status: 'active', source: 'google' }
    expect(isAppState({ accounts: [], transactions: [], goals: [], subscriptions: [{ ...base, status: 'not-a-real-status' }] })).toBe(false)
    expect(isAppState({ accounts: [], transactions: [], goals: [], subscriptions: [{ ...base, billingInterval: 'daily' }] })).toBe(false)
    expect(isAppState({ accounts: [], transactions: [], goals: [], subscriptions: [{ ...base, source: 'unknown-source' }] })).toBe(false)
  })

  // Found by adversarial review (PR #154, cloud-state schema fix follow-up):
  // isSubscription() had no length bounds on id/provider/product at all, so
  // a subscription this function accepted could still be predictably
  // rejected by the server's validateSubscription() (id<=128, provider<=80,
  // product<=160 in server/src/user-state-store.js).
  it('rejects a subscription with an oversized id/provider/product', () => {
    const base = { id: 's', provider: 'google-subscriptions', product: 'X', amountCents: 100, currency: 'EUR', billingInterval: 'monthly', status: 'active', source: 'google' }
    expect(isAppState({ accounts: [], transactions: [], goals: [], subscriptions: [{ ...base, id: 'x'.repeat(129) }] })).toBe(false)
    expect(isAppState({ accounts: [], transactions: [], goals: [], subscriptions: [{ ...base, provider: 'x'.repeat(81) }] })).toBe(false)
    expect(isAppState({ accounts: [], transactions: [], goals: [], subscriptions: [{ ...base, product: 'x'.repeat(161) }] })).toBe(false)
  })

  // Found by the same review pass: isOptionalNonNegativeInteger() used
  // isFiniteInteger(), which accepts any integer-valued number up to
  // Number.MAX_VALUE (e.g. 1e20), while the server's safeInteger() caps at
  // Number.MAX_SAFE_INTEGER -- a value this function accepted could still
  // be rejected server-side.
  it('rejects a creditCard integer field beyond Number.MAX_SAFE_INTEGER', () => {
    expect(isAppState({
      accounts: [{ id: 'a', name: 'Test', type: 'credit-card', balanceCents: -100, currency: 'EUR', creditCard: { amountOwedCents: 100, availableCreditCents: Number.MAX_SAFE_INTEGER + 2 } }],
      transactions: [],
      goals: [],
    })).toBe(false)
    expect(isAppState({
      accounts: [{ id: 'a', name: 'Test', type: 'credit-card', balanceCents: -100, currency: 'EUR', creditCard: { amountOwedCents: Number.MAX_SAFE_INTEGER + 2 } }],
      transactions: [],
      goals: [],
    })).toBe(false)
  })
})
