import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mandatory Step 11 regression: a normal production build (no
// VITE_ACCEPTANCE_FIXTURES) must never expose test-password sign-in as an
// ordinary login option. Because `import.meta.env.VITE_ACCEPTANCE_FIXTURES`
// gates that whole block at build time, a real production Vite build should
// dead-code-eliminate it entirely -- so this checks the actual compiled
// bundle, not just the source, which is a stronger proof than a source
// grep alone.
const BANNED_STRINGS = [
  'Sign in with test password',
  'Testpasswort',
  'test-account password',
]

const outDir = await mkdtemp(join(tmpdir(), 'finance-planner-leakage-check-'))
try {
  const env = { ...process.env }
  delete env.VITE_ACCEPTANCE_FIXTURES
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    stdio: 'pipe',
    env,
  })

  const assetsDir = join(outDir, 'assets')
  const files = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'))
  if (files.length === 0) throw new Error('No JS bundle produced by the leakage-check build.')

  const leaks = []
  for (const file of files) {
    const contents = await readFile(join(assetsDir, file), 'utf8')
    for (const needle of BANNED_STRINGS) {
      if (contents.includes(needle)) leaks.push(`${needle} (in ${file})`)
    }
  }

  if (leaks.length > 0) {
    throw new Error(`Test-password sign-in leaked into a normal production build: ${leaks.join(', ')}`)
  }

  console.log(`Test-password leakage check passed: none of ${BANNED_STRINGS.length} banned strings found in ${files.length} production bundle file(s).`)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
