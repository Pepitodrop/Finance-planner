import { describe, expect, it } from 'vitest'
import { commonInstitutions, institutionById, searchInstitutions } from './institutions'

describe('institution directory', () => {
  it('searches by bank name, alias, BIC, and BLZ', () => {
    expect(searchInstitutions('ING-DiBa')[0]?.id).toBe('ing')
    expect(searchInstitutions('BYLADEM1001')[0]?.id).toBe('dkb')
    expect(searchInstitutions('20041111')[0]?.id).toBe('comdirect')
    expect(searchInstitutions('VR Bank')[0]?.id).toBe('volksbank')
  })

  it('normalizes punctuation and diacritics', () => {
    expect(searchInstitutions('hypo vereinsbank')[0]?.id).toBe('hypovereinsbank')
    expect(searchInstitutions('unicredit-bank')[0]?.id).toBe('hypovereinsbank')
  })

  it('requires all search terms to match the same institution', () => {
    expect(searchInstitutions('deutsche bank').map((institution) => institution.id)).toContain('deutsche-bank')
    expect(searchInstitutions('paypal sparkasse')).toEqual([])
  })

  it('filters by connection category and provider', () => {
    expect(searchInstitutions('', commonInstitutions, { kinds: ['wallet'] }).map((institution) => institution.id)).toEqual(['paypal'])
    expect(searchInstitutions('', commonInstitutions, { providers: ['manual'] }).map((institution) => institution.id)).toEqual(['credit-card', 'manual'])
  })

  it('returns popular institutions first and supports exact lookup', () => {
    const results = searchInstitutions('')
    expect(results[0]?.popular).toBe(true)
    expect(institutionById('paypal')?.provider).toBe('paypal')
    expect(institutionById('missing')).toBeUndefined()
  })

  it('gives every bank a provider-agnostic "ais" identity -- no bank names a specific aggregator', () => {
    // ING is not GoCardless, DKB is not GoCardless: which concrete AIS
    // provider backs a connection attempt is resolved at runtime against
    // live provider directories, never hard-coded on the static catalogue.
    const banks = commonInstitutions.filter((institution) => institution.kind === 'bank')
    expect(banks.length).toBeGreaterThan(0)
    for (const bank of banks) expect(bank.provider).toBe('ais')
    expect(commonInstitutions.some((institution) => (institution.provider as string) === 'gocardless')).toBe(false)
  })
})
