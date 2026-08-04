import { describe, expect, it } from 'vitest'
import { normalizeGoogleSubscriptions, reconcileGoogleSubscriptions, subscriptionMatchesTransaction } from './googleSubscriptions'
import type { AppState, Subscription, Transaction } from './types'

const subscription: Subscription = { id: 'google:1', externalId: '1', provider: 'Google', product: 'Google One', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active', source: 'google' }
const recurringTransaction: Transaction = { id: 'tx', accountId: 'a', description: 'GOOGLE *Google One', category: 'Abos', type: 'expense', amountCents: 199, date: '2026-08-01', recurring: true }

describe('Google subscriptions', () => {
  it('normalizes, validates, and deduplicates records', () => {
    const result = normalizeGoogleSubscriptions([
      { externalId: '1', provider: 'Google', product: 'Google One', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active' },
      { externalId: '1', provider: 'Google', product: 'Google One 2 TB', amountCents: 999, currency: 'EUR', billingInterval: 'monthly', status: 'active' },
      { externalId: '', provider: 'Google', product: 'Invalid', amountCents: -1, currency: 'EUR', billingInterval: 'monthly', status: 'active' },
    ], '2026-08-04T10:00:00.000Z')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'google:1', product: 'Google One 2 TB', amountCents: 999, source: 'google' })
  })

  it('matches recurring bank transactions using merchant, product, and amount', () => {
    expect(subscriptionMatchesTransaction(subscription, recurringTransaction)).toBe(true)
    expect(subscriptionMatchesTransaction(subscription, { ...recurringTransaction, recurring: false })).toBe(false)
    expect(subscriptionMatchesTransaction(subscription, { ...recurringTransaction, amountCents: 9999 })).toBe(false)
  })

  it('removes Google duplicates already represented by bank recurring payments', () => {
    const state: AppState = { accounts: [], goals: [], transactions: [recurringTransaction], subscriptions: [{ ...subscription, id: 'manual', source: 'manual' }] }
    const result = reconcileGoogleSubscriptions(state, [subscription])
    expect(result.subscriptions).toEqual([{ ...subscription, id: 'manual', source: 'manual' }])
  })
})
