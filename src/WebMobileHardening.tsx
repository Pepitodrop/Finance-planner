import { useEffect, useState } from 'react'

const ROUTE_EVENT = 'finance-planner:navigation'

function focusMainContent() {
  const main = document.querySelector<HTMLElement>('main')
  if (!main) return
  main.tabIndex = -1
  main.focus({ preventScroll: true })
  window.setTimeout(() => main.removeAttribute('tabindex'), 0)
}

function currentSectionLabel() {
  return document.querySelector<HTMLElement>('.topbar h1')?.textContent?.trim() || 'Finance Planner'
}

export function WebMobileHardening() {
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    document.documentElement.classList.add('js-ready')

    const updateThemeColor = () => {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      meta?.setAttribute('content', dark ? '#07111f' : '#f7f9fc')
    }
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    updateThemeColor()
    scheme.addEventListener('change', updateThemeColor)

    const announceNavigation = () => {
      window.setTimeout(() => {
        const label = currentSectionLabel()
        document.title = `${label} · Finance Planner`
        setAnnouncement(`${label} geöffnet`)
      }, 0)
    }

    const handleRoute = () => announceNavigation()
    const handlePopState = () => {
      announceNavigation()
      focusMainContent()
    }
    window.addEventListener(ROUTE_EVENT, handleRoute)
    window.addEventListener('popstate', handlePopState)

    const nav = document.querySelector('.sidebar nav')
    const observer = new MutationObserver(announceNavigation)
    if (nav) observer.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] })
    announceNavigation()

    return () => {
      scheme.removeEventListener('change', updateThemeColor)
      window.removeEventListener(ROUTE_EVENT, handleRoute)
      window.removeEventListener('popstate', handlePopState)
      observer.disconnect()
    }
  }, [])

  return (
    <>
      <a className="skip-link" href="#main-content" onClick={() => window.setTimeout(focusMainContent, 0)}>
        Zum Hauptinhalt springen
      </a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    </>
  )
}
