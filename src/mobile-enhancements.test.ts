import { describe, expect, it } from 'vitest'
import { canStartPullToRefresh, mobileViewportState, pullProgress, shouldRefreshFromPull } from './mobile-enhancements'

describe('mobile pull-to-refresh', () => {
  it('only starts at the top with one touch and no open keyboard', () => {
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

describe('mobile visual viewport', () => {
  it('detects a reduced visual viewport', () => {
    expect(mobileViewportState(800, 500, 0)).toEqual({ height: 500, offsetTop: 0, keyboardInset: 300, keyboardOpen: true })
  })

  it('ignores small browser chrome changes', () => {
    expect(mobileViewportState(800, 730, 10)).toEqual({ height: 730, offsetTop: 10, keyboardInset: 60, keyboardOpen: false })
  })

  it('clamps invalid dimensions', () => {
    expect(mobileViewportState(700, 900, -10)).toEqual({ height: 700, offsetTop: 0, keyboardInset: 0, keyboardOpen: false })
  })
})
