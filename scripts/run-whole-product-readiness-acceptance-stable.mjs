import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Matches the retry convention established by run-connections/auth-security/
// finance-intelligence/data-privacy-production-acceptance-stable.mjs:
// retries the whole run a bounded number of times only for known-transient
// CDP/browser-launch failure signatures or a zero-state report, never for a
// genuine assertion failure.
const MAX_TRANSIENT_ATTEMPTS = 3
const ARTIFACT_PATH = resolve(process.env.WHOLE_PRODUCT_READINESS_ARTIFACT_PATH || 'artifacts/whole-product-readiness-acceptance.json')
const TRANSIENT_SIGNATURES = [
  'CDP connection timed out',
  'CDP connection failed',
  'CDP connection closed',
  'Inspected target navigated or closed',
  'Chrome did not publish a DevTools endpoint',
]

function isRetryableBrowserFailure(report) {
  if (!report) return true
  if (report.destinationCount === 0 && report.runtimeScreenshotCount === undefined) return true
  const message = report.error || ''
  return TRANSIENT_SIGNATURES.some((signature) => message.includes(signature))
}

async function runOnce() {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(new URL('./whole-product-readiness-acceptance.mjs', import.meta.url).pathname)], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`whole-product-readiness-acceptance.mjs exited with code ${code}`))))
    child.on('error', rejectPromise)
  })
}

async function readReport() {
  try { return JSON.parse(await readFile(ARTIFACT_PATH, 'utf8')) } catch { return null }
}

for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
  try {
    await runOnce()
    process.exit(0)
  } catch (error) {
    const report = await readReport()
    if (attempt === MAX_TRANSIENT_ATTEMPTS || !isRetryableBrowserFailure(report)) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    console.error(`Retrying whole-product readiness acceptance after transient browser failure (${attempt}/${MAX_TRANSIENT_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`)
    await delay(1_000 * attempt)
  }
}
