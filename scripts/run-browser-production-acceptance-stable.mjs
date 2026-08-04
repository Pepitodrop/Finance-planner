import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const sourcePath = new URL('./browser-production-acceptance.mjs', import.meta.url)
const generatedPath = new URL('./.browser-production-acceptance.generated.mjs', import.meta.url)

const staleReloadWait = `await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'online reload before offline test')`
const stableReloadWait = `await waitFor(client, sessionId, 'document.readyState === "complete" && Boolean(document.querySelector("#root")?.children.length) && Boolean(navigator.serviceWorker?.controller) && Boolean(document.querySelector(".app-shell") || document.querySelector(".vault-screen"))', 'online service-worker-controlled shell before offline test')`
const brittleProfileCleanup = `await rm(launched.profile, { recursive: true, force: true })`
const retryTolerantProfileCleanup = `for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(launched.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
        break
      } catch (error) {
        if (attempt === 4 || !['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error
        await delay(200 * (attempt + 1))
      }
    }`

const source = await readFile(sourcePath, 'utf8')
if (!source.includes(staleReloadWait)) {
  throw new Error('The browser acceptance reload probe changed; update the stable runner instead of silently skipping the synchronization fix.')
}
if (!source.includes(brittleProfileCleanup)) {
  throw new Error('The browser profile cleanup changed; update the stable runner instead of silently skipping cleanup hardening.')
}

const generatedSource = source
  .replace(staleReloadWait, stableReloadWait)
  .replace(brittleProfileCleanup, retryTolerantProfileCleanup)

await writeFile(generatedPath, generatedSource, 'utf8')
try {
  await import(`${pathToFileURL(generatedPath.pathname).href}?run=${Date.now()}`)
} finally {
  await rm(generatedPath, { force: true, maxRetries: 3, retryDelay: 100 })
}
