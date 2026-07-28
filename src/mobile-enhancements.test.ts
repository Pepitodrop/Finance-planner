import { describe, expect, it } from 'vitest'
import {
  canStartPullToRefresh,
  keyboardInset,
  pullProgress,
  shouldRefreshFromPull,
} from './mobile-enhancements'

describe('mobile pull-to-refresh', () => {
  it('only starts at the top with one touch', () => {
    expect(canStartPullToRefresh(0, 1)).toBe(true)
    expect(canStartPullToRefresh(1, 1)).toBe(false)
    expect(canStartPullToRefresh(0, 2)).toBe(false)
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
  it('calculates the keyboard-covered area', () => {
    expect(keyboardInset(800, 500)).toBe(300)
    expect(keyboardInset(800, 500, 20)).toBe(280)
  })

  it('never returns a negative inset', () => {
    expect(keyboardInset(600, 700)).toBe(0)
  })
})
