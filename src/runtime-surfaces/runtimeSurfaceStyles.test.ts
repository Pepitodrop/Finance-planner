import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./runtime-surfaces.css', import.meta.url), 'utf8')

describe('runtime-surface responsive policy', () => {
  it('uses foundation layers and reserves mobile bottom-navigation clearance', () => {
    expect(styles).toContain('z-index: var(--fp-z-status)')
    expect(styles).toContain('padding-bottom: calc(var(--fp-mobile-fixed-bottom) + var(--fp-touch-target) + var(--fp-space-6))')
    expect(styles).not.toMatch(/z-index:\s*\d{4,}/)
  })

  it('keeps critical banners in flow and optional prompts out of genuine dialogs', () => {
    expect(styles).toContain('.mobile-connectivity-status,\n.mobile-runtime__banner')
    expect(styles).toContain('position: relative')
    expect(styles).toContain('body:has([aria-modal="true"]) .runtime-optional-surface')
  })
})
