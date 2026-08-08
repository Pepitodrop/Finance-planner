import type { Subscription, SubscriptionStatus } from '../../types'

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  expired: 'Expired',
  unknown: 'Status unknown',
}

export const INTERVAL_LABEL: Record<Subscription['billingInterval'], string> = {
  weekly: 'week',
  monthly: 'month',
  quarterly: 'quarter',
  yearly: 'year',
  irregular: 'irregular interval',
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'Not yet synced'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Not yet synced'
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function formatSubscriptionDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
