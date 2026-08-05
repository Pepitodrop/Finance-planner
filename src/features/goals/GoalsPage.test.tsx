import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GoalsPage } from './GoalsPage'
import type { AppState } from '../../types'

const state = { accounts: [], transactions: [], goals: [{ id: 'g', name: 'Emergency fund', targetCents: 100_000, currentCents: 25_000, targetDate: '2026-12-15' }] } as AppState

describe('GoalsPage', () => {
  it('renders English summaries and deterministic progress', () => { render(<GoalsPage state={state} onChange={vi.fn()}/>); expect(screen.getByRole('main')).toHaveAttribute('lang', 'en'); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25') })
  it('portals the interactive editor outside the inert background and restores body state', () => {
    const { container } = render(<div className="app-frame"><GoalsPage state={state} onChange={vi.fn()}/></div>)
    const trigger = screen.getAllByRole('button', { name: /add goal/i }).at(-1)!
    trigger.focus(); fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(dialog.closest('[inert]')).toBeNull()
    expect(container.querySelector('.app-frame')).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })
  it('shows the honest empty state', () => { render(<GoalsPage state={{ ...state, goals: [] }} onChange={vi.fn()}/>); expect(screen.getByRole('heading', { name: 'No goals yet' })).toBeInTheDocument() })
})
