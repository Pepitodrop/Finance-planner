import { describe, expect, it } from 'vitest'
import { commonInstitutions, groupInstitutions, searchInstitutions } from './institutions'

describe('institution directory', () => {
  it('finds institutions by name, BIC, and BLZ', () => {
    expect(searchInstitutions('ING')[0]?.id).toBe('ing')
    expect(searchInstitutions('COBADEHDXXX')[0]?.id).toBe('comdirect')
    expect(searchInstitutions('12030000')[0]?.id).toBe('dkb')
  })

  it('keeps popular institutions before alphabetical results', () => {
    const results = searchInstitutions('')
    const firstNonPopular = results.findIndex((institution) => !institution.popular)
    expect(firstNonPopular).toBeGreaterThan(0)
    expect(results.slice(0, firstNonPopular).every((institution) => institution.popular)).toBe(true)
  })

  it('separates banks, PayPal, brokers, cards, and manual accounts', () => {
    const groups = groupInstitutions(commonInstitutions)
    expect(groups.bank.some((institution) => institution.id === 'sparkasse')).toBe(true)
    expect(groups.wallet.map((institution) => institution.id)).toContain('paypal')
    expect(groups.broker.map((institution) => institution.id)).toContain('trade-republic')
    expect(groups.card.map((institution) => institution.id)).toContain('credit-card-manual')
    expect(groups.manual.map((institution) => institution.id)).toContain('manual')
  })
})
