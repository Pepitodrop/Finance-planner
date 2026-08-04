import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { RuntimeSurfaceRegistration } from './runtimeSurfacePolicy'
import { RuntimeSurfaceContext, type RuntimeSurfaceContextValue } from './runtimeSurfaceContext'

export function RuntimeSurfaceCoordinator({ children }: { children: ReactNode }) {
  const [registrations, setRegistrations] = useState<RuntimeSurfaceRegistration[]>([])
  const register = useCallback((registration: RuntimeSurfaceRegistration) => {
    setRegistrations((current) => [...current.filter((item) => item.id !== registration.id), registration])
    return () => setRegistrations((current) => current.filter((item) => item.id !== registration.id))
  }, [])
  const value = useMemo<RuntimeSurfaceContextValue>(() => ({ registrations, register }), [registrations, register])

  return <RuntimeSurfaceContext.Provider value={value}>{children}</RuntimeSurfaceContext.Provider>
}
