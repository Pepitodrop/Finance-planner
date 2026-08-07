import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReceiptReview } from './ReceiptReview'

afterEach(() => cleanup())

describe('ReceiptReview', () => {
  it('shows an upload entry with no fake result and no fake preview before a file is chosen', () => {
    render(<ReceiptReview/>)
    expect(screen.getByText('Review a grocery receipt')).toBeInTheDocument()
    expect(screen.getByText('No review yet')).toBeInTheDocument()
    expect(screen.queryByAltText(/preview of the selected receipt/i)).not.toBeInTheDocument()
  })

  it('names the real hosted model instead of a vague "AI" claim', () => {
    render(<ReceiptReview/>)
    expect(screen.getByText(/Qwen2.5-VL-7B/)).toBeInTheDocument()
    expect(screen.getByText('Hosted vision model')).toBeInTheDocument()
  })

  it('acceptance: consent is required before the analyze button is enabled', () => {
    render(<ReceiptReview acceptanceMode="selected"/>)
    const consentCheckbox = screen.getByRole('checkbox', { name: /I agree that for exactly this receipt image/i })
    expect(consentCheckbox).not.toBeChecked()
    expect(screen.getByRole('button', { name: /review purchase/i })).toBeDisabled()
  })

  it('acceptance: the consent sentence states it resets on a different image and is not stored', () => {
    render(<ReceiptReview acceptanceMode="selected"/>)
    expect(screen.getByText(/resets if you choose a different image/i)).toBeInTheDocument()
    expect(screen.getByText(/is not stored by Finance Planner/i)).toBeInTheDocument()
  })

  it('acceptance: a sufficient-evidence result shows the score with its confidence, not as a certified fact', () => {
    render(<ReceiptReview acceptanceMode="sufficient"/>)
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText(/Model confidence: 68%/)).toBeInTheDocument()
  })

  it('acceptance: an insufficient-evidence result shows no score, items, or recommendations', () => {
    render(<ReceiptReview acceptanceMode="insufficient"/>)
    expect(screen.getByText('Not enough to give a reliable review.')).toBeInTheDocument()
    expect(screen.queryByText('72')).not.toBeInTheDocument()
    expect(screen.queryByText('Affordability')).not.toBeInTheDocument()
    expect(screen.getByText(/whole receipt visible, in focus, and in good light/i)).toBeInTheDocument()
  })

  it('acceptance: label chips read as plain inference text, not certification badges', () => {
    render(<ReceiptReview acceptanceMode="sufficient"/>)
    const item = screen.getByText('Bio-Äpfel 1kg').closest('article') as HTMLElement
    expect(within(item).getByText('Bio')).toBeInTheDocument()
    expect(within(item).queryByText(/verified|certified/i)).not.toBeInTheDocument()
  })

  it('acceptance: an error state offers no invented deterministic fallback, only retry', () => {
    render(<ReceiptReview acceptanceMode="error"/>)
    expect(screen.getByText(/no automatic substitute for this feature/i)).toBeInTheDocument()
    expect(screen.queryByText(/rule-based substitute analysis/i)).not.toBeInTheDocument()
  })

  it('never claims live price or inventory data', () => {
    render(<ReceiptReview acceptanceMode="sufficient"/>)
    expect(screen.getByText(/No live price, offer, or inventory data/i)).toBeInTheDocument()
  })
})
