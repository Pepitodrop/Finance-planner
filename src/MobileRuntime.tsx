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
import { RUNTIME_SURFACE_PRIORITY } from './runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtime-surfaces/runtimeSurfaceContext'

const DISMISSAL_KEY = 'finance-planner-install-dismissed-until'
const STORAGE_DISMISSAL_KEY = 'finance-planner-storage-dismissed-until'
const INSTALL_OFFER_DELAY_MS = 30_000
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
  const [installOfferEligible, setInstallOfferEligible] = useState(false)

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
    offerEligible: installOfferEligible,
    dismissedUntil,
    now,
  })
  const showIosGuide = installOfferEligible && shouldShowIosInstallGuide({
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

  const showOffline = useRuntimeSurface(runtimeSurfaceRegistration('offline', !online, RUNTIME_SURFACE_PRIORITY.critical, { exclusive: true, blocksLower: true }))
  const showStorageCritical = useRuntimeSurface(runtimeSurfaceRegistration('storage-critical', storageHealth.pressure === 'critical', RUNTIME_SURFACE_PRIORITY.critical, { exclusive: true, blocksLower: true }))
  const showUpdate = useRuntimeSurface(runtimeSurfaceRegistration('update', updateReady, RUNTIME_SURFACE_PRIORITY.userAction, { exclusive: true, blocksLower: true }))
  const showInstall = useRuntimeSurface(runtimeSurfaceRegistration('install', canInstall || showIosGuide, RUNTIME_SURFACE_PRIORITY.recommendationInstall, { exclusive: true, blocksLower: true }))
  const showStorageProtection = useRuntimeSurface(runtimeSurfaceRegistration('storage-protection', shouldOfferStorageProtection, RUNTIME_SURFACE_PRIORITY.optional, { exclusive: true, blocksLower: true }))

  useEffect(() => {
    const timer = window.setTimeout(() => setInstallOfferEligible(true), INSTALL_OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

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
      else dismissInstall()
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

  useEffect(() => {
    if (!showInstall && !showStorageProtection) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showInstall) dismissInstall()
      else dismissStorageProtection()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [showInstall, showStorageProtection])

  return (
    <div className="mobile-runtime">
      {showOffline && (
        <div className="mobile-runtime__banner runtime-surface runtime-surface--critical" role="status" aria-live="polite">
          Offline-Modus. Deine lokal gespeicherten Finanzdaten bleiben verfügbar.
        </div>
      )}
      {showStorageCritical && (
        <div className="mobile-runtime__banner runtime-surface runtime-surface--critical" role="alert">
          Der Gerätespeicher ist fast voll. Speicherplatz freigeben, um fehlgeschlagene lokale Speicherungen zu vermeiden.
        </div>
      )}
      {storageHealth.pressure === 'warning' && !showStorageCritical && (
        <div className="mobile-runtime__banner mobile-runtime__banner--warning runtime-surface runtime-surface--informational" role="status" aria-live="polite">
          Der Gerätespeicher wird knapp. Bald Speicherplatz freigeben.
        </div>
      )}
      {showUpdate && (
        <div className="mobile-runtime__banner mobile-runtime__banner--action runtime-surface runtime-surface--action" role="status" aria-live="polite">
          <span>Eine sicherere, neuere Version ist verfügbar.</span>
          <button type="button" onClick={() => requestServiceWorkerActivation(registration)}>Jetzt aktualisieren</button>
        </div>
      )}
      {showInstall && canInstall && (
        <section className="mobile-install-card runtime-surface runtime-surface--prompt runtime-optional-surface" role="region" aria-label="Finance Planner installieren">
          <div>
            <strong>Finance Planner installieren</strong>
            <p>Wie eine App öffnen, den Vollbildmodus nutzen und die Offline-Hülle verfügbar halten.</p>
          </div>
          <div className="mobile-install-card__actions">
            <button type="button" onClick={dismissInstall} className="mobile-install-card__secondary">Nicht jetzt</button>
            <button type="button" onClick={install} disabled={installing}>{installing ? 'Wird geöffnet …' : 'Installieren'}</button>
          </div>
        </section>
      )}
      {showInstall && showIosGuide && (
        <section className="mobile-install-card runtime-surface runtime-surface--prompt runtime-optional-surface" role="region" aria-label="Finance Planner auf iPhone oder iPad installieren">
          <div>
            <strong>Finance Planner zum Home-Bildschirm hinzufügen</strong>
            <p>In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“ wählen. Das aktiviert die eigenständige App-Ansicht.</p>
          </div>
          <div className="mobile-install-card__actions mobile-install-card__actions--single">
            <button type="button" onClick={dismissInstall} className="mobile-install-card__secondary">Verstanden</button>
          </div>
        </section>
      )}
      {showStorageProtection && (
        <section className="mobile-install-card runtime-surface runtime-surface--prompt runtime-optional-surface" role="region" aria-label="Lokal gespeicherte Finanzdaten schützen">
          <div>
            <strong>Lokale Daten vor automatischer Bereinigung schützen</strong>
            <p>Den Browser bitten, den verschlüsselten lokalen Speicher dieser App bei der Gerätebereinigung zu behalten.</p>
          </div>
          <div className="mobile-install-card__actions">
            <button type="button" onClick={dismissStorageProtection} className="mobile-install-card__secondary">Später</button>
            <button type="button" onClick={protectStorage} disabled={protectingStorage}>{protectingStorage ? 'Wird geprüft …' : 'Daten schützen'}</button>
          </div>
        </section>
      )}
    </div>
  )
}
