import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RuntimeSurfaceCoordinator } from './RuntimeSurfaceCoordinator'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtimeSurfaceContext'
import { RUNTIME_SURFACE_PRIORITY, visibleRuntimeSurfaceIds } from './runtimeSurfacePolicy'

function Surface({ id, active, priority, exclusive = true, blocksLower = true }: {
  id: 'connectivity' | 'passkey' | 'install' | 'analysis'
  active: boolean
  priority: number
  exclusive?: boolean
  blocksLower?: boolean
}) {
  const visible = useRuntimeSurface(runtimeSurfaceRegistration(id, active, priority, { exclusive, blocksLower }))
  return visible ? <div>{id}</div> : null
}

function Scenario({ connectivity = false }: { connectivity?: boolean }) {
  return <RuntimeSurfaceCoordinator>
    <Surface id="connectivity" active={connectivity} priority={RUNTIME_SURFACE_PRIORITY.critical}/>
    <Surface id="passkey" active priority={RUNTIME_SURFACE_PRIORITY.recommendationPasskey}/>
    <Surface id="install" active priority={RUNTIME_SURFACE_PRIORITY.recommendationInstall}/>
    <Surface id="analysis" active priority={RUNTIME_SURFACE_PRIORITY.informational} exclusive={false} blocksLower={false}/>
  </RuntimeSurfaceCoordinator>
}

describe('runtime-surface coordination', () => {
  it('selects the highest-priority exclusive surface and defers lower statuses', () => {
    const visible = visibleRuntimeSurfaceIds([
      runtimeSurfaceRegistration('install', true, RUNTIME_SURFACE_PRIORITY.recommendationInstall, { exclusive: true, blocksLower: true }),
      runtimeSurfaceRegistration('passkey', true, RUNTIME_SURFACE_PRIORITY.recommendationPasskey, { exclusive: true, blocksLower: true }),
      runtimeSurfaceRegistration('analysis', true, RUNTIME_SURFACE_PRIORITY.informational),
    ])
    expect([...visible]).toEqual(['passkey'])
  })

  it('keeps install and passkey mutually exclusive and lets connectivity take priority', async () => {
    const view = render(<Scenario/>)
    await waitFor(() => expect(screen.getByText('passkey')).toBeInTheDocument())
    expect(screen.queryByText('install')).not.toBeInTheDocument()
    expect(screen.queryByText('analysis')).not.toBeInTheDocument()

    view.rerender(<Scenario connectivity/>)
    await waitFor(() => expect(screen.getByText('connectivity')).toBeInTheDocument())
    expect(screen.queryByText('passkey')).not.toBeInTheDocument()
    expect(screen.queryByText('install')).not.toBeInTheDocument()
  })
})
