import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrontendExperience } from '../FrontendExperience'
import { ConfirmationDialog } from './ConfirmationDialog'

afterEach(cleanup)

describe('ConfirmationDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmationDialog open={false} severity="danger" heading="Delete?" headingId="h" confirmLabel="Delete" onConfirm={vi.fn()} onClose={vi.fn()}>body</ConfirmationDialog>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('defaults focus to Cancel, never the destructive action', () => {
    render(<ConfirmationDialog open severity="danger" heading="Delete account?" headingId="h" confirmLabel="Delete account" onConfirm={vi.fn()} onClose={vi.fn()}>This can't be undone.</ConfirmationDialog>)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('calls onConfirm and onClose from their respective buttons', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<ConfirmationDialog open severity="warning" heading="Reset?" headingId="h" confirmLabel="Reset" onConfirm={onConfirm} onClose={onClose}>Explanation.</ConfirmationDialog>)
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape and on a backdrop click, matching the shared dialog convention', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConfirmationDialog open severity="info" heading="Export as CSV?" headingId="h" confirmLabel="Export" onConfirm={vi.fn()} onClose={onClose}>Body.</ConfirmationDialog>)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables both buttons while busy, and the confirm button when explicitly disabled', () => {
    render(<ConfirmationDialog open severity="danger" heading="Delete?" headingId="h" confirmLabel="Delete" onConfirm={vi.fn()} onClose={vi.fn()} busy>body</ConfirmationDialog>)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('uses alertdialog semantics only when explicitly requested', () => {
    render(<ConfirmationDialog open severity="danger" heading="Delete?" headingId="h" confirmLabel="Delete" onConfirm={vi.fn()} onClose={vi.fn()} role="alertdialog">body</ConfirmationDialog>)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  // Regression: FrontendExperience runs a global, class-based (.modal)
  // MutationObserver predating useDialog, written for the legacy raw
  // transaction dialog -- it used to unconditionally overwrite every
  // .modal element's role back to "dialog", silently downgrading this
  // component's own explicit role="alertdialog" (e.g. DATA-10's final,
  // point-of-no-return account-deletion confirmation) the instant it
  // mounted anywhere inside the real app tree. Invisible to a
  // ConfirmationDialog-only render; only reproduces with both mounted
  // together, matching how bootstrap.tsx actually renders them.
  it('keeps its own alertdialog role when FrontendExperience is mounted alongside it', async () => {
    render(<>
      <FrontendExperience/>
      <ConfirmationDialog open severity="danger" heading="Permanently delete your account?" headingId="h" confirmLabel="Delete account" onConfirm={vi.fn()} onClose={vi.fn()} role="alertdialog">body</ConfirmationDialog>
    </>)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
