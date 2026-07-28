import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, CalendarClock, DatabaseBackup, Link2, Menu, MessageCircleQuestion, Repeat2, Share2, Target, WalletCards } from 'lucide-react'

type NavItem = {
  label: string
  icon: ReactNode
}

const ITEMS: NavItem[] = [
  { label: 'Übersicht', icon: <WalletCards size={20} /> },
  { label: 'Transaktionen', icon: <Repeat2 size={20} /> },
  { label: 'Sparziele', icon: <Target size={20} /> },
  { label: 'Verbindungen', icon: <Link2 size={20} /> },
  { label: 'Verträge', icon: <CalendarClock size={20} /> },
  { label: 'KI-Lernen', icon: <Bot size={20} /> },
  { label: 'Assistent', icon: <MessageCircleQuestion size={20} /> },
  { label: 'Daten', icon: <DatabaseBackup size={20} /> },
]

function sidebarButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
}

function activate(label: string) {
  const target = sidebarButtons().find((button) => button.textContent?.trim().includes(label))
  target?.click()
  target?.scrollIntoView({ block: 'nearest' })
}

export function MobileExperience() {
  const [active, setActive] = useState('Übersicht')
  const [moreOpen, setMoreOpen] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const primaryItems = useMemo(() => ITEMS.slice(0, 4), [])

  useEffect(() => {
    const sync = () => {
      const current = sidebarButtons().find((button) => button.classList.contains('active'))
      const label = ITEMS.find((item) => current?.textContent?.includes(item.label))?.label
      if (label) setActive(label)
    }
    sync()
    const observer = new MutationObserver(sync)
    const nav = document.querySelector('.sidebar nav')
    if (nav) observer.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
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
      buttons[next]?.click()
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
            aria-current={active === item.label ? 'page' : undefined}
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
