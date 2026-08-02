import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const child = spawn(process.execPath, [new URL('./browser-production-acceptance.mjs', import.meta.url).pathname], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += String(chunk) })
child.stderr.on('data', (chunk) => { stderr += String(chunk) })

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolve(code ?? 1))
})

process.stdout.write(stdout)
if (exitCode === 0) {
  process.stderr.write(stderr)
  process.exit(0)
}

const cleanupMatch = stderr.match(/ENOTEMPTY:[^\n]*rmdir '([^']*finance-planner-acceptance-[^']*)'/)
if (!cleanupMatch) {
  process.stderr.write(stderr)
  process.exit(exitCode)
}

const profileRoot = dirname(cleanupMatch[1])
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
