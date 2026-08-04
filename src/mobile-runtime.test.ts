import { describe, expect, it } from 'vitest'
import {
  installDismissalDeadline,
  isStandaloneDisplay,
  shouldOfferInstall,
} from './mobile-runtime'

describe('mobile runtime policy', () => {
  it('detects browser and iOS standalone display modes', () => {
    expect(isStandaloneDisplay(true, false)).toBe(true)
    expect(isStandaloneDisplay(false, true)).toBe(true)
    expect(isStandaloneDisplay(false, false)).toBe(false)
  })

  it('offers installation only when a prompt exists and dismissal expired', () => {
    const now = Date.now()
    expect(shouldOfferInstall({ standalone: false, promptAvailable: true, offerEligible: true, dismissedUntil: 0, now })).toBe(true)
    expect(shouldOfferInstall({ standalone: true, promptAvailable: true, offerEligible: true, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, promptAvailable: false, offerEligible: true, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, promptAvailable: true, offerEligible: false, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, promptAvailable: true, offerEligible: true, dismissedUntil: now + 1, now })).toBe(false)
  })

  it('uses a bounded install-prompt dismissal window', () => {
    const now = 1_000
    expect(installDismissalDeadline(now, 14)).toBe(now + 14 * 24 * 60 * 60 * 1000)
  })
})
