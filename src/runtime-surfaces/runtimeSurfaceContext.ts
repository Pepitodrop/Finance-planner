import { createContext, useContext, useLayoutEffect } from 'react'
import { visibleRuntimeSurfaceIds, type RuntimeSurfaceId, type RuntimeSurfaceRegistration } from './runtimeSurfacePolicy'

export interface RuntimeSurfaceContextValue {
  registrations: RuntimeSurfaceRegistration[]
  register: (registration: RuntimeSurfaceRegistration) => () => void
}

export const RuntimeSurfaceContext = createContext<RuntimeSurfaceContextValue | null>(null)

export function useRuntimeSurface(registration: RuntimeSurfaceRegistration) {
  const context = useContext(RuntimeSurfaceContext)
  const register = context?.register
  const { id, active, priority, exclusive, blocksLower } = registration

  useLayoutEffect(() => register?.({ id, active, priority, exclusive, blocksLower }), [register, id, active, priority, exclusive, blocksLower])

  if (!context) return active
  return visibleRuntimeSurfaceIds([
    ...context.registrations.filter((surface) => surface.id !== id),
    registration,
  ]).has(id)
}

export function runtimeSurfaceRegistration(
  id: RuntimeSurfaceId,
  active: boolean,
  priority: number,
  options: { exclusive?: boolean; blocksLower?: boolean } = {},
): RuntimeSurfaceRegistration {
  return {
    id,
    active,
    priority,
    exclusive: options.exclusive ?? false,
    blocksLower: options.blocksLower ?? false,
  }
}
