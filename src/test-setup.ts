import { webcrypto } from 'node:crypto'
import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  if (!window.crypto?.subtle) Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })

  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  window.scrollTo = () => {}

  // Component tests run with no backend present. Default every unmocked fetch to a
  // fast, real network-style failure so offline-first code paths (cloud sync, etc.)
  // fail closed deterministically instead of hanging or making a real request.
  if (!window.fetch || !('__isTestStub' in window.fetch)) {
    const offlineFetch = () => Promise.reject(new TypeError('Failed to fetch'))
    offlineFetch.__isTestStub = true
    window.fetch = offlineFetch as typeof window.fetch
  }
}
