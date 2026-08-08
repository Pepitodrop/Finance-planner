import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FinanceAssistant } from './FinanceAssistant'
import { initialState } from './data'

afterEach(() => cleanup())

describe('FinanceAssistant', () => {
  it('disables the run button until hosted consent is given, and explains why', () => {
    render(<FinanceAssistant state={initialState}/>)
    const runButton = screen.getByRole('button', { name: /consent required/i })
    expect(runButton).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree that for this session/i }))
    expect(screen.getByRole('button', { name: /start assistant/i })).not.toBeDisabled()
  })

  it('never pre-checks hosted consent', () => {
    render(<FinanceAssistant state={initialState}/>)
    expect(screen.getByRole('checkbox', { name: /I agree that for this session/i })).not.toBeChecked()
  })

  it('switching to the local engine hides the hosted checkbox and shows an honest resource disclosure with no fake download percentage', () => {
    render(<FinanceAssistant state={initialState}/>)
    fireEvent.click(screen.getByRole('radio', { name: /on-device model/i }))
    expect(screen.queryByRole('checkbox', { name: /I agree that for this session/i })).not.toBeInTheDocument()
    const warning = screen.getByText(/several hundred megabytes/i)
    expect(warning.textContent).not.toMatch(/%/)
  })

  it('states the agent never moves money without approval', () => {
    render(<FinanceAssistant state={initialState}/>)
    expect(screen.getByText(/never makes payments or account changes without your explicit approval/i)).toBeInTheDocument()
  })

  it('approving a proposed action only records a decision and triggers no new network request', () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchSpy)
    render(<FinanceAssistant state={initialState}/>)
    const approveButtons = screen.queryAllByRole('button', { name: /^approve /i })
    const callsBeforeApprove = fetchSpy.mock.calls.length
    if (approveButtons.length > 0) {
      fireEvent.click(approveButtons[0])
      expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
    }
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeApprove)
    vi.unstubAllGlobals()
  })

  it('never labels a smartness score as accuracy, confidence, or a prediction guarantee', () => {
    render(<FinanceAssistant state={initialState}/>)
    expect(screen.getByText(/not a measure of how accurate any single answer is/i)).toBeInTheDocument()
    expect(screen.queryByText(/accuracy score|prediction accuracy/i)).not.toBeInTheDocument()
  })

  it('renders exactly one Learning Budget Planner instance, integrated behind a divider', () => {
    render(<FinanceAssistant state={initialState}/>)
    expect(screen.getByText('Deterministic planning')).toBeInTheDocument()
    expect(screen.getAllByText('Deterministic planning').length).toBe(1)
    expect(screen.getByText('Create budget plan')).toBeInTheDocument()
  })

  it('acceptance: a hosted success answer carries the hosted badge on the answer panel, not a fallback badge', () => {
    render(<FinanceAssistant state={initialState} acceptanceMode="success"/>)
    const answerPanel = screen.getByText('Assistant answer').closest('section') as HTMLElement
    expect(within(answerPanel).getByText('Hosted model (consented)')).toBeInTheDocument()
    expect(within(answerPanel).queryByText(/Calculated · /)).not.toBeInTheDocument()
  })

  it('acceptance: a hosted fallback answer never carries the hosted badge on the answer panel', () => {
    render(<FinanceAssistant state={initialState} acceptanceMode="hosted-fallback"/>)
    const answerPanel = screen.getByText('Assistant answer').closest('section') as HTMLElement
    expect(within(answerPanel).getByText('Calculated · server fallback')).toBeInTheDocument()
    expect(within(answerPanel).queryByText('Hosted model (consented)')).not.toBeInTheDocument()
  })

  it('acceptance: local-selected mode shows the local engine without the hosted consent checkbox', () => {
    render(<FinanceAssistant state={initialState} acceptanceMode="local-selected"/>)
    expect(screen.queryByRole('checkbox', { name: /I agree that for this session/i })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /I understand this will download data/i })).toBeInTheDocument()
  })
})
