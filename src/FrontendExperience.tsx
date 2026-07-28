import { useEffect } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function enhanceChartAccessibility(root: ParentNode = document) {
  for (const chart of root.querySelectorAll<HTMLElement>('.chart, .recharts-responsive-container')) {
    if (chart.hasAttribute('role')) continue
    const panel = chart.closest<HTMLElement>('.panel')
    const title = panel?.querySelector<HTMLElement>('h2')?.textContent?.trim() || 'Finanzdiagramm'
    chart.setAttribute('role', 'img')
    chart.setAttribute('aria-label', title)
  }
}

function enhanceModal(modal: HTMLElement) {
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')

  const title = modal.querySelector<HTMLElement>('h2')
  if (title) {
    if (!title.id) title.id = 'finance-dialog-title'
    modal.setAttribute('aria-labelledby', title.id)
  }

  const background = document.querySelector<HTMLElement>('.app-shell')
  const previousOverflow = document.body.style.overflow
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.style.overflow = 'hidden'
  background?.setAttribute('aria-hidden', 'true')

  const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE))
  window.setTimeout(() => (focusable[0] || modal).focus(), 0)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      modal.querySelector<HTMLButtonElement>('.modal-actions .secondary')?.click()
      return
    }
    if (event.key !== 'Tab') return

    const current = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null)
    if (current.length === 0) {
      event.preventDefault()
      modal.focus()
      return
    }
    const first = current[0]
    const last = current[current.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  modal.addEventListener('keydown', onKeyDown)
  return () => {
    modal.removeEventListener('keydown', onKeyDown)
    document.body.style.overflow = previousOverflow
    background?.removeAttribute('aria-hidden')
    previousFocus?.focus({ preventScroll: true })
  }
}

export function FrontendExperience() {
  useEffect(() => {
    enhanceChartAccessibility()
    let cleanupModal: (() => void) | undefined
    let activeModal: HTMLElement | null = null

    const sync = () => {
      enhanceChartAccessibility()
      const modal = document.querySelector<HTMLElement>('.modal')
      if (modal === activeModal) return
      cleanupModal?.()
      activeModal = modal
      cleanupModal = modal ? enhanceModal(modal) : undefined
    }

    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    sync()

    return () => {
      observer.disconnect()
      cleanupModal?.()
    }
  }, [])

  return null
}
