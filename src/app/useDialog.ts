import { useCallback, useEffect, useRef } from 'react'

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
  const elementRef = useRef<T | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // A callback ref (not a plain useRef assigned inside useEffect) so the
  // data-dialog-managed marker lands on the DOM node during React's commit
  // phase, before ANY component's effects run -- including a sibling like
  // FrontendExperience, whose own mount effect can otherwise run first and
  // find this element before an effect-based marker would have been set,
  // recreating the exact double-management race this marker exists to
  // prevent. See FrontendExperience.tsx's sync().
  const dialogRef = useCallback((node: T | null) => {
    elementRef.current = node
    node?.setAttribute('data-dialog-managed', 'true')
  }, [])

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement | null
    const mainContent = document.getElementById('main-content')
    const mobileNavigation = document.querySelector<HTMLElement>('.app-mobile-navigation')
    const inertedElements: HTMLElement[] = []
    const markInert = (element: HTMLElement | null) => {
      if (!element || element.hasAttribute('inert')) return
      element.setAttribute('inert', '')
      inertedElements.push(element)
    }

    const dialog = elementRef.current

    if (mainContent && dialog && mainContent.contains(dialog)) {
      // The Connections dialogs currently render inside the main region. Inert
      // only sibling branches along the dialog path so the background is
      // unavailable without making the dialog itself inert and unfocusable.
      let activeBranch: HTMLElement | null = dialog
      while (activeBranch && activeBranch !== mainContent) {
        const parentElement: HTMLElement | null = activeBranch.parentElement
        if (!parentElement) break
        for (const sibling of Array.from(parentElement.children)) {
          if (sibling !== activeBranch && sibling instanceof HTMLElement) markInert(sibling)
        }
        activeBranch = parentElement
      }
    } else {
      markInert(mainContent)
    }
    markInert(mobileNavigation)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () => Array.from(elementRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
    // Respect an element that already claimed focus on mount (e.g. an autoFocus
    // search field) instead of always stealing it for the first DOM element.
    if (!elementRef.current?.contains(document.activeElement)) focusable()[0]?.focus()

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
      for (const element of inertedElements) element.removeAttribute('inert')
      if (restoreFocus) previousFocusRef.current?.focus()
    }
  }, [open, onClose, restoreFocus])

  return dialogRef
}
