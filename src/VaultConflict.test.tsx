import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultConflict } from './VaultConflict'

vi.mock('./storage', () => ({ resolveCloudConflict: vi.fn() }))
import { resolveCloudConflict } from './storage'

function renderDialog(onClose = vi.fn()) {
  return render(<div>
    <main id="main-content"><button type="button">Outside the dialog</button></main>
    <VaultConflict onClose={onClose}/>
  </div>)
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => cleanup())

describe('VaultConflict (VAULT-04)', () => {
  it('renders as a real accessible dialog, not a window.confirm()', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Two versions of your data exist' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('offers exactly two equal-weight choices and no merge option', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: /use the cloud version/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep this device's version/i })).toBeInTheDocument()
    expect(screen.queryByText(/merge/i)).not.toBeInTheDocument()
  })

  it('states the losing version is replaced, never that it is archived or preserved', () => {
    renderDialog()
    expect(screen.getByText(/replaces what is on this device/i)).toBeInTheDocument()
    expect(screen.getByText(/current cloud version is replaced/i)).toBeInTheDocument()
    expect(screen.queryByText(/archived|not (permanently )?deleted/i)).not.toBeInTheDocument()
  })

  it('calls resolveCloudConflict with "server" for "Use the cloud version" and reloads on success', async () => {
    vi.mocked(resolveCloudConflict).mockResolvedValue({ accounts: [], transactions: [], goals: [] })
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: reloadSpy }, writable: true })

    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /use the cloud version/i }))
    await waitFor(() => expect(resolveCloudConflict).toHaveBeenCalledWith('server'))
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled())
  })

  it('calls resolveCloudConflict with "local" for "Keep this device\'s version"', async () => {
    vi.mocked(resolveCloudConflict).mockResolvedValue({ accounts: [], transactions: [], goals: [] })
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn() }, writable: true })

    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /keep this device's version/i }))
    await waitFor(() => expect(resolveCloudConflict).toHaveBeenCalledWith('local'))
  })

  it('shows an error and keeps both choices available if resolution fails, without losing either state', async () => {
    vi.mocked(resolveCloudConflict).mockRejectedValue(new Error('Network unavailable.'))
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /use the cloud version/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable.'))
    expect(screen.getByRole('button', { name: /use the cloud version/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /keep this device's version/i })).toBeEnabled()
  })

  it('closes on Escape without forcing a choice (the local app remains usable while unresolved)', () => {
    const onClose = vi.fn()
    renderDialog(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
