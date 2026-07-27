import { useEffect, useMemo, useState } from 'react'
import {
  installDismissalDeadline,
  isSafeServiceWorkerUpdate,
  isStandaloneDisplay,
  requestServiceWorkerActivation,
  shouldOfferInstall,
  type InstallPromptEvent,
} from './mobile-runtime'

const DISMISSAL_KEY = 'finance-planner-install-dismissed-until'

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

  const canInstall = shouldOfferInstall({
    standalone,
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

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
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

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => {
      active = false
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])

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
          Offline mode. Your locally stored finance data remains available.
        </div>
      )}
      {updateReady && (
        <div className="mobile-runtime__banner mobile-runtime__banner--action" role="status">
          <span>A safer, newer version is ready.</span>
          <button type="button" onClick={() => requestServiceWorkerActivation(registration)}>Update now</button>
        </div>
      )}
      {canInstall && (
        <div className="mobile-install-card" role="dialog" aria-label="Install Finance Planner">
          <div>
            <strong>Install Finance Planner</strong>
            <p>Open it like an app, use the full screen, and keep the offline shell available.</p>
          </div>
          <div className="mobile-install-card__actions">
            <button type="button" onClick={dismissInstall} className="mobile-install-card__secondary">Not now</button>
            <button type="button" onClick={install} disabled={installing}>{installing ? 'Opening…' : 'Install'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
