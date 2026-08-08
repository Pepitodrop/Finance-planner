import {
  BrainCircuit,
  CircleUserRound,
  CreditCard,
  DatabaseBackup,
  LayoutDashboard,
  Landmark,
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
  | 'accounts'
  | 'goals'
  | 'recurring'
  | 'connections'
  | 'subscriptions'
  | 'ai'
  | 'assistant'
  | 'receipt'
  | 'data'
  | 'account'

// Groups used to structure the mobile "More" sheet (see ApplicationShell's
// MORE_DESTINATION_GROUPS render) so 8 secondary destinations read as 4
// related sections instead of one flat list.
export type MoreGroupId = 'planning' | 'connections' | 'intelligence' | 'data-account'

export interface NavigationDestination {
  id: DestinationId
  label: string
  accessibilityLabel: string
  icon: LucideIcon
  desktopOrder: number
  mobilePrimary: boolean
  moreOrder?: number
  moreGroup?: MoreGroupId
}

export const NAVIGATION_DESTINATIONS: readonly NavigationDestination[] = [
  { id: 'dashboard', label: 'Dashboard', accessibilityLabel: 'Dashboard', icon: LayoutDashboard, desktopOrder: 1, mobilePrimary: true },
  { id: 'transactions', label: 'Transactions', accessibilityLabel: 'Transactions', icon: ArrowLeftRight, desktopOrder: 2, mobilePrimary: true },
  { id: 'accounts', label: 'Accounts', accessibilityLabel: 'Accounts', icon: Landmark, desktopOrder: 3, mobilePrimary: true },
  { id: 'goals', label: 'Goals', accessibilityLabel: 'Savings goals', icon: Target, desktopOrder: 4, mobilePrimary: true },
  { id: 'recurring', label: 'Recurring', accessibilityLabel: 'Recurring payments', icon: Repeat2, desktopOrder: 5, mobilePrimary: false, moreOrder: 1, moreGroup: 'planning' },
  { id: 'connections', label: 'Connections', accessibilityLabel: 'Bank and PayPal connections', icon: Link2, desktopOrder: 6, mobilePrimary: false, moreOrder: 2, moreGroup: 'connections' },
  { id: 'subscriptions', label: 'Subscriptions', accessibilityLabel: 'Provider subscriptions', icon: CreditCard, desktopOrder: 7, mobilePrimary: false, moreOrder: 3, moreGroup: 'connections' },
  { id: 'ai', label: 'Finance Intelligence', accessibilityLabel: 'Finance intelligence', icon: BrainCircuit, desktopOrder: 8, mobilePrimary: false, moreOrder: 4, moreGroup: 'intelligence' },
  { id: 'assistant', label: 'Finance Assistant', accessibilityLabel: 'Finance assistant', icon: MessageCircleQuestion, desktopOrder: 9, mobilePrimary: false, moreOrder: 5, moreGroup: 'intelligence' },
  { id: 'receipt', label: 'Receipt Review', accessibilityLabel: 'Receipt review', icon: ReceiptText, desktopOrder: 10, mobilePrimary: false, moreOrder: 6, moreGroup: 'intelligence' },
  { id: 'data', label: 'Data and Backup', accessibilityLabel: 'Data and backup', icon: DatabaseBackup, desktopOrder: 11, mobilePrimary: false, moreOrder: 7, moreGroup: 'data-account' },
  { id: 'account', label: 'Account', accessibilityLabel: 'Account and session', icon: CircleUserRound, desktopOrder: 12, mobilePrimary: false, moreOrder: 8, moreGroup: 'data-account' },
]

export const DESKTOP_DESTINATIONS = [...NAVIGATION_DESTINATIONS]
  .sort((left, right) => left.desktopOrder - right.desktopOrder)

export const MOBILE_PRIMARY_DESTINATIONS = NAVIGATION_DESTINATIONS
  .filter((destination) => destination.mobilePrimary)
  .sort((left, right) => left.desktopOrder - right.desktopOrder)

export const MORE_DESTINATIONS = NAVIGATION_DESTINATIONS
  .filter((destination): destination is NavigationDestination & { moreOrder: number } => destination.moreOrder !== undefined)
  .sort((left, right) => left.moreOrder - right.moreOrder)

const MORE_GROUP_LABELS: Record<MoreGroupId, string> = {
  planning: 'Planning',
  connections: 'Connections',
  intelligence: 'Intelligence',
  'data-account': 'Data & account',
}

const MORE_GROUP_ORDER: readonly MoreGroupId[] = ['planning', 'connections', 'intelligence', 'data-account']

export interface MoreDestinationGroup {
  id: MoreGroupId
  label: string
  destinations: readonly NavigationDestination[]
}

export const MORE_DESTINATION_GROUPS: readonly MoreDestinationGroup[] = MORE_GROUP_ORDER
  .map((id) => ({ id, label: MORE_GROUP_LABELS[id], destinations: MORE_DESTINATIONS.filter((destination) => destination.moreGroup === id) }))
  .filter((group) => group.destinations.length > 0)
