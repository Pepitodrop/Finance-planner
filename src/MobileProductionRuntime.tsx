import { useEffect } from 'react'

type NetworkInformation = EventTarget & {
  effectiveType?: string
  saveData?: boolean
}

type ExtendedNavigator = Navigator & {
  connection?: NetworkInformation
  clearAppBadge?: () => Promise<void>
}

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export function MobileProductionRuntime() {
  useEffect(() => {
    const extendedNavigator = navigator as ExtendedNavigator
    const connection = extendedNavigator.connection

    const syncNetworkClasses = () => {
      const root = document.documentElement
      const effectiveType = connection?.effectiveType || 'unknown'
      root.dataset.network = navigator.onLine ? effectiveType : 'offline'
      root.classList.toggle('data-saver', Boolean(connection?.saveData))
    }

    const syncViewport = () => {
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      document.documentElement.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`)
      document.documentElement.style.setProperty('--visual-viewport-offset-top', `${Math.round(offsetTop)}px`)
      document.documentElement.classList.toggle('virtual-keyboard-open', height < window.innerHeight * 0.78)
    }

    const checkForUpdate = async () => {
      if (!('serviceWorker' in navigator) || !navigator.onLine) return
      try {
        const registration = await navigator.serviceWorker.ready
        await registration.update()
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
      if (document.visibilityState !== 'visible') return
      syncViewport()
      void checkForUpdate()
      void extendedNavigator.clearAppBadge?.().catch(() => undefined)
    }

    syncNetworkClasses()
    syncViewport()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', syncNetworkClasses)
    window.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    document.addEventListener('visibilitychange', handleVisibility)
    connection?.addEventListener('change', syncNetworkClasses)

    const updateTimer = window.setInterval(() => void checkForUpdate(), UPDATE_INTERVAL_MS)
    void checkForUpdate()

    return () => {
      window.clearInterval(updateTimer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', syncNetworkClasses)
      window.removeEventListener('resize', syncViewport)
      window.visualViewport?.removeEventListener('resize', syncViewport)
      window.visualViewport?.removeEventListener('scroll', syncViewport)
      document.removeEventListener('visibilitychange', handleVisibility)
      connection?.removeEventListener('change', syncNetworkClasses)
    }
  }, [])

  return null
}
