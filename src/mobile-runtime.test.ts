import { describe, expect, it } from 'vitest'
import {
  installDismissalDeadline,
  isIOSDevice,
  isStandaloneDisplay,
  shouldOfferInstall,
  shouldOfferIOSInstall,
} from './mobile-runtime'

describe('mobile runtime policy', () => {
  it('detects browser and iOS standalone display modes', () => {
    expect(isStandaloneDisplay(true, false)).toBe(true)
    expect(isStandaloneDisplay(false, true)).toBe(true)
    expect(isStandaloneDisplay(false, false)).toBe(false)
  })

  it('detects iPhone, iPad and touch-capable iPad desktop mode', () => {
    expect(isIOSDevice('Mozilla/5.0 (iPhone)', 'iPhone', 5)).toBe(true)
    expect(isIOSDevice('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)).toBe(true)
    expect(isIOSDevice('Mozilla/5.0 (Macintosh)', 'MacIntel', 0)).toBe(false)
  })

  it('offers installation only when a prompt exists and dismissal expired', () => {
    const now = Date.now()
    expect(shouldOfferInstall({ standalone: false, promptAvailable: true, dismissedUntil: 0, now })).toBe(true)
    expect(shouldOfferInstall({ standalone: true, promptAvailable: true, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, promptAvailable: false, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferInstall({ standalone: false, promptAvailable: true, dismissedUntil: now + 1, now })).toBe(false)
  })

  it('shows manual iOS guidance only when the native prompt is unavailable', () => {
    const now = Date.now()
    expect(shouldOfferIOSInstall({ standalone: false, ios: true, promptAvailable: false, dismissedUntil: 0, now })).toBe(true)
    expect(shouldOfferIOSInstall({ standalone: false, ios: true, promptAvailable: true, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferIOSInstall({ standalone: true, ios: true, promptAvailable: false, dismissedUntil: 0, now })).toBe(false)
    expect(shouldOfferIOSInstall({ standalone: false, ios: false, promptAvailable: false, dismissedUntil: 0, now })).toBe(false)
  })

  it('uses a bounded install-prompt dismissal window', () => {
    const now = 1_000
    expect(installDismissalDeadline(now, 14)).toBe(now + 14 * 24 * 60 * 60 * 1000)
  })
})
