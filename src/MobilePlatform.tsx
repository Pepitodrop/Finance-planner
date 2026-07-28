import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, DatabaseBackup, Landmark, Link2, Menu, MessageCircleQuestion, Repeat2, Target, WalletCards } from 'lucide-react'

const destinations = [
  { label: 'Übersicht', icon: WalletCards },
  { label: 'Transaktionen', icon: Landmark },
  { label: 'Sparziele', icon: Target },
  { label: 'Verträge', icon: Repeat2 },
  { label: 'Verbindungen', icon: Link2 },
  { label: 'KI-Lernen', icon: BrainCircuit },
  { label: 'Assistent', icon: MessageCircleQuestion },
  { label: 'Daten', icon: DatabaseBackup },
] as const

function sidebarButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
}

export function MobilePlatform() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const primary = useMemo(() => destinations.slice(0, 4), [])

  const navigate = (index: number) => {
    const button = sidebarButtons()[index]
    if (!button) return
    button.click()
    setActiveIndex(index)
    setMoreOpen(false)
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  useEffect(() => {
    const sync = () => {
      const index = sidebarButtons().findIndex((button) => button.classList.contains('active'))
      if (index >= 0) setActiveIndex(index)
    }
    sync()
    const observer = new MutationObserver(sync)
    const nav = document.querySelector('.sidebar nav')
    if (nav) observer.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const start = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || event.touches.length !== 1) return
      touchStart.current = { x: touch.clientX, y: touch.clientY }
    }
    const end = (event: TouchEvent) => {
      const origin = touchStart.current
      const touch = event.changedTouches[0]
      touchStart.current = null
      if (!origin || !touch) return
      const dx = touch.clientX - origin.x
      const dy = touch.clientY - origin.y
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.35) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [data-no-swipe], .chart, .recharts-wrapper')) return
      navigate(Math.max(0, Math.min(destinations.length - 1, activeIndex + (dx < 0 ? 1 : -1))))
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchend', end)
    }
  }, [activeIndex])

  useEffect(() => {
    const focusInput = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.matches('input, textarea, select')) return
      window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 180)
    }
    document.addEventListener('focusin', focusInput)
    return () => document.removeEventListener('focusin', focusInput)
  }, [])

  useEffect(() => {
    const optimizeImages = () => {
      document.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
        if (!image.loading) image.loading = 'lazy'
        image.decoding = 'async'
        image.fetchPriority = image.closest('header, .topbar') ? 'high' : 'auto'
      })
    }
    optimizeImages()
    const observer = new MutationObserver(optimizeImages)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', media.matches ? '#0b1020' : '#f8fafc')
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Mobile Hauptnavigation">
        {primary.map(({ label, icon: Icon }, index) => (
          <button key={label} className={activeIndex === index ? 'active' : ''} onClick={() => navigate(index)} aria-current={activeIndex === index ? 'page' : undefined}>
            <Icon size={20} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
        <button className={activeIndex >= 4 ? 'active' : ''} onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} aria-controls="mobile-more-sheet">
          <Menu size={20} aria-hidden="true" /><span>Mehr</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-sheet-backdrop" onPointerDown={() => setMoreOpen(false)}>
          <section id="mobile-more-sheet" className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Weitere Navigation" onPointerDown={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-handle" aria-hidden="true" />
            <div className="mobile-sheet-header"><strong>Weitere Bereiche</strong><button onClick={() => setMoreOpen(false)} aria-label="Menü schließen">×</button></div>
            <div className="mobile-sheet-grid">
              {destinations.slice(4).map(({ label, icon: Icon }, offset) => {
                const index = offset + 4
                return <button key={label} className={activeIndex === index ? 'active' : ''} onClick={() => navigate(index)}><Icon size={21} aria-hidden="true" /><span>{label}</span></button>
              })}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
