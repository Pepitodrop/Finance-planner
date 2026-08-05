import { useEffect, useRef } from 'react'

interface UseDialogOptions {
  open: boolean
  onClose: () => void
  restoreFocus?: boolean
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Same inert/scroll-lock/tab-trap/restore-focus behaviour as ApplicationShell's
 * "More" sheet, extracted so other dialogs (Connections setup, manual-account
 * form, confirmations) don't reimplement it.
 */
export function useDialog<T extends HTMLElement>({ open, onClose, restoreFocus = true }: UseDialogOptions) {
  const dialogRef = useRef<T>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement | null
    const mainContent = document.getElementById('main-content')
    const mobileNavigation = document.querySelector<HTMLElement>('.app-mobile-navigation')
    mainContent?.setAttribute('inert', '')
    mobileNavigation?.setAttribute('inert', '')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
    // Respect an element that already claimed focus on mount (e.g. an autoFocus
    // search field) instead of always stealing it for the first DOM element.
    if (!dialogRef.current?.contains(document.activeElement)) focusable()[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      mainContent?.removeAttribute('inert')
      mobileNavigation?.removeAttribute('inert')
      if (restoreFocus) previousFocusRef.current?.focus()
    }
  }, [open, onClose, restoreFocus])

  return dialogRef
}
