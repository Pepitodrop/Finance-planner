import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Landmark, LockKeyhole, Menu, ShieldCheck, X } from 'lucide-react'
import {
  DESKTOP_DESTINATIONS,
  MOBILE_PRIMARY_DESTINATIONS,
  MORE_DESTINATIONS,
  MORE_DESTINATION_GROUPS,
  type DestinationId,
  type NavigationDestination,
} from './navigation'

interface ApplicationShellProps {
  activeDestination: DestinationId
  onNavigate: (destination: DestinationId) => void
  children: ReactNode
  overlays?: ReactNode
  onLockVault?: () => void
}

interface DestinationButtonProps {
  destination: NavigationDestination
  activeDestination: DestinationId
  onNavigate: (destination: DestinationId) => void
  className: string
}

function DestinationButton({ destination, activeDestination, onNavigate, className }: DestinationButtonProps) {
  const Icon = destination.icon
  const active = activeDestination === destination.id
  return <button
    type="button"
    className={`${className}${active ? ' is-active' : ''}`}
    aria-label={destination.accessibilityLabel}
    aria-current={active ? 'page' : undefined}
    title={destination.label}
    onClick={() => onNavigate(destination.id)}
  >
    <span className="app-navigation__icon" aria-hidden="true"><Icon size={20}/></span>
    <span className="app-navigation__label">{destination.label}</span>
  </button>
}

export function ApplicationShell({ activeDestination, onNavigate, children, overlays, onLockVault }: ApplicationShellProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const mobileNavigationRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef(true)
  const pendingMainFocusRef = useRef(false)
  const moreActive = MORE_DESTINATIONS.some((destination) => destination.id === activeDestination)

  const navigate = (destination: DestinationId) => {
    onNavigate(destination)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const closeMore = (restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus
    setMoreOpen(false)
  }

  const navigateFromMore = (destination: DestinationId) => {
    pendingMainFocusRef.current = true
    navigate(destination)
    closeMore(false)
  }

  useEffect(() => {
    if (!moreOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement | null
    restoreFocusRef.current = true
    const frame = frameRef.current
    const mobileNavigation = mobileNavigationRef.current
    frame?.setAttribute('inert', '')
    mobileNavigation?.setAttribute('inert', '')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () => Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])

    focusable()[0]?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMore()
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
      frame?.removeAttribute('inert')
      mobileNavigation?.removeAttribute('inert')
      if (restoreFocusRef.current) previousFocusRef.current?.focus()
    }
  }, [moreOpen])

  useEffect(() => {
    if (moreOpen || !pendingMainFocusRef.current) return
    pendingMainFocusRef.current = false
    document.getElementById('main-content')?.focus()
  }, [activeDestination, moreOpen])

  return <div className="app-shell">
    <div className="app-shell__frame" ref={frameRef} aria-hidden={moreOpen ? 'true' : undefined}>
      <aside className="sidebar app-navigation">
        <div className="brand app-navigation__brand">
          <div className="brand-mark"><Landmark size={22}/></div>
          <div className="app-navigation__brand-copy"><strong>Finance Planner</strong><span>Private. Clear. Yours.</span></div>
        </div>
        <nav aria-label="Primary navigation" className="app-navigation__destinations">
          {DESKTOP_DESTINATIONS.map((destination) => <DestinationButton
            key={destination.id}
            destination={destination}
            activeDestination={activeDestination}
            onNavigate={navigate}
            className="app-navigation__button"
          />)}
        </nav>
        {onLockVault && <button type="button" className="app-navigation__button app-navigation__security" aria-label="Lock encrypted finance vault" onClick={onLockVault}>
          <span className="app-navigation__icon" aria-hidden="true"><LockKeyhole size={20}/></span>
          <span className="app-navigation__label">Lock vault</span>
        </button>}
        <div className="privacy-note app-navigation__privacy">
          <ShieldCheck size={18} aria-hidden="true"/>
          <div><strong>Encrypted storage</strong><span>Sensitive connection secrets remain server-side.</span></div>
        </div>
      </aside>

      <main id="main-content" className="app-main-content fp-app-canvas" tabIndex={-1}>
        {children}
      </main>
    </div>

    <nav
      className="app-mobile-navigation"
      aria-label="Mobile primary navigation"
      ref={mobileNavigationRef}
      aria-hidden={moreOpen ? 'true' : undefined}
    >
      {MOBILE_PRIMARY_DESTINATIONS.map((destination) => <DestinationButton
        key={destination.id}
        destination={destination}
        activeDestination={activeDestination}
        onNavigate={navigate}
        className="app-mobile-navigation__button"
      />)}
      <button
        type="button"
        className={`app-mobile-navigation__button${moreActive || moreOpen ? ' is-active' : ''}`}
        aria-current={moreActive ? 'page' : undefined}
        aria-expanded={moreOpen}
        aria-haspopup="dialog"
        aria-controls="app-more-sheet"
        ref={moreButtonRef}
        onClick={() => setMoreOpen(true)}
      >
        <span className="app-navigation__icon" aria-hidden="true"><Menu size={20}/></span>
        <span className="app-navigation__label">More</span>
      </button>
    </nav>

    {moreOpen && <div className="app-more-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeMore()
    }}>
      <section
        id="app-more-sheet"
        className="app-more-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-more-title"
        lang="en"
        data-more-ready="true"
        ref={sheetRef}
      >
        <div className="app-more-sheet__header">
          <h2 id="app-more-title">More destinations</h2>
          <button type="button" className="app-more-sheet__close" aria-label="Close more destinations" onClick={() => closeMore()}>
            <X size={20}/>
          </button>
        </div>
        <nav aria-label="More destinations" className="app-more-sheet__destinations">
          {MORE_DESTINATION_GROUPS.map((group) => <div className="app-more-sheet__group" key={group.id}>
            <p className="app-more-sheet__group-label">{group.label}</p>
            {group.destinations.map((destination) => <DestinationButton
              key={destination.id}
              destination={destination}
              activeDestination={activeDestination}
              onNavigate={navigateFromMore}
              className="app-more-sheet__button"
            />)}
          </div>)}
        </nav>
        {onLockVault && <button type="button" className="app-more-sheet__security" onClick={() => {
          closeMore(false)
          onLockVault()
        }}><LockKeyhole size={18} aria-hidden="true"/> Lock encrypted finance vault</button>}
      </section>
    </div>}

    {overlays}
  </div>
}
