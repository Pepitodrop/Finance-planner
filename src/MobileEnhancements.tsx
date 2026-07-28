import { useEffect, useRef, useState } from 'react'
import {
  canStartPullToRefresh,
  isPullGestureBlocked,
  pullProgress,
  shouldRefreshFromPull,
  triggerHaptic,
  viewportMetrics,
} from './mobile-enhancements'

const PULL_THRESHOLD = 84

export function MobileEnhancements() {
  const startY = useRef<number | null>(null)
  const distanceRef = useRef(0)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [booting, setBooting] = useState(true)

  const updateDistance = (value: number) => {
    distanceRef.current = value
    setDistance(value)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 450)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const viewport = window.visualViewport
    const applyViewport = () => {
      const metrics = viewportMetrics(viewport, window.innerHeight)
      document.documentElement.style.setProperty('--mobile-viewport-height', `${metrics.height}px`)
      document.documentElement.style.setProperty('--mobile-viewport-offset-top', `${metrics.offsetTop}px`)
    }

    applyViewport()
    viewport?.addEventListener('resize', applyViewport)
    viewport?.addEventListener('scroll', applyViewport)
    window.addEventListener('orientationchange', applyViewport)
    return () => {
      viewport?.removeEventListener('resize', applyViewport)
      viewport?.removeEventListener('scroll', applyViewport)
      window.removeEventListener('orientationchange', applyViewport)
      document.documentElement.style.removeProperty('--mobile-viewport-height')
      document.documentElement.style.removeProperty('--mobile-viewport-offset-top')
    }
  }, [])

  useEffect(() => {
    const dialogOpen = () => Boolean(document.querySelector('[role="dialog"], .modal-backdrop'))
    const handleTouchStart = (event: TouchEvent) => {
      const blocked = isPullGestureBlocked(event.target, dialogOpen())
      if (!canStartPullToRefresh(window.scrollY, event.touches.length, blocked)) return
      startY.current = event.touches[0]?.clientY ?? null
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (startY.current === null || refreshing) return
      const nextDistance = Math.max(0, (event.touches[0]?.clientY ?? startY.current) - startY.current)
      if (nextDistance > 0 && window.scrollY <= 0) event.preventDefault()
      updateDistance(Math.min(nextDistance * 0.55, PULL_THRESHOLD * 1.35))
    }

    const finishPull = () => {
      if (startY.current === null) return
      startY.current = null
      if (shouldRefreshFromPull(distanceRef.current, PULL_THRESHOLD)) {
        setRefreshing(true)
        triggerHaptic('success')
        window.setTimeout(() => window.location.reload(), 180)
        return
      }
      updateDistance(0)
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', finishPull, { passive: true })
    document.addEventListener('touchcancel', finishPull, { passive: true })
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', finishPull)
      document.removeEventListener('touchcancel', finishPull)
    }
  }, [refreshing])

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