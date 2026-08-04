import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmServiceHealth, classifyConnectivity, probeSameOrigin, type MobileConnectivity } from './mobile-connectivity'
import { RUNTIME_SURFACE_PRIORITY } from './runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtime-surfaces/runtimeSurfaceContext'

export function MobileConnectivityStatus() {
  const [status, setStatus] = useState<MobileConnectivity>(() => (
    navigator.onLine ? 'online' : 'offline'
  ))
  const [checking, setChecking] = useState(false)
  const inFlightRef = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }

    const check = (async () => {
      setChecking(true)
      try {
        const probeSucceeded = await confirmServiceHealth(() => probeSameOrigin(fetch, window.location.origin))
        setStatus(classifyConnectivity({ navigatorOnline: navigator.onLine, probeSucceeded }))
      } finally {
        setChecking(false)
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = check
    return check
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

  useEffect(() => {
    if (status !== 'degraded') return
    const recoveryTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15_000)
    return () => window.clearInterval(recoveryTimer)
  }, [refresh, status])

  const visible = useRuntimeSurface(runtimeSurfaceRegistration(
    'connectivity',
    status === 'degraded',
    RUNTIME_SURFACE_PRIORITY.critical,
    { exclusive: true, blocksLower: true },
  ))

  if (!visible) return null

  return (
    <div className="mobile-connectivity-status runtime-surface runtime-surface--critical" role="alert" aria-live="assertive">
      <span>Dein Gerät hat eine Netzwerkverbindung, aber Finance Planner kann den App-Dienst nicht erreichen.</span>
      <button type="button" onClick={() => void refresh()} disabled={checking}>
        {checking ? 'Wird geprüft …' : 'Erneut versuchen'}
      </button>
    </div>
  )
}
