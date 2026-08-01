import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, CalendarClock, DatabaseBackup, Link2, Menu, MessageCircleQuestion, Repeat2, Share2, Target, WalletCards } from 'lucide-react'

type NavItem = {
  label: string
  view: string
  icon: ReactNode
}

const ITEMS: NavItem[] = [
  { label: 'Übersicht', view: 'dashboard', icon: <WalletCards size={20} /> },
  { label: 'Transaktionen', view: 'transactions', icon: <Repeat2 size={20} /> },
  { label: 'Sparziele', view: 'goals', icon: <Target size={20} /> },
  { label: 'Verbindungen', view: 'connections', icon: <Link2 size={20} /> },
  { label: 'Verträge', view: 'recurring', icon: <CalendarClock size={20} /> },
  { label: 'KI-Lernen', view: 'ai', icon: <Bot size={20} /> },
  { label: 'Assistent', view: 'assistant', icon: <MessageCircleQuestion size={20} /> },
  { label: 'Daten', view: 'data', icon: <DatabaseBackup size={20} /> },
]

let suppressNextHistory = false

function sidebarButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
}

function itemForButton(button: HTMLButtonElement) {
  return ITEMS.find((candidate) => button.textContent?.includes(candidate.label))
}

function activate(label: string, updateHistory = true) {
  const target = sidebarButtons().find((button) => button.textContent?.trim().includes(label))
  if (!target) return false
  suppressNextHistory = !updateHistory
  target.click()
  target.scrollIntoView({ block: 'nearest' })
  return true
}

function activateFromUrl() {
  const url = new URL(window.location.href)
  const item = ITEMS.find((candidate) => candidate.view === url.searchParams.get('view'))
  if (item && !activate(item.label, false)) return false

  if (url.searchParams.get('action') === 'new-transaction') {
    const transactionButton = document.querySelector<HTMLButtonElement>('.topbar .primary')
    if (!transactionButton) return false
    transactionButton.click()
    url.searchParams.delete('action')
    window.history.replaceState(window.history.state, '', url)
  }
  return true
}

export function MobileExperience() {
  const [active, setActive] = useState('Übersicht')
  const [moreOpen, setMoreOpen] = useState(false)
  const [isMobileNavigationPresented, setIsMobileNavigationPresented] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const primaryItems = useMemo(() => ITEMS.slice(0, 4), [])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsMobileNavigationPresented(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const boundButtons = new Map<HTMLButtonElement, EventListener>()
    let pendingUrlActivation = true

    const bindAndSync = () => {
      const buttons = sidebarButtons()
      for (const button of buttons) {
        if (boundButtons.has(button)) continue
        const listener: EventListener = () => {
          const item = itemForButton(button)
          if (!item) return
          if (suppressNextHistory) {
            suppressNextHistory = false
            return
          }
          const url = new URL(window.location.href)
          if (url.searchParams.get('view') === item.view && !url.searchParams.has('action')) return
          url.searchParams.set('view', item.view)
          url.searchParams.delete('action')
          window.history.pushState({ view: item.view }, '', url)
        }
        button.addEventListener('click', listener)
        boundButtons.set(button, listener)
      }

      const current = buttons.find((button) => button.classList.contains('active'))
      const item = current ? itemForButton(current) : undefined
      if (item) setActive(item.label)

      if (pendingUrlActivation && activateFromUrl()) pendingUrlActivation = false
    }

    const onPopState = () => {
      pendingUrlActivation = true
      bindAndSync()
    }

    bindAndSync()
    const observer = new MutationObserver(bindAndSync)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    window.addEventListener('popstate', onPopState)

    return () => {
      observer.disconnect()
      window.removeEventListener('popstate', onPopState)
      for (const [button, listener] of boundButtons) button.removeEventListener('click', listener)
    }
  }, [])

  useEffect(() => {
    const viewport = window.visualViewport
    const updateViewport = () => {
      const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
      document.documentElement.style.setProperty('--mobile-keyboard-height', `${keyboard}px`)
    }
    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
    }
  }, [])

  useEffect(() => {
    document.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      image.loading ||= 'lazy'
      image.decoding ||= 'async'
    })

    const idle = window.requestIdleCallback?.(() => document.documentElement.classList.add('mobile-idle-ready'))
      ?? window.setTimeout(() => document.documentElement.classList.add('mobile-idle-ready'), 500)
    return () => {
      if ('cancelIdleCallback' in window && typeof idle === 'number') window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, a, [role="button"], .chart')) return
      const touch = event.touches[0]
      if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY }
    }
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStart.current
      touchStart.current = null
      const touch = event.changedTouches[0]
      if (!start || !touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.3) return

      const buttons = sidebarButtons()
      const current = buttons.findIndex((button) => button.classList.contains('active'))
      if (current < 0) return
      const next = dx < 0 ? Math.min(buttons.length - 1, current + 1) : Math.max(0, current - 1)
      const item = ITEMS[next]
      if (item) activate(item.label)
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  useEffect(() => {
    if (!moreOpen) return
    previousFocus.current = document.activeElement as HTMLElement | null
    const sheet = document.querySelector<HTMLElement>('.mobile-bottom-sheet')
    sheet?.querySelector<HTMLButtonElement>('button')?.focus()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('keydown', close)
      previousFocus.current?.focus()
    }
  }, [moreOpen])

  const share = async () => {
    if (navigator.share) await navigator.share({ title: 'Finance Planner', url: window.location.href })
    else await navigator.clipboard?.writeText(window.location.href)
    setMoreOpen(false)
  }

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Mobile Hauptnavigation">
        {primaryItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className={active === item.label ? 'active' : ''}
            aria-current={isMobileNavigationPresented && active === item.label ? 'page' : undefined}
            onClick={() => activate(item.label)}
          >
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
        <button type="button" className={moreOpen ? 'active' : ''} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Menu size={20}/><span>Mehr</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-sheet-backdrop" onMouseDown={() => setMoreOpen(false)}>
          <section className="mobile-bottom-sheet" role="dialog" aria-modal="true" aria-label="Weitere Navigation" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mobile-bottom-sheet__handle" aria-hidden="true" />
            <h2>Weitere Bereiche</h2>
            <div className="mobile-bottom-sheet__grid">
              {ITEMS.slice(4).map((item) => (
                <button key={item.label} type="button" className={active === item.label ? 'active' : ''} aria-current={active === item.label ? 'page' : undefined} onClick={() => { activate(item.label); setMoreOpen(false) }}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
              <button type="button" onClick={() => void share()}><Share2 size={20}/><span>App teilen</span></button>
            </div>
          </section>
        </div>
      )}
      <div className="sr-only" aria-live="polite">{active}</div>
    </>
  )
}