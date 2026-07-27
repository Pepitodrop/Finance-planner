export const MOBILE_BACKGROUND_LOCK_MS = 30_000

export function shouldLockAfterBackground(backgroundedAt: number | null, now: number, timeoutMs = MOBILE_BACKGROUND_LOCK_MS) {
  if (backgroundedAt === null) return false
  if (!Number.isFinite(backgroundedAt) || !Number.isFinite(now) || timeoutMs < 0) return true
  return now - backgroundedAt >= timeoutMs
}

export function setPrivacyShield(hidden: boolean, root: HTMLElement = document.documentElement) {
  root.classList.toggle('mobile-privacy-shielded', hidden)
}

export function isAllowedAppUrl(candidate: string, origin = window.location.origin) {
  try {
    const url = new URL(candidate, origin)
    if (url.origin !== origin) return false
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (url.username || url.password) return false
    return !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/oauth/') && !url.pathname.startsWith('/connectors/')
  } catch {
    return false
  }
}
