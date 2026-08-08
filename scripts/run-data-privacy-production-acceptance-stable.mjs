import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Matches the retry convention already established by
// run-finance-intelligence-production-acceptance-stable.mjs /
// run-auth-security-production-acceptance-stable.mjs /
// run-connections-production-acceptance-stable.mjs: known-transient CDP
// failures (a headless Chrome instance on a shared CI runner occasionally
// drops its target mid-evaluate) get retried whole, everything else fails
// immediately.
const MAX_TRANSIENT_ATTEMPTS = 3
const SCRIPT = resolve('scripts/data-privacy-production-acceptance.mjs')
const ARTIFACT_PATH = resolve(process.env.DATA_PRIVACY_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/data-privacy-production-acceptance.json')

function isRetryableBrowserFailure(report) {
  const failure = String(report?.error || '')
  if (/Inspected target navigated or closed|CDP connection (?:closed|failed)|Failed to fetch|Chrome did not publish a DevTools endpoint|CDP connection timed out|__financePlannerAcceptanceState is not a function/.test(failure)) return true
  // If literally no state was captured yet, the failure happened before any
  // substantive assertion ran -- almost certainly launch/first-navigation
  // instability, not a logic bug.
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
  console.warn(`Retrying Step 13 Data & Privacy acceptance after transient browser failure (${attempts}/${MAX_TRANSIENT_ATTEMPTS}): ${report.error}`)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempts))
}

if (result.code !== 0) {
  console.error(`Step 13 Data & Privacy acceptance failed with exit ${result.code ?? result.signal} after ${attempts} attempt(s).`)
  process.exitCode = result.code ?? 1
}
