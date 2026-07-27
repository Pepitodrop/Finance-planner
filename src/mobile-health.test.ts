import { describe, expect, it, vi } from 'vitest'
import {
  isIosSafari,
  readStorageHealth,
  requestPersistentStorage,
  shouldShowIosInstallGuide,
  storagePressure,
} from './mobile-health'

describe('mobile health', () => {
  it('classifies storage pressure conservatively', () => {
    expect(storagePressure(10, 0)).toBe('unknown')
    expect(storagePressure(50, 100)).toBe('healthy')
    expect(storagePressure(80, 100)).toBe('warning')
    expect(storagePressure(95, 100)).toBe('critical')
  })

  it('reads persistence and quota information', async () => {
    const storage = {
      estimate: vi.fn().mockResolvedValue({ usage: 85, quota: 100 }),
      persisted: vi.fn().mockResolvedValue(true),
    } as unknown as StorageManager

    await expect(readStorageHealth(storage)).resolves.toMatchObject({
      supported: true,
      persisted: true,
      usageRatio: 0.85,
      pressure: 'warning',
    })
  })

  it('requests persistent storage without surfacing browser failures', async () => {
    const storage = { persist: vi.fn().mockRejectedValue(new Error('denied')) } as unknown as StorageManager
    await expect(requestPersistentStorage(storage)).resolves.toBe(false)
  })

  it('recognizes Safari on touch-capable Apple devices', () => {
    expect(isIosSafari('Mozilla/5.0 iPhone AppleWebKit/605.1.15 Safari/604.1', 'iPhone', 5)).toBe(true)
    expect(isIosSafari('Mozilla/5.0 iPhone AppleWebKit/605.1.15 CriOS/125.0', 'iPhone', 5)).toBe(false)
    expect(isIosSafari('Mozilla/5.0 Macintosh AppleWebKit/605.1.15 Safari/605.1.15', 'MacIntel', 0)).toBe(false)
  })

  it('shows the iOS install guide only when no native prompt is available', () => {
    expect(shouldShowIosInstallGuide({ iosSafari: true, standalone: false, promptAvailable: false, dismissedUntil: 0, now: 1 })).toBe(true)
    expect(shouldShowIosInstallGuide({ iosSafari: true, standalone: true, promptAvailable: false, dismissedUntil: 0, now: 1 })).toBe(false)
    expect(shouldShowIosInstallGuide({ iosSafari: true, standalone: false, promptAvailable: true, dismissedUntil: 0, now: 1 })).toBe(false)
  })
})
