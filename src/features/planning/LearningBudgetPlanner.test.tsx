import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LearningBudgetPlanner } from '../../LearningBudgetPlanner'

vi.mock('../../budgetPlan', async (original) => ({
  ...await original<typeof import('../../budgetPlan')>(),
  loadLearningBudgetProfile: vi.fn().mockResolvedValue(null),
  requestLearningBudgetPlan: vi.fn(),
  resetLearningBudgetProfile: vi.fn(),
  submitBudgetFeedback: vi.fn(),
}))

describe('LearningBudgetPlanner', () => {
  it('starts every consent false and gates plan creation on behavior consent', async () => {
    render(<LearningBudgetPlanner/>)
    await waitFor(() => expect(screen.queryByText(/loading learning profile/i)).not.toBeInTheDocument())
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    checkboxes.forEach((checkbox) => expect(checkbox).not.toBeChecked())
    expect(screen.getByRole('button', { name: /create budget plan/i })).toBeDisabled()
  })
  it('declares an English feature boundary and explains that approval cannot move money', async () => {
    const { container } = render(<LearningBudgetPlanner/>)
    expect(container.querySelector('[data-feature="budget-planner"]')).toHaveAttribute('lang', 'en')
    expect(screen.getAllByText(/never executes payments or transfers/i).length).toBeGreaterThan(0)
  })
})
