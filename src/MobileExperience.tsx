import { useEffect } from 'react'

/**
 * Mobile runtime enhancements that are independent from application navigation.
 * Navigation is owned by ApplicationShell so this layer must not query or click
 * navigation DOM nodes.
 */
export function MobileExperience() {
  useEffect(() => {
    const viewport = window.visualViewport
    const updateViewport = () => {
      const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
      document.documentElement.style.setProperty('--mobile-keyboard-height', `${keyboard}px`)
    }
    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
    }
  }, [])

  useEffect(() => {
    document.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      image.loading ||= 'lazy'
      image.decoding ||= 'async'
    })

    const idle = window.requestIdleCallback?.(() => document.documentElement.classList.add('mobile-idle-ready'))
      ?? window.setTimeout(() => document.documentElement.classList.add('mobile-idle-ready'), 500)
    return () => {
      if ('cancelIdleCallback' in window && typeof idle === 'number') window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])

  return null
}
