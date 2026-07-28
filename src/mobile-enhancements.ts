export type HapticKind = 'tap' | 'success' | 'error'

export interface MobileViewportState {
  height: number
  offsetTop: number
  keyboardInset: number
  keyboardOpen: boolean
}

const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  success: [12, 40, 18],
  error: [35, 45, 35],
}

export function triggerHaptic(kind: HapticKind = 'tap', vibrate = navigator.vibrate?.bind(navigator)) {
  if (!vibrate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return vibrate(HAPTIC_PATTERNS[kind])
}

export function canStartPullToRefresh(scrollY: number, touchCount: number, keyboardOpen = false) {
  return scrollY <= 0 && touchCount === 1 && !keyboardOpen
}

export function pullProgress(distance: number, threshold = 84) {
  return Math.max(0, Math.min(1, distance / threshold))
}

export function shouldRefreshFromPull(distance: number, threshold = 84) {
  return distance >= threshold
}

export function mobileViewportState(
  layoutHeight: number,
  visualHeight = layoutHeight,
  offsetTop = 0,
  keyboardThreshold = 120,
): MobileViewportState {
  const safeLayoutHeight = Math.max(0, layoutHeight)
  const safeVisualHeight = Math.max(0, Math.min(visualHeight, safeLayoutHeight || visualHeight))
  const safeOffsetTop = Math.max(0, offsetTop)
  const keyboardInset = Math.max(0, safeLayoutHeight - safeVisualHeight - safeOffsetTop)

  return {
    height: safeVisualHeight || safeLayoutHeight,
    offsetTop: safeOffsetTop,
    keyboardInset,
    keyboardOpen: keyboardInset >= keyboardThreshold,
  }
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.matches('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
}
