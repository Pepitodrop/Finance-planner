import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { AuthUser } from '../../AuthGate'
import { FrontendExperience } from '../../FrontendExperience'
import { accountsAcceptanceState } from '../../data'
import { configureAuthenticatedStorage, setUnlockedState } from '../../storage'

const USER_ID = 'transactions-integration-user'
const USER: AuthUser = { id: USER_ID, email: 'alex@finance-planner.test', name: 'Alex', passkeyCount: 0 }

function renderApp() {
  return render(<><FrontendExperience/><App userId={USER_ID} userName="Alex" user={USER} onLogout={vi.fn()}/></>)
}

describe('Transactions App integration', () => {
  beforeEach(() => {
    localStorage.clear()
    configureAuthenticatedStorage(USER_ID)
    setUnlockedState(structuredClone(accountsAcceptanceState))
  })
  afterEach(() => cleanup())

  it('opens the existing add and edit dialogs with canonical English copy', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Transactions' }))
    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getAllByRole('button', { name: 'Actions for Rent payment' })[0])
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toHaveValue('Rent payment')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('preserves deletion and the existing Undo restoration path', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Transactions' }))
    await user.click(screen.getAllByRole('button', { name: 'Actions for Rent payment' })[0])
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByRole('status')).toHaveTextContent('“Rent payment” was deleted.')
    expect(screen.queryByRole('button', { name: 'Actions for Rent payment' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getAllByRole('button', { name: 'Actions for Rent payment' })).toHaveLength(2)
  })
})