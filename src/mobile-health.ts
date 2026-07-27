export interface StorageHealth {
  supported: boolean
  persisted: boolean
  usage: number
  quota: number
  usageRatio: number
  pressure: 'unknown' | 'healthy' | 'warning' | 'critical'
}

export function storagePressure(usage: number, quota: number): StorageHealth['pressure'] {
  if (quota <= 0 || usage < 0) return 'unknown'
  const ratio = usage / quota
  if (ratio >= 0.95) return 'critical'
  if (ratio >= 0.8) return 'warning'
  return 'healthy'
}

export async function readStorageHealth(storage: StorageManager | undefined): Promise<StorageHealth> {
  if (!storage?.estimate) {
    return { supported: false, persisted: false, usage: 0, quota: 0, usageRatio: 0, pressure: 'unknown' }
  }

  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
    storage.estimate(),
    storage.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ])

  return {
    supported: true,
    persisted,
    usage,
    quota,
    usageRatio: quota > 0 ? usage / quota : 0,
    pressure: storagePressure(usage, quota),
  }
}

export async function requestPersistentStorage(storage: StorageManager | undefined): Promise<boolean> {
  if (!storage?.persist) return false
  return storage.persist().catch(() => false)
}

export function isIosSafari(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  const webkit = /WebKit/.test(userAgent)
  const alternateBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
  return ios && webkit && !alternateBrowser
}

export function shouldShowIosInstallGuide(input: {
  standalone: boolean
  promptAvailable: boolean
  dismissedUntil: number
  now: number
  iosSafari: boolean
}) {
  return input.iosSafari && !input.standalone && !input.promptAvailable && input.dismissedUntil <= input.now
}
