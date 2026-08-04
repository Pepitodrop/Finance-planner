import {
  BrainCircuit,
  DatabaseBackup,
  LayoutDashboard,
  Link2,
  MessageCircleQuestion,
  ReceiptText,
  Repeat2,
  Target,
  ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react'

export type DestinationId =
  | 'dashboard'
  | 'transactions'
  | 'goals'
  | 'recurring'
  | 'connections'
  | 'ai'
  | 'assistant'
  | 'receipt'
  | 'data'

export interface NavigationDestination {
  id: DestinationId
  label: string
  accessibilityLabel: string
  icon: LucideIcon
  desktopOrder: number
  mobilePrimary: boolean
  moreOrder?: number
}

export const NAVIGATION_DESTINATIONS: readonly NavigationDestination[] = [
  { id: 'dashboard', label: 'Dashboard', accessibilityLabel: 'Dashboard', icon: LayoutDashboard, desktopOrder: 1, mobilePrimary: true },
  { id: 'transactions', label: 'Transactions', accessibilityLabel: 'Transactions', icon: ArrowLeftRight, desktopOrder: 2, mobilePrimary: true },
  { id: 'goals', label: 'Goals', accessibilityLabel: 'Savings goals', icon: Target, desktopOrder: 3, mobilePrimary: true },
  { id: 'recurring', label: 'Recurring', accessibilityLabel: 'Recurring payments', icon: Repeat2, desktopOrder: 4, mobilePrimary: false, moreOrder: 1 },
  { id: 'connections', label: 'Connections', accessibilityLabel: 'Bank and PayPal connections', icon: Link2, desktopOrder: 5, mobilePrimary: true },
  { id: 'ai', label: 'AI Categorisation', accessibilityLabel: 'AI categorisation', icon: BrainCircuit, desktopOrder: 6, mobilePrimary: false, moreOrder: 2 },
  { id: 'assistant', label: 'Finance Assistant', accessibilityLabel: 'Finance assistant', icon: MessageCircleQuestion, desktopOrder: 7, mobilePrimary: false, moreOrder: 3 },
  { id: 'receipt', label: 'Receipt Review', accessibilityLabel: 'Receipt review', icon: ReceiptText, desktopOrder: 8, mobilePrimary: false, moreOrder: 4 },
  { id: 'data', label: 'Data and Backup', accessibilityLabel: 'Data and backup', icon: DatabaseBackup, desktopOrder: 9, mobilePrimary: false, moreOrder: 5 },
]

export const DESKTOP_DESTINATIONS = [...NAVIGATION_DESTINATIONS]
  .sort((left, right) => left.desktopOrder - right.desktopOrder)

export const MOBILE_PRIMARY_DESTINATIONS = NAVIGATION_DESTINATIONS
  .filter((destination) => destination.mobilePrimary)
  .sort((left, right) => left.desktopOrder - right.desktopOrder)

export const MORE_DESTINATIONS = NAVIGATION_DESTINATIONS
  .filter((destination): destination is NavigationDestination & { moreOrder: number } => destination.moreOrder !== undefined)
  .sort((left, right) => left.moreOrder - right.moreOrder)
