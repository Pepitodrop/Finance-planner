import { useEffect, useMemo, useState } from 'react'
import {
  installDismissalDeadline,
  isSafeServiceWorkerUpdate,
  isStandaloneDisplay,
  requestServiceWorkerActivation,
  shouldOfferInstall,
  type InstallPromptEvent,
} from './mobile-runtime'
import {
  isIosSafari,
  readStorageHealth,
  requestPersistentStorage,
  shouldShowIosInstallGuide,
  type StorageHealth,
} from './mobile-health'

const DISMISSAL_KEY = 'finance-planner-install-dismissed-until'
const STORAGE_DISMISSAL_KEY = 'finance-planner-storage-dismissed-until'
const EMPTY_STORAGE_HEALTH: StorageHealth = {
  supported: false,
  persisted: false,
  usage: 0,
  quota: 0,
  usageRatio: 0,
  pressure: 'unknown',
}

function readDeadline(key: string) {
  const value = Number(localStorage.getItem(key) || 0)
  return Number.isFinite(value) ? value : 0
}

export function MobileRuntime() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [dismissedUntil, setDismissedUntil] = useState(() => readDeadline(DISMISSAL_KEY))
  const [storageDismissedUntil, setStorageDismissedUntil] = useState(() => readDeadline(STORAGE_DISMISSAL_KEY))
  const [storageHealth, setStorageHealth] = useState<StorageHealth>(EMPTY_STORAGE_HEALTH)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const [updateReady, setUpdateReady] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [protectingStorage, setProtectingStorage] = useState(false)

  const standalone = useMemo(() => isStandaloneDisplay(
    window.matchMedia('(display-mode: standalone)').matches,
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  ), [])

  const iosSafari = useMemo(() => isIosSafari(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  ), [])

  const now = Date.now()
  const canInstall = shouldOfferInstall({
    standalone,
    promptAvailable: Boolean(installPrompt),
    dismissedUntil,
    now,
  })
  const showIosGuide = shouldShowIosInstallGuide({
    standalone,
    promptAvailable: Boolean(installPrompt),
    dismissedUntil,
    now,
    iosSafari,
  })
  const shouldOfferStorageProtection = standalone
    && storageHealth.supported
    && !storageHealth.persisted
    && storageDismissedUntil <= now
    && !canInstall
    && !showIosGuide

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
    let active = true
    const refresh = () => {
      void readStorageHealth(navigator.storage).then((health) => {
        if (active) setStorageHealth(health)
      })
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

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

  function dismissStorageProtection() {
    const deadline = installDismissalDeadline(Date.now(), 7)
    localStorage.setItem(STORAGE_DISMISSAL_KEY, String(deadline))
    setStorageDismissedUntil(deadline)
  }

  async function protectStorage() {
    if (protectingStorage) return
    setProtectingStorage(true)
    try {
      const persisted = await requestPersistentStorage(navigator.storage)
      const health = await readStorageHealth(navigator.storage)
      setStorageHealth({ ...health, persisted: persisted || health.persisted })
      if (!persisted) dismissStorageProtection()
    } finally {
      setProtectingStorage(false)
    }
  }

  return (
    <div className="mobile-runtime" aria-live="polite">
      {!online && (
        <div className="mobile-runtime__banner" role="status">
          Offline mode. Your locally stored finance data remains available.
        </div>
      )}
      {storageHealth.pressure === 'critical' && (
        <div className="mobile-runtime__banner" role="alert">
          Device storage is almost full. Free space to prevent failed local saves.
        </div>
      )}
      {storageHealth.pressure === 'warning' && (
        <div className="mobile-runtime__banner mobile-runtime__banner--warning" role="status">
          Device storage is running low. Consider freeing space soon.
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
      {showIosGuide && (
        <div className="mobile-install-card" role="dialog" aria-label="Install Finance Planner on iPhone or iPad">
          <div>
            <strong>Add Finance Planner to your Home Screen</strong>
            <p>Tap Share in Safari, then choose “Add to Home Screen”. This enables the standalone app experience.</p>
          </div>
          <div className="mobile-install-card__actions mobile-install-card__actions--single">
            <button type="button" onClick={dismissInstall} className="mobile-install-card__secondary">Got it</button>
          </div>
        </div>
      )}
      {shouldOfferStorageProtection && (
        <div className="mobile-install-card" role="dialog" aria-label="Protect locally stored finance data">
          <div>
            <strong>Protect local data from automatic cleanup</strong>
            <p>Ask your browser to keep this app’s encrypted local storage during device cleanup.</p>
          </div>
          <div className="mobile-install-card__actions">
            <button type="button" onClick={dismissStorageProtection} className="mobile-install-card__secondary">Later</button>
            <button type="button" onClick={protectStorage} disabled={protectingStorage}>{protectingStorage ? 'Checking…' : 'Protect data'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
