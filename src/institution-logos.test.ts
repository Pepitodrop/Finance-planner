import { describe, expect, it } from 'vitest'
import { institutionLettermark, institutionLogoUrl } from './institution-logos'

describe('institutionLogoUrl', () => {
  it('returns a reviewed Simple Icons CDN URL for institutions with a verified brand asset', () => {
    expect(institutionLogoUrl('paypal')).toBe('https://cdn.simpleicons.org/paypal/003087')
    expect(institutionLogoUrl('n26')).toBe('https://cdn.simpleicons.org/n26')
    expect(institutionLogoUrl('commerzbank')).toBe('https://cdn.simpleicons.org/commerzbank/FFCC33')
    expect(institutionLogoUrl('deutsche-bank')).toBe('https://cdn.simpleicons.org/deutschebank/0018A8')
    expect(institutionLogoUrl('sparkasse')).toBe('https://cdn.simpleicons.org/sparkasse')
  })

  it('returns null (triggering the lettermark fallback) for institutions without a reviewed asset', () => {
    for (const id of ['ing', 'dkb', 'comdirect', 'postbank', 'hypovereinsbank', 'volksbank', 'trade-republic', 'unknown-institution']) {
      expect(institutionLogoUrl(id)).toBeNull()
    }
  })
})

describe('institutionLettermark', () => {
  it('uses curated monograms for institutions with a distinctive abbreviation', () => {
    expect(institutionLettermark('ing', 'ING').letters).toBe('ING')
    expect(institutionLettermark('dkb', 'DKB').letters).toBe('DKB')
    expect(institutionLettermark('hypovereinsbank', 'UniCredit Bank – HypoVereinsbank').letters).toBe('HVB')
  })

  it('derives initials from the name when no curated monogram exists', () => {
    expect(institutionLettermark('some-new-bank', 'Neue Bank AG').letters).toBe('NB')
  })

  it('is deterministic and gives every distinctive-identity institution its own color, never a real bank brand color', () => {
    const first = institutionLettermark('ing', 'ING')
    const second = institutionLettermark('ing', 'ING')
    expect(first.color).toBe(second.color)
    expect(first.color).not.toBe('#FFCC33') // Commerzbank's real brand hex
    expect(first.color).not.toBe('#0018A8') // Deutsche Bank's real brand hex
  })
})
