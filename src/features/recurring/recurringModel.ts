import { detectRecurringPayments, type RecurringCandidate } from '../../recurringDetection'
import type { Transaction } from '../../types'

export function recurringPresentation(transactions: Transaction[]) {
  const items = detectRecurringPayments(transactions)
  return { items, monthlyTotalCents: items.reduce((sum, item) => sum + item.transaction.amountCents, 0) }
}

export function recurringMeaning(item: RecurringCandidate): string {
  if (item.cadence === 'manual') return 'Marked as recurring'
  return `Detected ${item.cadence} pattern · ${item.occurrences} records`
}
