import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GoalsPage } from './GoalsPage'
import type { AppState } from '../../types'

const state = { accounts: [], transactions: [], goals: [{ id: 'g', name: 'Emergency fund', targetCents: 100_000, currentCents: 25_000, targetDate: '2026-12-15' }] } as AppState

describe('GoalsPage', () => {
  it('renders English summaries and deterministic progress', () => { render(<GoalsPage state={state} onChange={vi.fn()}/>); expect(screen.getByRole('main')).toHaveAttribute('lang', 'en'); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25') })
  it('opens and dismisses the editor with Escape', () => { render(<GoalsPage state={state} onChange={vi.fn()}/>); fireEvent.click(screen.getAllByRole('button', { name: /add goal/i }).at(-1)!); expect(screen.getByRole('dialog')).toBeInTheDocument(); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument() })
  it('shows the honest empty state', () => { render(<GoalsPage state={{ ...state, goals: [] }} onChange={vi.fn()}/>); expect(screen.getByRole('heading', { name: 'No goals yet' })).toBeInTheDocument() })
})
