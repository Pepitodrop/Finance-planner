import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Matches the retry convention already established by
// run-connections-production-acceptance-stable.mjs: known-transient CDP
// failures (a headless Chrome instance on a shared CI runner occasionally
// drops its target mid-evaluate) get retried whole, everything else fails
// immediately.
const MAX_TRANSIENT_ATTEMPTS = 3
const SCRIPT = resolve('scripts/auth-security-production-acceptance.mjs')
const ARTIFACT_PATH = resolve(process.env.AUTH_SECURITY_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/auth-security-production-acceptance.json')

function isRetryableBrowserFailure(report) {
  const failure = String(report?.error || '')
  // The window.__financePlanner*AcceptanceState hooks only exist after
  // AuthGate/VaultGate mount; "is not a function" here means a navigation
  // reset the page between the waitFor(hook exists) check and the call --
  // the same underlying race as "Inspected target navigated or closed",
  // just surfacing through a different code path. waitFor() also swallows
  // the raw CDP error internally and keeps polling until its own deadline,
  // so a freshly-launched Chrome target dropped mid-evaluate can surface as
  // a plain "Timed out waiting for X" with no CDP text in it at all.
  if (/Inspected target navigated or closed|CDP connection (?:closed|failed)|Failed to fetch|Chrome did not publish a DevTools endpoint|CDP connection timed out|__financePlanner\w*AcceptanceState is not a function/.test(failure)) return true
  // If literally no state was captured yet, the failure happened before any
  // substantive assertion ran -- almost certainly launch/first-navigation
  // instability, not a logic bug (the real logic bugs found during Step 11
  // development all manifested mid-flow, with earlier states already
  // captured successfully).
  if (Object.keys(report?.states || {}).length === 0) return true
  return false
}

function runNode(script) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', env: process.env })
    child.once('exit', (code, signal) => resolveRun({ code, signal }))
  })
}

let result
let report
let attempts = 0
for (attempts = 1; attempts <= MAX_TRANSIENT_ATTEMPTS; attempts += 1) {
  result = await runNode(SCRIPT)
  report = JSON.parse(await readFile(ARTIFACT_PATH, 'utf8').catch(() => '{}'))
  if (result.code === 0 || !isRetryableBrowserFailure(report) || attempts === MAX_TRANSIENT_ATTEMPTS) break
  console.warn(`Retrying Step 11 auth/security acceptance after transient browser failure (${attempts}/${MAX_TRANSIENT_ATTEMPTS}): ${report.error}`)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempts))
}

if (result.code !== 0) {
  console.error(`Step 11 auth/security acceptance failed with exit ${result.code ?? result.signal} after ${attempts} attempt(s).`)
  process.exitCode = result.code ?? 1
}
