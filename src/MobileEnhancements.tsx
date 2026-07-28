import { useEffect, useRef, useState } from 'react'
import {
  canStartPullToRefresh,
  isEditableTarget,
  mobileViewportState,
  pullProgress,
  shouldRefreshFromPull,
  triggerHaptic,
} from './mobile-enhancements'

const PULL_THRESHOLD = 84

export function MobileEnhancements() {
  const startY = useRef<number | null>(null)
  const keyboardOpen = useRef(false)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 450)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement

    const updateViewport = () => {
      const state = mobileViewportState(window.innerHeight, viewport?.height, viewport?.offsetTop)
      keyboardOpen.current = state.keyboardOpen
      root.classList.toggle('mobile-keyboard-open', state.keyboardOpen)
      root.style.setProperty('--mobile-viewport-height', `${state.height}px`)
      root.style.setProperty('--mobile-viewport-offset-top', `${state.offsetTop}px`)
      root.style.setProperty('--mobile-keyboard-inset', `${state.keyboardInset}px`)
    }

    updateViewport()
    window.addEventListener('resize', updateViewport, { passive: true })
    window.addEventListener('orientationchange', updateViewport, { passive: true })
    viewport?.addEventListener('resize', updateViewport, { passive: true })
    viewport?.addEventListener('scroll', updateViewport, { passive: true })

    return () => {
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      root.classList.remove('mobile-keyboard-open')
      root.style.removeProperty('--mobile-viewport-height')
      root.style.removeProperty('--mobile-viewport-offset-top')
      root.style.removeProperty('--mobile-keyboard-inset')
    }
  }, [])

  useEffect(() => {
    let focusTimer: number | undefined
    const handleFocus = (event: FocusEvent) => {
      if (!isEditableTarget(event.target)) return
      window.clearTimeout(focusTimer)
      focusTimer = window.setTimeout(() => {
        const target = event.target as HTMLElement
        if (!target.isConnected || document.activeElement !== target) return
        target.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        })
      }, 180)
    }

    document.addEventListener('focusin', handleFocus)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('focusin', handleFocus)
    }
  }, [])

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      if (!canStartPullToRefresh(window.scrollY, event.touches.length, keyboardOpen.current)) return
      startY.current = event.touches[0]?.clientY ?? null
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (startY.current === null || refreshing || keyboardOpen.current) return
      const nextDistance = Math.max(0, (event.touches[0]?.clientY ?? startY.current) - startY.current)
      if (nextDistance > 0 && window.scrollY <= 0) event.preventDefault()
      setDistance(Math.min(nextDistance * 0.55, PULL_THRESHOLD * 1.35))
    }

    const finishPull = () => {
      if (startY.current === null) return
      startY.current = null
      if (!keyboardOpen.current && shouldRefreshFromPull(distance, PULL_THRESHOLD)) {
        setRefreshing(true)
        triggerHaptic('success')
        window.setTimeout(() => window.location.reload(), 180)
        return
      }
      setDistance(0)
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
  }, [distance, refreshing])

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
