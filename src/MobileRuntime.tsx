import { useEffect, useMemo, useState } from 'react'
import {
  installDismissalDeadline,
  isIOSDevice,
  isSafeServiceWorkerUpdate,
  isStandaloneDisplay,
  requestServiceWorkerActivation,
  shouldOfferInstall,
  shouldOfferIOSInstall,
  type InstallPromptEvent,
} from './mobile-runtime'

const DISMISSAL_KEY = 'finance-planner-install-dismissed-until'
const UPDATE_INTERVAL_MS = 30 * 60 * 1000

function readDismissedUntil() {
  const value = Number(localStorage.getItem(DISMISSAL_KEY) || 0)
  return Number.isFinite(value) ? value : 0
}

export function MobileRuntime() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [dismissedUntil, setDismissedUntil] = useState(readDismissedUntil)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const [updateReady, setUpdateReady] = useState(false)
  const [installing, setInstalling] = useState(false)

  const standalone = useMemo(() => isStandaloneDisplay(
    window.matchMedia('(display-mode: standalone)').matches,
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  ), [])
  const ios = useMemo(() => isIOSDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints), [])

  const canInstall = shouldOfferInstall({
    standalone,
    promptAvailable: Boolean(installPrompt),
    dismissedUntil,
    now: Date.now(),
  })
  const canExplainIOSInstall = shouldOfferIOSInstall({
    standalone,
    ios,
    promptAvailable: Boolean(installPrompt),
    dismissedUntil,
    now: Date.now(),
  })

  useEffect(() => {
    document.documentElement.classList.toggle('mobile-standalone', standalone)
    document.documentElement.classList.toggle('mobile-browser', !standalone)

    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleInstalled = () => setInstallPrompt(null)
    const shield = () => document.documentElement.classList.add('mobile-privacy-shielded')
    const reveal = () => document.documentElement.classList.remove('mobile-privacy-shielded')
    const handleVisibility = () => document.visibilityState === 'hidden' ? shield() : reveal()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('pagehide', shield)
    window.addEventListener('pageshow', reveal)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('pagehide', shield)
      window.removeEventListener('pageshow', reveal)
      document.removeEventListener('visibilitychange', handleVisibility)
      reveal()
    }
  }, [standalone])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

    let active = true
    let refreshing = false
    const handleControllerChange = () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    }
    const checkForUpdate = () => {
      if (document.visibilityState === 'visible') void registration?.update()
    }

    navigator.serviceWorker.ready.then((readyRegistration) => {
      if (!active) return
      setRegistration(readyRegistration)
      setUpdateReady(isSafeServiceWorkerUpdate(readyRegistration))

      readyRegistration.addEventListener('updatefound', () => {
        const worker = readyRegistration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true)
        })
      })
    }).catch(() => undefined)

    const interval = window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS)
    document.addEventListener('visibilitychange', checkForUpdate)
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', checkForUpdate)
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [registration])

  async function install() {
    if (!installPrompt || installing) return
    setInstalling(true)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') setInstallPrompt(null)
    } finally {
      setInstalling(false)
    }
  }

  function dismissInstall() {
    const deadline = installDismissalDeadline(Date.now())
    localStorage.setItem(DISMISSAL_KEY, String(deadline))
    setDismissedUntil(deadline)
  }

  return (
    <div className="mobile-runtime" aria-live="polite">
      {!online && (
        <div className="mobile-runtime__banner" role="status">
          Offline-Modus. Deine lokal gespeicherten Finanzdaten bleiben verfügbar.
        </div>
      )}
      {updateReady && (
        <div className="mobile-runtime__banner mobile-runtime__banner--action" role="status">
          <span>Eine neue, sicherere Version ist bereit.</span>
          <button type="button" onClick={() => requestServiceWorkerActivation(registration)}>Jetzt aktualisieren</button>
        </div>
      )}
      {(canInstall || canExplainIOSInstall) && (
        <div className="mobile-install-card" role="dialog" aria-modal="false" aria-label="Finance Planner installieren">
          <div>
            <strong>Finance Planner installieren</strong>
            {canExplainIOSInstall
              ? <p>Tippe in Safari auf „Teilen“ und danach auf „Zum Home-Bildschirm“, um die App im Vollbild und offline zu verwenden.</p>
              : <p>Öffne Finance Planner wie eine App im Vollbild und halte die Offline-Oberfläche verfügbar.</p>}
          </div>
          <div className="mobile-install-card__actions">
            <button type="button" onClick={dismissInstall} className="mobile-install-card__secondary">Später</button>
            {canInstall && <button type="button" onClick={install} disabled={installing}>{installing ? 'Wird geöffnet…' : 'Installieren'}</button>}
          </div>
        </div>
      )}
    </div>
  )
}
