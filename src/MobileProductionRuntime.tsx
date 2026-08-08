import { useEffect } from 'react'
import { isSafeServiceWorkerUpdate } from './mobile-runtime'

type NetworkInformation = EventTarget & {
  effectiveType?: string
  saveData?: boolean
}

type ExtendedNavigator = Navigator & {
  connection?: NetworkInformation
  clearAppBadge?: () => Promise<void>
  deviceMemory?: number
}

type ExtendedDocument = Document & {
  wasDiscarded?: boolean
}

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export function MobileProductionRuntime() {
  useEffect(() => {
    const extendedNavigator = navigator as ExtendedNavigator
    const extendedDocument = document as ExtendedDocument
    const connection = extendedNavigator.connection
    const root = document.documentElement
    let updateRegistration: ServiceWorkerRegistration | null = null

    const syncNetworkClasses = () => {
      const effectiveType = connection?.effectiveType || 'unknown'
      root.dataset.network = navigator.onLine ? effectiveType : 'offline'
      root.classList.toggle('data-saver', Boolean(connection?.saveData))
      root.classList.toggle('constrained-network', !navigator.onLine || connection?.saveData === true || ['slow-2g', '2g'].includes(effectiveType))
    }

    const syncDeviceClasses = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches
      const touch = navigator.maxTouchPoints > 0
      const lowMemory = typeof extendedNavigator.deviceMemory === 'number' && extendedNavigator.deviceMemory <= 2
      const lowCpu = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 2
      root.dataset.displayMode = standalone ? 'standalone' : 'browser'
      root.dataset.orientation = screen.orientation?.type || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait')
      root.classList.toggle('touch-device', touch)
      root.classList.toggle('resource-constrained', lowMemory || lowCpu)
      root.classList.toggle('restored-after-discard', Boolean(extendedDocument.wasDiscarded))
    }

    const syncViewport = () => {
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const width = viewport?.width ?? window.innerWidth
      const offsetTop = viewport?.offsetTop ?? 0
      root.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`)
      root.style.setProperty('--visual-viewport-width', `${Math.round(width)}px`)
      root.style.setProperty('--visual-viewport-offset-top', `${Math.round(offsetTop)}px`)
      root.classList.toggle('virtual-keyboard-open', height < window.innerHeight * 0.78)
    }

    const dispatchLifecycle = (phase: 'active' | 'background' | 'frozen' | 'resumed') => {
      window.dispatchEvent(new CustomEvent('finance-planner:lifecycle', { detail: { phase, at: Date.now() } }))
    }

    // Sole owner of update detection and the `finance-planner:update-available`
    // event -- MobileRuntime (visible banner) and WebMobileHardening (SR
    // announcement) are pure consumers of this event rather than each running
    // their own independent registration.update()/updatefound observation.
    // isSafeServiceWorkerUpdate requires an existing controller so this never
    // fires on a first install, when there is no previous version to update
    // from.
    const announceUpdate = (registration: ServiceWorkerRegistration) => {
      if (!isSafeServiceWorkerUpdate(registration)) return
      window.dispatchEvent(new CustomEvent('finance-planner:update-available', { detail: { registration } }))
    }

    const observeRegistration = (registration: ServiceWorkerRegistration) => {
      if (updateRegistration === registration) return
      updateRegistration = registration
      announceUpdate(registration)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(registration)
        })
      })
    }

    const checkForUpdate = async () => {
      if (!('serviceWorker' in navigator) || !navigator.onLine) return
      try {
        const registration = await navigator.serviceWorker.ready
        observeRegistration(registration)
        await registration.update()
        announceUpdate(registration)
      } catch {
        // A failed update check must never interrupt the installed app.
      }
    }

    const handleOnline = () => {
      syncNetworkClasses()
      window.dispatchEvent(new CustomEvent('finance-planner:connectivity-restored'))
      void checkForUpdate()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncViewport()
        syncDeviceClasses()
        dispatchLifecycle('active')
        void checkForUpdate()
        void extendedNavigator.clearAppBadge?.().catch(() => undefined)
      } else {
        dispatchLifecycle('background')
      }
    }
    const handlePageShow = (event: PageTransitionEvent) => {
      syncViewport()
      syncNetworkClasses()
      syncDeviceClasses()
      dispatchLifecycle('resumed')
      if (event.persisted) void checkForUpdate()
    }
    const handlePageHide = () => dispatchLifecycle('background')
    const handleFreeze = () => dispatchLifecycle('frozen')
    const handleResume = () => {
      dispatchLifecycle('resumed')
      syncViewport()
      void checkForUpdate()
    }

    syncNetworkClasses()
    syncDeviceClasses()
    syncViewport()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', syncNetworkClasses)
    window.addEventListener('resize', syncViewport)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('pagehide', handlePageHide)
    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    screen.orientation?.addEventListener('change', syncDeviceClasses)
    document.addEventListener('visibilitychange', handleVisibility)
    document.addEventListener('freeze', handleFreeze)
    document.addEventListener('resume', handleResume)
    connection?.addEventListener('change', syncNetworkClasses)

    const updateTimer = window.setInterval(() => void checkForUpdate(), UPDATE_INTERVAL_MS)
    void checkForUpdate()

    return () => {
      window.clearInterval(updateTimer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', syncNetworkClasses)
      window.removeEventListener('resize', syncViewport)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('pagehide', handlePageHide)
      window.visualViewport?.removeEventListener('resize', syncViewport)
      window.visualViewport?.removeEventListener('scroll', syncViewport)
      screen.orientation?.removeEventListener('change', syncDeviceClasses)
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('freeze', handleFreeze)
      document.removeEventListener('resume', handleResume)
      connection?.removeEventListener('change', syncNetworkClasses)
    }
  }, [])

  return null
}
