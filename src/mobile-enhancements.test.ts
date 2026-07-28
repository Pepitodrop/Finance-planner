import { describe, expect, it } from 'vitest'
import { canStartPullToRefresh, pullProgress, shouldRefreshFromPull, viewportMetrics } from './mobile-enhancements'

describe('mobile pull-to-refresh', () => {
  it('only starts at the top with one unblocked touch', () => {
    expect(canStartPullToRefresh(0, 1)).toBe(true)
    expect(canStartPullToRefresh(1, 1)).toBe(false)
    expect(canStartPullToRefresh(0, 2)).toBe(false)
    expect(canStartPullToRefresh(0, 1, true)).toBe(false)
  })

  it('clamps progress and requires the threshold', () => {
    expect(pullProgress(-5)).toBe(0)
    expect(pullProgress(42)).toBe(0.5)
    expect(pullProgress(120)).toBe(1)
    expect(shouldRefreshFromPull(83)).toBe(false)
    expect(shouldRefreshFromPull(84)).toBe(true)
  })
})

describe('mobile viewport sizing', () => {
  it('uses visual viewport values when available', () => {
    expect(viewportMetrics({ height: 612.4, offsetTop: 17.6 }, 800)).toEqual({ height: 612, offsetTop: 18 })
  })

  it('falls back safely when visual viewport is unavailable', () => {
    expect(viewportMetrics(null, 800)).toEqual({ height: 800, offsetTop: 0 })
  })
})