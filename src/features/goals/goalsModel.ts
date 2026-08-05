import type { SavingsGoal } from '../../types'

export const MAX_GOAL_EUROS = 1_000_000_000_000

export function goalProgress(goal: SavingsGoal): number {
  if (!Number.isSafeInteger(goal.targetCents) || goal.targetCents <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(goal.currentCents / goal.targetCents * 100)))
}

export function summarizeGoals(goals: SavingsGoal[]) {
  const targetCents = goals.reduce((sum, goal) => sum + goal.targetCents, 0)
  const savedCents = goals.reduce((sum, goal) => sum + goal.currentCents, 0)
  const remainingCents = goals.reduce((sum, goal) => sum + Math.max(0, goal.targetCents - goal.currentCents), 0)
  const nextGoal = goals
    .filter((goal) => /^\d{4}-\d{2}-\d{2}$/.test(goal.targetDate) && goalProgress(goal) < 100)
    .sort((left, right) => left.targetDate.localeCompare(right.targetDate))[0] ?? null
  return { targetCents, savedCents, remainingCents, nextGoal }
}

export function eurosToCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_GOAL_EUROS) return null
  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export function validateGoalDraft(input: { name: string; target: number; current: number; targetDate: string }): string | null {
  if (!input.name.trim()) return 'Enter a goal name.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) return 'Choose a valid target date.'
  const targetCents = eurosToCents(input.target)
  const currentCents = eurosToCents(input.current)
  if (targetCents === null || targetCents <= 0) return 'Enter a target amount greater than zero.'
  if (currentCents === null) return 'Enter a valid saved amount.'
  if (currentCents > targetCents) return 'Already saved cannot exceed the target amount.'
  return null
}
