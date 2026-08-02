import { readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const artifactPath = resolve(process.env.ACCEPTANCE_ARTIFACT_PATH || 'artifacts/browser-production-acceptance.json')

async function readReport() {
  try {
    return JSON.parse(await readFile(artifactPath, 'utf8'))
  } catch {
    return null
  }
}

try {
  await import('./browser-production-acceptance.mjs')
} catch (error) {
  const report = await readReport()
  const cleanupOnly = error?.code === 'ENOTEMPTY'
    && typeof error?.path === 'string'
    && error.path.includes('finance-planner-acceptance-')
    && report?.failure === undefined
  if (!cleanupOnly) throw error

  const profileRoot = dirname(error.path)
  let removed = false
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      removed = true
      break
    } catch (cleanupError) {
      if (attempt === 7) {
        console.warn(`Chromium acceptance passed, but temporary profile cleanup remained incomplete: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        break
      }
      await delay(250 * (attempt + 1))
    }
  }
  console.log(`Chromium acceptance checks passed; delayed profile cleanup ${removed ? 'completed' : 'was left to the runner sandbox'}.`)
}
