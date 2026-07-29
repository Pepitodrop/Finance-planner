import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Regression coverage for 66bc2fb: `.topbar` (h1 + the "Manuelle Buchung"
// primary button) was a flex row that never wrapped, so on narrow (390px)
// viewports the primary button ran off the right edge of the screen and
// caused horizontal page overflow. Fixed by wrapping the topbar and making
// the primary button full-width on its own row at the mobile breakpoint.
// That fix was verified manually in a real browser
// (document.documentElement.scrollWidth <= innerWidth); jsdom cannot compute
// real layout, so this test cannot prove the overflow is gone. What it can
// do cheaply and reliably is guard the specific regression: if flex-wrap or
// the full-width override on `.topbar .primary` is ever dropped from the
// mobile breakpoint, this fails immediately instead of relying on someone
// re-testing at 390px in a browser.

const srcDir = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(srcDir, 'styles.css'), 'utf8')

function mobileBreakpointBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 760px)')
  if (start === -1) throw new Error('expected a max-width: 760px media query')
  const braceOpen = css.indexOf('{', start)
  let depth = 0
  for (let i = braceOpen; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(braceOpen + 1, i)
    }
  }
  throw new Error('unterminated media query block')
}

describe('topbar overflow regression (primary action button ran off-screen on mobile)', () => {
  const block = mobileBreakpointBlock(styles)

  it('wraps the topbar instead of forcing it into a single unbreakable row', () => {
    const rule = /\.topbar\s*\{([^}]*)\}/.exec(block)
    expect(rule, '.topbar rule must exist inside the mobile breakpoint').toBeTruthy()
    expect(rule![1]).toMatch(/flex-wrap:\s*wrap/)
  })

  it('makes the primary action button full-width when it wraps to its own row', () => {
    const rule = /\.topbar \.primary\s*\{([^}]*)\}/.exec(block)
    expect(rule, '.topbar .primary rule must exist inside the mobile breakpoint').toBeTruthy()
    expect(rule![1]).toMatch(/width:\s*100%/)
  })
})
