import { describe, expect, it, vi } from 'vitest'
import {
  installDismissalDeadline,
  isSafeServiceWorkerUpdate,
  isStandaloneDisplay,
  requestServiceWorkerActivation,
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

  it('only treats a waiting worker as a safe update when a controller already exists', () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { controller: {} } })
    expect(isSafeServiceWorkerUpdate({ waiting: {} } as unknown as ServiceWorkerRegistration)).toBe(true)
    expect(isSafeServiceWorkerUpdate(undefined)).toBe(false)
    expect(isSafeServiceWorkerUpdate({ waiting: null } as unknown as ServiceWorkerRegistration)).toBe(false)

    // A first install has no controller yet -- there is no previous version
    // to update from, so this must never report a safe update.
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { controller: null } })
    expect(isSafeServiceWorkerUpdate({ waiting: {} } as unknown as ServiceWorkerRegistration)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('activates the waiting worker via postMessage without touching an absent registration', () => {
    const postMessage = vi.fn()
    requestServiceWorkerActivation({ waiting: { postMessage } } as unknown as ServiceWorkerRegistration)
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(() => requestServiceWorkerActivation(undefined)).not.toThrow()
  })
})
