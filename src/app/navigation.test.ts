import { describe, expect, it } from 'vitest'
import {
  DESKTOP_DESTINATIONS,
  MOBILE_PRIMARY_DESTINATIONS,
  MORE_DESTINATIONS,
  NAVIGATION_DESTINATIONS,
} from './navigation'

describe('canonical navigation model', () => {
  it('defines each functional destination once with unique ordering', () => {
    expect(new Set(NAVIGATION_DESTINATIONS.map(({ id }) => id)).size).toBe(NAVIGATION_DESTINATIONS.length)
    expect(new Set(DESKTOP_DESTINATIONS.map(({ desktopOrder }) => desktopOrder)).size).toBe(DESKTOP_DESTINATIONS.length)
    expect(DESKTOP_DESTINATIONS.map(({ id }) => id)).toEqual([
      'dashboard', 'transactions', 'goals', 'recurring', 'connections', 'ai', 'assistant', 'receipt', 'data',
    ])
  })

  it('uses only the approved staged mobile destinations', () => {
    expect(MOBILE_PRIMARY_DESTINATIONS.map(({ id }) => id)).toEqual([
      'dashboard', 'transactions', 'goals', 'connections',
    ])
    expect(MORE_DESTINATIONS.map(({ id }) => id)).toEqual([
      'recurring', 'ai', 'assistant', 'receipt', 'data',
    ])
  })

  it('does not expose unavailable product destinations', () => {
    const ids = NAVIGATION_DESTINATIONS.map(({ id }) => id as string)
    expect(ids).not.toContain('accounts')
    expect(ids).not.toContain('investments')
    expect(ids).not.toContain('reports')
    expect(ids).not.toContain('net-worth')
    expect(ids).not.toContain('settings')
  })
})
