import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = (path) => readFile(resolve(root, path), 'utf8')
const [main, experience, css] = await Promise.all([
  read('src/main.tsx'),
  read('src/FrontendExperience.tsx'),
  read('src/frontend-experience.css'),
])

assert.match(main, /<FrontendExperience\s*\/>/, 'Frontend experience layer must be mounted')
assert.match(main, /frontend-experience\.css/, 'Frontend experience styles must be loaded')
assert.match(experience, /aria-modal/, 'Transaction dialog must expose modal semantics')
assert.match(experience, /event\.key === 'Escape'/, 'Transaction dialog must support Escape dismissal')
assert.match(experience, /event\.key !== 'Tab'/, 'Transaction dialog must trap keyboard focus')
assert.match(experience, /previousFocus\?\.focus/, 'Focus must return to the invoking control')
assert.match(experience, /document\.body\.style\.overflow = 'hidden'/, 'Background scrolling must stop while modal is open')
assert.match(experience, /sibling === backdrop/, 'The active modal backdrop must be excluded from background hiding')
assert.match(experience, /sibling\.setAttribute\('aria-hidden', 'true'\)/, 'Only modal siblings should be hidden from assistive technology')
assert.match(experience, /sibling\.inert = true/, 'Background siblings must be made non-interactive')
assert.doesNotMatch(experience, /querySelector<HTMLElement>\('\.app-shell'\)[\s\S]*setAttribute\('aria-hidden', 'true'\)/, 'No ancestor containing the active dialog may be aria-hidden')
assert.match(experience, /restoreModalBackground/, 'Background accessibility state must be restored after closing')
assert.match(experience, /role', 'img'/, 'Financial charts must receive accessible image semantics')
assert.match(css, /100dvh/, 'Dynamic mobile viewport height must be supported')
assert.match(css, /safe-area-inset-bottom/, 'Safe-area insets must be supported')
assert.match(css, /content-visibility: auto/, 'Long finance lists should avoid unnecessary rendering work')
assert.match(css, /font-size: max\(1rem, 16px\)/, 'Mobile form controls must avoid browser zoom')
assert.match(css, /@media \(max-width: 420px\)/, 'Narrow phone layouts must be explicitly supported')

console.log('Final frontend experience gate passed.')
