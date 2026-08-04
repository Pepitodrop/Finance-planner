import { useEffect, useState } from 'react'

function focusMainContent() {
  const main = document.querySelector<HTMLElement>('main')
  if (!main) return
  main.id = 'main-content'
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
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#07111f' : '#f7f9fc')
    }
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    updateThemeColor()
    scheme.addEventListener('change', updateThemeColor)

    let previousLabel = ''
    const syncApplicationShell = () => {
      const main = document.querySelector<HTMLElement>('main')
      if (main && main.id !== 'main-content') main.id = 'main-content'
      const label = currentSectionLabel()
      if (label === previousLabel) return
      previousLabel = label
      document.title = `${label} · Finance Planner`
      setAnnouncement(`${label} geöffnet`)
    }

    const handlePopState = () => window.setTimeout(() => {
      syncApplicationShell()
      focusMainContent()
    }, 0)
    const handleUpdate = (event: Event) => {
      const registration = (event as CustomEvent<{ registration: ServiceWorkerRegistration }>).detail?.registration
      if (registration?.waiting) {
        setAnnouncement('Eine neue Version ist verfügbar.')
      }
    }

    const observer = new MutationObserver(syncApplicationShell)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('finance-planner:update-available', handleUpdate)
    syncApplicationShell()

    return () => {
      scheme.removeEventListener('change', updateThemeColor)
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('finance-planner:update-available', handleUpdate)
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
