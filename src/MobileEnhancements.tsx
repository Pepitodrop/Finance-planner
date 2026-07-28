import { useEffect, useRef, useState } from 'react'
import {
  canStartPullToRefresh,
  isPullToRefreshTargetAllowed,
  isVerticalPull,
  keyboardInset,
  pullProgress,
  shouldRefreshFromPull,
  triggerHaptic,
} from './mobile-enhancements'

const PULL_THRESHOLD = 84

export function MobileEnhancements() {
  const startPoint = useRef<{ x: number; y: number } | null>(null)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 450)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    refreshingRef.current = refreshing
  }, [refreshing])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const syncViewport = () => {
      const inset = keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop)
      document.documentElement.style.setProperty('--mobile-keyboard-inset', `${inset}px`)
      document.documentElement.classList.toggle('mobile-keyboard-open', inset > 80)
    }

    syncViewport()
    viewport.addEventListener('resize', syncViewport)
    viewport.addEventListener('scroll', syncViewport)
    return () => {
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
      document.documentElement.style.removeProperty('--mobile-keyboard-inset')
      document.documentElement.classList.remove('mobile-keyboard-open')
    }
  }, [])

  useEffect(() => {
    const resetPull = () => {
      startPoint.current = null
      distanceRef.current = 0
      setDistance(0)
    }

    const handleTouchStart = (event: TouchEvent) => {
      const allowed = isPullToRefreshTargetAllowed(event.target)
      if (!canStartPullToRefresh(window.scrollY, event.touches.length, allowed)) return
      const touch = event.touches[0]
      startPoint.current = touch ? { x: touch.clientX, y: touch.clientY } : null
    }

    const handleTouchMove = (event: TouchEvent) => {
      const start = startPoint.current
      const touch = event.touches[0]
      if (!start || !touch || refreshingRef.current) return

      const deltaX = touch.clientX - start.x
      const deltaY = touch.clientY - start.y
      if (!isVerticalPull(deltaX, deltaY)) {
        if (Math.abs(deltaX) > 8 || deltaY < -8) resetPull()
        return
      }

      if (window.scrollY > 0) {
        resetPull()
        return
      }

      event.preventDefault()
      const nextDistance = Math.min(deltaY * 0.55, PULL_THRESHOLD * 1.35)
      distanceRef.current = nextDistance
      setDistance(nextDistance)
    }

    const finishPull = () => {
      if (!startPoint.current) return
      startPoint.current = null
      if (shouldRefreshFromPull(distanceRef.current, PULL_THRESHOLD)) {
        refreshingRef.current = true
        setRefreshing(true)
        triggerHaptic('success')
        window.setTimeout(() => window.location.reload(), 180)
        return
      }
      distanceRef.current = 0
      setDistance(0)
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', finishPull, { passive: true })
    document.addEventListener('touchcancel', resetPull, { passive: true })
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', finishPull)
      document.removeEventListener('touchcancel', resetPull)
    }
  }, [])

  useEffect(() => {
    const handleFeedback = (event: Event) => {
      const target = event.target as HTMLElement | null
      const control = target?.closest('button, [role="button"], a[href], [data-haptic]') as HTMLElement | null
      if (!control || control.getAttribute('aria-disabled') === 'true' || control.hasAttribute('disabled')) return
      const kind = control.dataset.haptic === 'success' || control.dataset.haptic === 'error'
        ? control.dataset.haptic
        : 'tap'
      triggerHaptic(kind)
    }
    document.addEventListener('click', handleFeedback)
    return () => document.removeEventListener('click', handleFeedback)
  }, [])

  const progress = pullProgress(distance, PULL_THRESHOLD)

  return (
    <>
      {(distance > 0 || refreshing) && (
        <div
          className="mobile-pull-indicator"
          role="status"
          aria-live="polite"
          style={{ transform: `translate(-50%, ${Math.min(distance, PULL_THRESHOLD)}px)` }}
        >
          <span className={refreshing ? 'mobile-pull-indicator__spinner' : ''} aria-hidden="true">
            {refreshing ? '↻' : progress >= 1 ? '↑' : '↓'}
          </span>
          {refreshing ? 'Refreshing…' : progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}
      {booting && (
        <div className="mobile-boot-skeleton" role="status" aria-label="Loading Finance Planner">
          <div className="mobile-boot-skeleton__bar" />
          <div className="mobile-boot-skeleton__card" />
          <div className="mobile-boot-skeleton__card mobile-boot-skeleton__card--short" />
        </div>
      )}
    </>
  )
}
