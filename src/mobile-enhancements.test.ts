import { describe, expect, it } from 'vitest'
import {
  canStartPullToRefresh,
  isVerticalPull,
  keyboardInset,
  pullProgress,
  shouldRefreshFromPull,
} from './mobile-enhancements'

describe('mobile pull-to-refresh', () => {
  it('only starts at the top with one allowed touch target', () => {
    expect(canStartPullToRefresh(0, 1, true)).toBe(true)
    expect(canStartPullToRefresh(1, 1, true)).toBe(false)
    expect(canStartPullToRefresh(0, 2, true)).toBe(false)
    expect(canStartPullToRefresh(0, 1, false)).toBe(false)
  })

  it('distinguishes vertical pulls from horizontal gestures', () => {
    expect(isVerticalPull(5, 30)).toBe(true)
    expect(isVerticalPull(30, 5)).toBe(false)
    expect(isVerticalPull(0, -20)).toBe(false)
  })

  it('clamps progress and requires the threshold', () => {
    expect(pullProgress(-5)).toBe(0)
    expect(pullProgress(42)).toBe(0.5)
    expect(pullProgress(120)).toBe(1)
    expect(shouldRefreshFromPull(83)).toBe(false)
    expect(shouldRefreshFromPull(84)).toBe(true)
  })
})

describe('mobile keyboard viewport', () => {
  it('calculates a non-negative keyboard inset', () => {
    expect(keyboardInset(800, 500, 0)).toBe(300)
    expect(keyboardInset(800, 760, 20)).toBe(20)
    expect(keyboardInset(600, 700, 0)).toBe(0)
  })
})
