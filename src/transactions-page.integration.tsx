import type { Transaction } from './types'
import { TransactionsPage } from './TransactionsPage'

interface TransactionsPageIntegrationProps {
  transactions: Transaction[]
  accounts: Parameters<typeof TransactionsPage>[0]['accounts']
  onEdit: (transaction: Transaction) => void
  onDelete: (transactionId: string) => void
}

export function TransactionsPageIntegration(props: TransactionsPageIntegrationProps) {
  return <TransactionsPage {...props}/>
}
