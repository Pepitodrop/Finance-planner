import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, DatabaseBackup, Link2, Menu, MessageCircleQuestion, Repeat2, Target, WalletCards, X } from 'lucide-react'

const destinations = [
  { key: 'dashboard', label: 'Übersicht', icon: WalletCards },
  { key: 'transactions', label: 'Transaktionen', icon: Repeat2 },
  { key: 'goals', label: 'Sparziele', icon: Target },
  { key: 'connections', label: 'Verbindungen', icon: Link2 },
  { key: 'ai', label: 'KI-Lernen', icon: BrainCircuit },
  { key: 'assistant', label: 'Assistent', icon: MessageCircleQuestion },
  { key: 'data', label: 'Daten', icon: DatabaseBackup },
] as const

type DestinationKey = typeof destinations[number]['key']

function activateDestination(label: string) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
  buttons.find((button) => button.textContent?.trim().includes(label))?.click()
}

function activeDestination(): DestinationKey {
  const active = document.querySelector<HTMLButtonElement>('.sidebar nav button.active')?.textContent ?? ''
  return destinations.find((destination) => active.includes(destination.label))?.key ?? 'dashboard'
}

export function MobileProductionSuite() {
  const [active, setActive] = useState<DestinationKey>(() => activeDestination())
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const dragStart = useRef<number | null>(null)
  const primary = useMemo(() => destinations.slice(0, 4), [])

  const navigate = (destination: typeof destinations[number]) => {
    activateDestination(destination.label)
    setActive(destination.key)
    setSheetOpen(false)
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  useEffect(() => {
    const observer = new MutationObserver(() => setActive(activeDestination()))
    const nav = document.querySelector('.sidebar nav')
    if (nav) observer.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const viewport = window.visualViewport
    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--mobile-viewport-height', `${height}px`)
      document.documentElement.classList.toggle('mobile-keyboard-open', height < window.innerHeight * 0.78)
    }
    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    const focusInput = (event: FocusEvent) => {
      const element = event.target as HTMLElement | null
      if (!element?.matches('input, select, textarea')) return
      window.setTimeout(() => element.scrollIntoView({ block: 'center', behavior: 'smooth' }), 180)
    }
    document.addEventListener('focusin', focusInput)
    return () => document.removeEventListener('focusin', focusInput)
  }, [])

  useEffect(() => {
    const start = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || (event.target as HTMLElement | null)?.closest('input, textarea, select, .chart, .mobile-sheet')) return
      swipeStart.current = { x: touch.clientX, y: touch.clientY }
    }
    const end = (event: TouchEvent) => {
      const startPoint = swipeStart.current
      const touch = event.changedTouches[0]
      swipeStart.current = null
      if (!startPoint || !touch) return
      const dx = touch.clientX - startPoint.x
      const dy = touch.clientY - startPoint.y
      if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 1.4) return
      const index = destinations.findIndex((item) => item.key === active)
      const next = dx < 0 ? Math.min(destinations.length - 1, index + 1) : Math.max(0, index - 1)
      if (next !== index) navigate(destinations[next])
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchend', end)
    }
  }, [active])

  useEffect(() => {
    if (!sheetOpen) return
    const previous = document.activeElement as HTMLElement | null
    const sheet = sheetRef.current
    sheet?.querySelector<HTMLElement>('button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false)
      if (event.key !== 'Tab' || !sheet) return
      const controls = Array.from(sheet.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [sheetOpen])

  useEffect(() => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
    images.forEach((image) => {
      image.loading ||= 'lazy'
      image.decoding ||= 'async'
    })
  }, [active])

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Mobile Hauptnavigation">
        {primary.map((destination) => {
          const Icon = destination.icon
          return <button key={destination.key} className={active === destination.key ? 'active' : ''} aria-current={active === destination.key ? 'page' : undefined} onClick={() => navigate(destination)}><Icon size={20}/><span>{destination.label}</span></button>
        })}
        <button className={primary.some((item) => item.key === active) ? '' : 'active'} aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}><Menu size={20}/><span>Mehr</span></button>
      </nav>

      {sheetOpen && <div className="mobile-sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSheetOpen(false) }}>
        <div ref={sheetRef} className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Weitere Bereiche"
          onPointerDown={(event) => { dragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerUp={(event) => { if (dragStart.current !== null && event.clientY - dragStart.current > 90) setSheetOpen(false); dragStart.current = null }}>
          <div className="mobile-sheet-handle" aria-hidden="true" />
          <div className="mobile-sheet-header"><strong>Weitere Bereiche</strong><button aria-label="Menü schließen" onClick={() => setSheetOpen(false)}><X size={20}/></button></div>
          <div className="mobile-sheet-grid">{destinations.map((destination) => { const Icon = destination.icon; return <button key={destination.key} className={active === destination.key ? 'active' : ''} onClick={() => navigate(destination)}><Icon size={22}/><span>{destination.label}</span></button> })}</div>
        </div>
      </div>}
    </>
  )
}
