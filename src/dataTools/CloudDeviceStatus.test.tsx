import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudDeviceStatus } from './CloudDeviceStatus'
import type { CloudSyncStatus } from '../storage'

vi.mock('../storage', () => ({
  getCloudSyncStatus: vi.fn(),
  subscribeCloudSyncStatus: vi.fn(() => () => {}),
}))
import { getCloudSyncStatus, subscribeCloudSyncStatus } from '../storage'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function mockStatus(status: CloudSyncStatus) {
  vi.mocked(getCloudSyncStatus).mockReturnValue(status)
}

describe('CloudDeviceStatus (SYNC-01)', () => {
  it('always shows this device as encrypted and unlocked, distinct from the account sync phase', () => {
    mockStatus({ phase: 'synced', message: 'Cloud data was opened on this device.', lastSyncedAt: '2026-08-07T09:00:00.000Z' })
    render(<CloudDeviceStatus onBack={vi.fn()}/>)
    expect(screen.getByText('This device')).toBeInTheDocument()
    expect(screen.getByText('Encrypted and unlocked')).toBeInTheDocument()
    expect(screen.getByText('Your account')).toBeInTheDocument()
    expect(screen.getByText('Up to date')).toBeInTheDocument()
  })

  it('surfaces an inline error only for the error phase, and never claims vault-password recovery', () => {
    mockStatus({ phase: 'error', message: 'The last save attempt failed.' })
    render(<CloudDeviceStatus onBack={vi.fn()}/>)
    expect(screen.getByRole('alert')).toHaveTextContent('The last save attempt failed.')
    expect(screen.getByText(/doesn't make your vault password recoverable/i)).toBeInTheDocument()
  })

  it('never renders the conflict phase -- that is VaultConflict/VAULT-04 territory exclusively', () => {
    mockStatus({ phase: 'conflict', message: 'An unresolved cloud conflict is protecting your local changes.' })
    render(<CloudDeviceStatus onBack={vi.fn()}/>)
    expect(screen.queryByText(/unresolved cloud conflict/i)).not.toBeInTheDocument()
    expect(screen.getByText('Syncing…')).toBeInTheDocument()
  })

  it('subscribes to live status changes on mount', () => {
    mockStatus({ phase: 'local', message: 'Not yet synced.' })
    render(<CloudDeviceStatus onBack={vi.fn()}/>)
    expect(subscribeCloudSyncStatus).toHaveBeenCalledOnce()
  })
})
