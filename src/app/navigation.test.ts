import { describe, expect, it } from 'vitest'
import {
  DESKTOP_DESTINATIONS,
  MOBILE_PRIMARY_DESTINATIONS,
  MORE_DESTINATIONS,
  MORE_DESTINATION_GROUPS,
  NAVIGATION_DESTINATIONS,
  initialTabFromSearch,
} from './navigation'

describe('initialTabFromSearch', () => {
  it('boots into dashboard with no query string', () => {
    expect(initialTabFromSearch('')).toBe('dashboard')
  })

  it('boots into subscriptions for a google-subscriptions return', () => {
    expect(initialTabFromSearch('?provider=google-subscriptions')).toBe('subscriptions')
  })

  it('boots into connections for a real GoCardless success-redirect (provider alone, no code/state)', () => {
    expect(initialTabFromSearch('?provider=gocardless')).toBe('connections')
  })

  it('boots into connections for an Enable Banking success-redirect', () => {
    expect(initialTabFromSearch('?provider=enablebanking')).toBe('connections')
  })

  it('boots into connections for a provider-denied authorization return', () => {
    expect(initialTabFromSearch('?error=access_denied&error_description=denied')).toBe('connections')
  })

  it('boots into connections for a PayPal return', () => {
    expect(initialTabFromSearch('?provider=paypal')).toBe('connections')
  })

  it('boots into connections for a failed callback even without a provider param', () => {
    expect(initialTabFromSearch('?error=invalid_state&error_description=expired')).toBe('connections')
  })

  it('does not misfire on unrelated query strings', () => {
    expect(initialTabFromSearch('?foo=bar')).toBe('dashboard')
  })
})

describe('canonical navigation model', () => {
  it('defines each functional destination once with unique ordering', () => {
    expect(new Set(NAVIGATION_DESTINATIONS.map(({ id }) => id)).size).toBe(NAVIGATION_DESTINATIONS.length)
    expect(new Set(DESKTOP_DESTINATIONS.map(({ desktopOrder }) => desktopOrder)).size).toBe(DESKTOP_DESTINATIONS.length)
    expect(DESKTOP_DESTINATIONS.map(({ id }) => id)).toEqual([
      'dashboard', 'transactions', 'accounts', 'goals', 'recurring', 'connections', 'subscriptions', 'ai', 'assistant', 'receipt', 'data', 'account',
    ])
  })

  it('uses only the approved staged mobile destinations, with the five-item primary nav unchanged', () => {
    expect(MOBILE_PRIMARY_DESTINATIONS.map(({ id }) => id)).toEqual([
      'dashboard', 'transactions', 'accounts', 'goals',
    ])
    expect(MORE_DESTINATIONS.map(({ id }) => id)).toEqual([
      'recurring', 'connections', 'subscriptions', 'ai', 'assistant', 'receipt', 'data', 'account',
    ])
  })

  it('groups the More sheet into the approved Step 13A sections', () => {
    expect(MORE_DESTINATION_GROUPS.map(({ id, label, destinations }) => ({ id, label, destinations: destinations.map((d) => d.id) }))).toEqual([
      { id: 'planning', label: 'Planning', destinations: ['recurring'] },
      { id: 'connections', label: 'Connections', destinations: ['connections', 'subscriptions'] },
      { id: 'intelligence', label: 'Intelligence', destinations: ['ai', 'assistant', 'receipt'] },
      { id: 'data-account', label: 'Data & account', destinations: ['data', 'account'] },
    ])
  })

  it('keeps Recurring Payments and Provider Subscriptions as separate destinations', () => {
    const ids = NAVIGATION_DESTINATIONS.map(({ id }) => id as string)
    expect(ids).toContain('recurring')
    expect(ids).toContain('subscriptions')
    expect(NAVIGATION_DESTINATIONS.find((d) => d.id === 'recurring')?.label).toBe('Recurring')
  })

  it('does not expose unavailable product destinations', () => {
    const ids = NAVIGATION_DESTINATIONS.map(({ id }) => id as string)
    expect(ids).toContain('accounts')
    expect(ids).not.toContain('investments')
    expect(ids).not.toContain('reports')
    expect(ids).not.toContain('net-worth')
    expect(ids).not.toContain('settings')
    expect(ids).not.toContain('preferences')
    expect(ids).not.toContain('notifications')
    expect(ids).not.toContain('profile')
  })
})
