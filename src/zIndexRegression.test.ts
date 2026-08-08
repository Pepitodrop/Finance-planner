import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Regression coverage for the release-hardening fix where `.modal-backdrop`
// and `.undo-toast` rendered *behind* the mobile connectivity notification
// banner (and other fixed overlays), making Save/Cancel and the undo-delete
// button unclickable. This was found and verified manually in a real browser
// (jsdom does not compute real layout/stacking), so this test cannot prove
// the visual bug is fixed. What it CAN do cheaply and reliably is guard the
// specific regression: if `.modal-backdrop` or `.undo-toast` ever drift back
// down to a low z-index, or some other overlay's z-index creeps above theirs,
// this test fails immediately instead of relying on someone re-clicking
// through the app in a browser.
//
// A true stacking-order regression test (does the modal actually paint above
// the banner) needs an E2E/browser tool such as Playwright, which this repo
// does not currently have. That check is [->E2E] and out of scope here.

const srcDir = dirname(fileURLToPath(import.meta.url))

function readCss(name: string): string {
  return readFileSync(join(srcDir, name), 'utf8')
}

function zIndexOf(css: string, selector: string, tokens = css): number {
  // A selector can appear in more than one rule (e.g. grouped with other
  // selectors in a base rule that only sets `display: none`, then again
  // inside a media query with the real z-index). Walk every occurrence of
  // the selector text and use the first enclosing `{...}` block that
  // actually declares a z-index, since that's the rule that matters for
  // stacking.
  let searchFrom = 0
  while (true) {
    const selectorIndex = css.indexOf(selector, searchFrom)
    if (selectorIndex === -1) break
    const braceOpen = css.indexOf('{', selectorIndex)
    const braceClose = css.indexOf('}', braceOpen)
    if (braceOpen === -1 || braceClose === -1) break
    const body = css.slice(braceOpen + 1, braceClose)
    const zMatch = /z-index:\s*(-?\d+|var\((--[\w-]+)\))/.exec(body)
    if (zMatch) {
      if (!zMatch[2]) return Number(zMatch[1])
      const tokenMatch = new RegExp(`${zMatch[2]}:\\s*(-?\\d+)`).exec(tokens)
      if (tokenMatch) return Number(tokenMatch[1])
      throw new Error(`expected to resolve ${zMatch[2]} for ${selector}`)
    }
    searchFrom = braceClose + 1
  }
  throw new Error(`expected to find a rule with a z-index for ${selector}`)
}

describe('overlay z-index regression (modal + undo-toast vs. notification banner)', () => {
  const styles = readCss('styles.css')
  const foundation = readCss('design-foundation.css')
  const usability = readCss('usability.css')
  const mobileConnectivity = readCss('mobile-connectivity.css')
  const appShell = readCss('app/app-shell.css')
  const mobileEnhancements = readCss('mobile-enhancements.css')

  // The other fixed-position overlays that were competing for stacking order.
  // (Intentionally excludes `.mobile-privacy-shielded body::before`, the
  // full-screen vault lock curtain, which uses z-index 2147483647 on purpose
  // so it can cover *everything*, modal included.)
  const bannerTierZIndexes = {
    '.mobile-connectivity-status': zIndexOf(mobileConnectivity, '.mobile-connectivity-status'),
    '.app-mobile-navigation': zIndexOf(appShell, '.app-mobile-navigation', foundation),
    '.app-more-backdrop': zIndexOf(appShell, '.app-more-backdrop', foundation),
    '.mobile-boot-skeleton': zIndexOf(mobileEnhancements, '.mobile-boot-skeleton'),
    '.mobile-pull-indicator': zIndexOf(mobileEnhancements, '.mobile-pull-indicator'),
  }

  it('modal-backdrop keeps its raised z-index (was 20, regressed behind the banner)', () => {
    expect(zIndexOf(styles, '.modal-backdrop')).toBe(10041)
  })

  it('modal-backdrop stacks above undo-toast (was an unintended tie at 10040)', () => {
    expect(zIndexOf(styles, '.modal-backdrop')).toBeGreaterThan(zIndexOf(usability, '.undo-toast'))
  })

  it('undo-toast keeps its raised z-index (was 30, regressed behind the banner)', () => {
    expect(zIndexOf(usability, '.undo-toast')).toBe(10040)
  })

  it('modal-backdrop stacks above every banner-tier overlay it was previously hidden behind', () => {
    const modalZ = zIndexOf(styles, '.modal-backdrop')
    for (const [selector, z] of Object.entries(bannerTierZIndexes)) {
      expect(modalZ, `.modal-backdrop (${modalZ}) must stack above ${selector} (${z})`).toBeGreaterThan(z)
    }
  })

  it('undo-toast stacks above every banner-tier overlay it was previously hidden behind', () => {
    const toastZ = zIndexOf(usability, '.undo-toast')
    for (const [selector, z] of Object.entries(bannerTierZIndexes)) {
      expect(toastZ, `.undo-toast (${toastZ}) must stack above ${selector} (${z})`).toBeGreaterThan(z)
    }
  })
})
