export type RuntimeSurfaceId =
  | 'connectivity'
  | 'offline'
  | 'storage-critical'
  | 'update'
  | 'cloud-sync'
  | 'passkey'
  | 'install'
  | 'storage-protection'
  | 'analysis'

export interface RuntimeSurfaceRegistration {
  id: RuntimeSurfaceId
  active: boolean
  priority: number
  exclusive: boolean
  blocksLower: boolean
}

export const RUNTIME_SURFACE_PRIORITY = {
  critical: 600,
  userAction: 500,
  security: 400,
  recommendationPasskey: 310,
  recommendationInstall: 300,
  informational: 200,
  optional: 100,
} as const

export function visibleRuntimeSurfaceIds(registrations: RuntimeSurfaceRegistration[]) {
  const active = registrations.filter((surface) => surface.active)
  const blocker = active
    .filter((surface) => surface.blocksLower)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]
  const exclusive = active
    .filter((surface) => surface.exclusive && (!blocker || surface.priority >= blocker.priority))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]

  return new Set(active.filter((surface) => {
    if (blocker && surface.priority < blocker.priority) return false
    if (surface.exclusive) return surface.id === exclusive?.id
    return true
  }).map((surface) => surface.id))
}
