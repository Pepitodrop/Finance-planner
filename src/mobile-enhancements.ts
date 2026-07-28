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

export function canStartPullToRefresh(scrollY: number, touchCount: number) {
  return scrollY <= 0 && touchCount === 1
}

export function pullProgress(distance: number, threshold = 84) {
  return Math.max(0, Math.min(1, distance / threshold))
}

export function shouldRefreshFromPull(distance: number, threshold = 84) {
  return distance >= threshold
}

export function keyboardInset(layoutHeight: number, viewportHeight: number, viewportOffsetTop = 0) {
  return Math.max(0, Math.round(layoutHeight - viewportHeight - viewportOffsetTop))
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]')
}
