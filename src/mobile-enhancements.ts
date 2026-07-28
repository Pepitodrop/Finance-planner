export type HapticKind = 'tap' | 'success' | 'error'

const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  success: [12, 40, 18],
  error: [35, 45, 35],
}

export function triggerHaptic(kind: HapticKind = 'tap', vibrate = navigator.vibrate?.bind(navigator)) {
  if (!vibrate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return vibrate(HAPTIC_PATTERNS[kind])
}

export function canStartPullToRefresh(scrollY: number, touchCount: number, blocked = false) {
  return !blocked && scrollY <= 0 && touchCount === 1
}

export function isPullGestureBlocked(target: EventTarget | null, dialogOpen: boolean) {
  if (dialogOpen) return true
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, select, textarea, button, a[href], [contenteditable="true"], [role="dialog"]'))
}

export function pullProgress(distance: number, threshold = 84) {
  return Math.max(0, Math.min(1, distance / threshold))
}

export function shouldRefreshFromPull(distance: number, threshold = 84) {
  return distance >= threshold
}

export function viewportMetrics(viewport: Pick<VisualViewport, 'height' | 'offsetTop'> | null, fallbackHeight: number) {
  return {
    height: Math.max(0, Math.round(viewport?.height ?? fallbackHeight)),
    offsetTop: Math.max(0, Math.round(viewport?.offsetTop ?? 0)),
  }
}