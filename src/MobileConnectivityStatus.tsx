import { useCallback, useEffect, useState } from 'react'
import { classifyConnectivity, probeSameOrigin, type MobileConnectivity } from './mobile-connectivity'

export function MobileConnectivityStatus() {
  const [status, setStatus] = useState<MobileConnectivity>(() => (
    navigator.onLine ? 'online' : 'offline'
  ))
  const [checking, setChecking] = useState(false)

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }

    setChecking(true)
    try {
      const probeSucceeded = await probeSameOrigin(fetch, window.location.origin)
      setStatus(classifyConnectivity({ navigatorOnline: navigator.onLine, probeSucceeded }))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => void refresh()
    const handleOffline = () => setStatus('offline')
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)
    void refresh()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  if (status !== 'degraded') return null

  return (
    <div className="mobile-connectivity-status" role="alert" aria-live="assertive">
      <span>Your device has a network connection, but Finance Planner cannot reach the app service.</span>
      <button type="button" onClick={() => void refresh()} disabled={checking}>
        {checking ? 'Checking…' : 'Try again'}
      </button>
    </div>
  )
}
