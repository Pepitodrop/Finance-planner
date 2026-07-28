import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, BrainCircuit, DatabaseBackup, Landmark, Link2, Menu, MessageCircleQuestion, Plus, Repeat2, Share2, Target, WalletCards, X } from 'lucide-react'
import { isEditableTarget, MOBILE_TAB_ORDER, nextTabIndex, resolveSwipeDirection, viewportHeight } from './mobile-experience'

const PRIMARY_ITEMS = [
  { label: 'Übersicht', icon: WalletCards },
  { label: 'Transaktionen', icon: ArrowDownRight },
  { label: 'Sparziele', icon: Target },
  { label: 'Assistent', icon: MessageCircleQuestion },
] as const

const MORE_ITEMS = [
  { label: 'Verträge', icon: Repeat2 },
  { label: 'Verbindungen', icon: Link2 },
  { label: 'KI-Lernen', icon: BrainCircuit },
  { label: 'Daten', icon: DatabaseBackup },
] as const

function sidebarButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
}

function activate(label: string) {
  const button = sidebarButtons().find((candidate) => candidate.textContent?.trim().includes(label))
  button?.click()
  button?.focus({ preventScroll: true })
}

function currentLabel() {
  const active = document.querySelector<HTMLButtonElement>('.sidebar nav button.active')
  return MOBILE_TAB_ORDER.find((label) => active?.textContent?.includes(label)) ?? 'Übersicht'
}

export function MobileAppShell() {
  const [active, setActive] = useState(currentLabel)
  const [sheetOpen, setSheetOpen] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const allItems = useMemo(() => [...PRIMARY_ITEMS, ...MORE_ITEMS], [])

  useEffect(() => {
    const nav = document.querySelector('.sidebar nav')
    if (!nav) return
    const observer = new MutationObserver(() => setActive(currentLabel()))
    observer.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const updateViewport = () => {
      const height = viewportHeight(window.visualViewport?.height, window.innerHeight)
      document.documentElement.style.setProperty('--mobile-viewport-height', `${height}px`)
      document.documentElement.classList.toggle('mobile-keyboard-open', height < window.innerHeight * 0.78)
    }
    updateViewport()
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('orientationchange', updateViewport)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
    }
  }, [])

  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      if (!isEditableTarget(event.target)) return
      window.setTimeout(() => (event.target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (sheetOpen || event.touches.length !== 1 || isEditableTarget(event.target)) return
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStart.current
      touchStart.current = null
      if (!start || event.changedTouches.length !== 1) return
      const deltaX = event.changedTouches[0].clientX - start.x
      const deltaY = event.changedTouches[0].clientY - start.y
      const direction = resolveSwipeDirection(deltaX, deltaY)
      if (!direction) return
      const index = MOBILE_TAB_ORDER.indexOf(currentLabel())
      const target = MOBILE_TAB_ORDER[nextTabIndex(index, direction, MOBILE_TAB_ORDER.length)]
      if (target && target !== currentLabel()) activate(target)
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [sheetOpen])

  useEffect(() => {
    if (!sheetOpen) return
    const previous = document.activeElement as HTMLElement | null
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setSheetOpen(false)
    document.addEventListener('keydown', close)
    document.querySelector<HTMLButtonElement>('.mobile-sheet__close')?.focus()
    return () => {
      document.removeEventListener('keydown', close)
      previous?.focus?.()
    }
  }, [sheetOpen])

  const openTransaction = () => document.querySelector<HTMLButtonElement>('.topbar .primary')?.click()

  const share = async () => {
    if (navigator.share) await navigator.share({ title: document.title, text: 'Finance Planner', url: location.href })
    else await navigator.clipboard?.writeText(location.href)
  }

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Mobile Hauptnavigation">
        {PRIMARY_ITEMS.map(({ label, icon: Icon }) => (
          <button key={label} className={active === label ? 'active' : ''} aria-current={active === label ? 'page' : undefined} onClick={() => activate(label)}>
            <Icon size={20}/><span>{label === 'Transaktionen' ? 'Buchungen' : label}</span>
          </button>
        ))}
        <button className={MORE_ITEMS.some((item) => item.label === active) ? 'active' : ''} aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>
          <Menu size={20}/><span>Mehr</span>
        </button>
      </nav>

      <button className="mobile-fab" aria-label="Neue Buchung" onClick={openTransaction}><Plus size={24}/></button>

      {sheetOpen && <div className="mobile-sheet-backdrop" onClick={() => setSheetOpen(false)}>
        <section className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Weitere Bereiche" onClick={(event) => event.stopPropagation()}>
          <div className="mobile-sheet__handle" aria-hidden="true"/>
          <header><div><Landmark size={20}/><strong>Finance Planner</strong></div><button className="mobile-sheet__close" aria-label="Menü schließen" onClick={() => setSheetOpen(false)}><X size={20}/></button></header>
          <div className="mobile-sheet__grid">
            {allItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => { activate(label); setSheetOpen(false) }}><Icon size={20}/><span>{label}</span></button>)}
          </div>
          <button className="mobile-share" onClick={() => void share()}><Share2 size={18}/> App teilen</button>
        </section>
      </div>}
    </>
  )
}
