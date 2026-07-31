export type AccountType = 'checking' | 'savings' | 'cash' | 'investment'
export type TransactionType = 'income' | 'expense'

export interface Account {
  id: string
  name: string
  type: AccountType
  balanceCents: number
  currency: 'EUR'
}

export interface Transaction {
  id: string
  accountId: string
  description: string
  category: string
  type: TransactionType
  amountCents: number
  date: string
  recurring?: boolean
}

export interface SavingsGoal {
  id: string
  name: string
  targetCents: number
  currentCents: number
  targetDate: string
}

export interface AppState {
  accounts: Account[]
  transactions: Transaction[]
  goals: SavingsGoal[]
}
