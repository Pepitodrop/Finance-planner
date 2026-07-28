export const MOBILE_TAB_ORDER = ['Übersicht', 'Transaktionen', 'Sparziele', 'Verträge', 'Verbindungen', 'KI-Lernen', 'Assistent', 'Daten'] as const

export function resolveSwipeDirection(deltaX: number, deltaY: number, threshold = 72) {
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return 0
  return deltaX < 0 ? 1 : -1
}

export function nextTabIndex(current: number, direction: number, total: number) {
  return Math.max(0, Math.min(total - 1, current + direction))
}

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function viewportHeight(viewportHeight: number | undefined, fallbackHeight: number) {
  return Math.max(320, Math.round(viewportHeight ?? fallbackHeight))
}
