import { describe, expect, it } from 'vitest'
import { nextTabIndex, resolveSwipeDirection, viewportHeight } from './mobile-experience'

describe('mobile experience utilities', () => {
  it('recognizes intentional horizontal swipes only', () => {
    expect(resolveSwipeDirection(-100, 10)).toBe(1)
    expect(resolveSwipeDirection(100, 10)).toBe(-1)
    expect(resolveSwipeDirection(40, 2)).toBe(0)
    expect(resolveSwipeDirection(100, 95)).toBe(0)
  })

  it('keeps tab navigation within bounds', () => {
    expect(nextTabIndex(0, -1, 8)).toBe(0)
    expect(nextTabIndex(3, 1, 8)).toBe(4)
    expect(nextTabIndex(7, 1, 8)).toBe(7)
  })

  it('uses the visual viewport with a safe minimum', () => {
    expect(viewportHeight(640.4, 900)).toBe(640)
    expect(viewportHeight(undefined, 700)).toBe(700)
    expect(viewportHeight(200, 700)).toBe(320)
  })
})
