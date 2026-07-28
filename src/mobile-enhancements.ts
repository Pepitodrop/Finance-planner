export type HapticKind = 'tap' | 'success' | 'error'

const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  success: [12, 40, 18],
  error: [35, 45, 35],
}

const PULL_BLOCKING_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[data-no-pull-refresh]',
  '[role="slider"]',
].join(',')

export function triggerHaptic(kind: HapticKind = 'tap', vibrate = navigator.vibrate?.bind(navigator)) {
  if (!vibrate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return vibrate(HAPTIC_PATTERNS[kind])
}

export function isPullToRefreshTargetAllowed(target: EventTarget | null) {
  return !(target instanceof Element) || !target.closest(PULL_BLOCKING_SELECTOR)
}

export function canStartPullToRefresh(scrollY: number, touchCount: number, targetAllowed = true) {
  return scrollY <= 0 && touchCount === 1 && targetAllowed
}

export function isVerticalPull(deltaX: number, deltaY: number) {
  return deltaY > 0 && deltaY > Math.abs(deltaX) * 1.2
}

export function pullProgress(distance: number, threshold = 84) {
  return Math.max(0, Math.min(1, distance / threshold))
}

export function shouldRefreshFromPull(distance: number, threshold = 84) {
  return distance >= threshold
}

export function keyboardInset(viewportHeight: number, visualViewportHeight: number, offsetTop = 0) {
  return Math.max(0, Math.round(viewportHeight - visualViewportHeight - offsetTop))
}
