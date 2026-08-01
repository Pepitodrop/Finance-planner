import { useEffect, useState } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type BackgroundState = {
  element: HTMLElement
  ariaHidden: string | null
  inert: boolean
}

function enhanceChartAccessibility(root: ParentNode = document) {
  for (const chart of root.querySelectorAll<HTMLElement>('.chart, .recharts-responsive-container')) {
    if (chart.hasAttribute('role')) continue
    const panel = chart.closest<HTMLElement>('.panel')
    const title = panel?.querySelector<HTMLElement>('h2')?.textContent?.trim() || 'Finanzdiagramm'
    chart.setAttribute('role', 'img')
    chart.setAttribute('aria-label', title)
  }
}

function hideModalBackground(modal: HTMLElement) {
  const backdrop = modal.closest<HTMLElement>('.modal-backdrop')
  const parent = backdrop?.parentElement
  if (!backdrop || !parent) return []

  const states: BackgroundState[] = []
  for (const sibling of Array.from(parent.children)) {
    if (!(sibling instanceof HTMLElement) || sibling === backdrop) continue
    states.push({
      element: sibling,
      ariaHidden: sibling.getAttribute('aria-hidden'),
      inert: sibling.inert,
    })
    sibling.setAttribute('aria-hidden', 'true')
    sibling.inert = true
  }
  return states
}

function restoreModalBackground(states: BackgroundState[]) {
  for (const { element, ariaHidden, inert } of states) {
    if (ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', ariaHidden)
    element.inert = inert
  }
}

function enhanceModal(modal: HTMLElement) {
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  if (!modal.hasAttribute('tabindex')) modal.tabIndex = -1

  const title = modal.querySelector<HTMLElement>('h2')
  if (title) {
    if (!title.id) title.id = 'finance-dialog-title'
    modal.setAttribute('aria-labelledby', title.id)
  }

  const previousOverflow = document.body.style.overflow
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const backgroundStates = hideModalBackground(modal)
  document.body.style.overflow = 'hidden'

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
    restoreModalBackground(backgroundStates)
    previousFocus?.focus({ preventScroll: true })
  }
}

export function FrontendExperience() {
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    enhanceChartAccessibility()
    let cleanupModal: (() => void) | undefined
    let activeModal: HTMLElement | null = null
    let announcementTimer: number | undefined

    const announceTransactionSubmit = (event: SubmitEvent) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !form.matches('.modal[role="dialog"]')) return
      const description = new FormData(form).get('description')
      if (typeof description !== 'string' || !description.trim()) return
      setAnnouncement(`„${description.trim()}“ wurde gespeichert.`)
      if (announcementTimer) window.clearTimeout(announcementTimer)
      announcementTimer = window.setTimeout(() => setAnnouncement(''), 5_000)
    }

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
    document.addEventListener('submit', announceTransactionSubmit, true)
    sync()

    return () => {
      observer.disconnect()
      document.removeEventListener('submit', announceTransactionSubmit, true)
      if (announcementTimer) window.clearTimeout(announcementTimer)
      cleanupModal?.()
    }
  }, [])

  return <>
    <span className="sr-only">Finance Planner Finanzübersicht</span>
    {announcement && <div className="save-announcement" role="status" aria-live="polite">{announcement}</div>}
  </>
}
