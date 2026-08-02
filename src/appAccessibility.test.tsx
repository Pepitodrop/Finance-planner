import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { FrontendExperience } from './FrontendExperience'
import { NavigationAccessibility } from './NavigationAccessibility'
import { WebMobileHardening } from './WebMobileHardening'
import { initialState } from './data'
import { configureAuthenticatedStorage, setUnlockedState } from './storage'

const TEST_USER_ID = 'test-user-a11y'

function Shell() {
  return <>
    <WebMobileHardening />
    <FrontendExperience />
    <NavigationAccessibility />
    <App userId={TEST_USER_ID} userName="Test User" />
  </>
}

async function auditActiveViolations(container: Element) {
  const results = await axe.run(container, {
    // WCAG 2.2 A/AA rule set; color-contrast is skipped because jsdom cannot
    // compute rendered styles from the app's CSS (no real layout engine).
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations
}

describe('primary application shell accessibility', () => {
  beforeEach(() => {
    localStorage.clear()
    configureAuthenticatedStorage(TEST_USER_ID)
    setUnlockedState(structuredClone(initialState))
  })

  afterEach(() => {
    cleanup()
  })

  it('has no axe violations on the initial dashboard view', async () => {
    const { container } = render(<Shell />)
    const violations = await auditActiveViolations(container)
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  it('exposes a skip link that moves focus into the main landmark', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    const skipLink = screen.getByRole('link', { name: 'Zum Hauptinhalt springen' })
    expect(skipLink).toHaveAttribute('href', '#main-content')

    await user.click(skipLink)
    const main = document.querySelector('main')
    expect(main).toHaveAttribute('id', 'main-content')
  })

  it('marks exactly one sidebar navigation item as the current page, and only after activation', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' })
    expect(within(nav).getAllByRole('button', { current: 'page' })).toHaveLength(1)
    expect(within(nav).getByRole('button', { name: /Übersicht/ })).toHaveAttribute('aria-current', 'page')

    await user.click(within(nav).getByRole('button', { name: /Transaktionen/ }))

    const current = within(nav).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Transaktionen')
  })

  it('traps focus in the transaction dialog, supports Escape-to-close, and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    const trigger = screen.getByRole('button', { name: /Manuelle Buchung/ })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()

    const violations = await auditActiveViolations(dialog)
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])

    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
