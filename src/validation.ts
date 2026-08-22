import type { Account, AppState, SavingsGoal, Transaction } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function isAccount(value: unknown): value is Account {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && ['checking', 'savings', 'cash', 'investment', 'credit-card'].includes(String(value.type))
    && isFiniteInteger(value.balanceCents)
    && value.currency === 'EUR'
}

function isTransaction(value: unknown): value is Transaction {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.accountId === 'string'
    && typeof value.description === 'string'
    && typeof value.category === 'string'
    && ['income', 'expense'].includes(String(value.type))
    && isFiniteInteger(value.amountCents)
    && value.amountCents >= 0
    && typeof value.date === 'string'
    && !Number.isNaN(Date.parse(value.date))
    && (value.recurring === undefined || typeof value.recurring === 'boolean')
}

function isSavingsGoal(value: unknown): value is SavingsGoal {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isFiniteInteger(value.targetCents)
    && value.targetCents > 0
    && isFiniteInteger(value.currentCents)
    && value.currentCents >= 0
    && typeof value.targetDate === 'string'
    && !Number.isNaN(Date.parse(value.targetDate))
}

export function isAppState(value: unknown): value is AppState {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.accounts) || !value.accounts.every(isAccount)) return false
  if (!Array.isArray(value.transactions) || !value.transactions.every(isTransaction)) return false
  if (!Array.isArray(value.goals) || !value.goals.every(isSavingsGoal)) return false

  const accountIds = new Set(value.accounts.map((account) => account.id))
  return value.transactions.every((transaction) => accountIds.has(transaction.accountId))
}

export function validateTransactionInput(input: {
  accountId: string
  description: string
  category: string
  amount: number
  date: string
}): string | null {
  if (!input.accountId) return 'Select an account.'
  if (input.description.trim().length < 2) return 'Enter a description of at least two characters.'
  if (input.description.length > 160) return 'Description must not exceed 160 characters.'
  if (input.category.trim().length < 2) return 'Enter a valid category.'
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 100_000_000) return 'Enter a valid positive amount.'
  if (!input.date || Number.isNaN(Date.parse(input.date))) return 'Enter a valid date.'
  return null
}
