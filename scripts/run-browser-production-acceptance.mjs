import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

try {
  await import('./browser-production-acceptance.mjs')
} catch (error) {
  const cleanupOnly = error?.code === 'ENOTEMPTY'
    && typeof error?.path === 'string'
    && error.path.includes('finance-planner-acceptance-')
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
        console.warn(`Chromium acceptance completed, but temporary profile cleanup remained incomplete: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        break
      }
      await delay(250 * (attempt + 1))
    }
  }
  console.log(`Chromium acceptance completed; delayed profile cleanup ${removed ? 'completed' : 'was left to the runner sandbox'}.`)
}
