import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const sourcePath = new URL('./browser-production-acceptance.mjs', import.meta.url)
const generatedPath = new URL('./.browser-production-acceptance.generated.mjs', import.meta.url)

const staleReloadWait = `await waitFor(client, sessionId, 'document.body?.innerText.includes("Finanzübersicht")', 'online reload before offline test')`
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
const brittleEvaluate = `async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId)
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.'
    throw new Error(description)
  }
  return result.result?.value
}`
const navigationTolerantEvaluate = `async function evaluate(client, sessionId, expression) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }, sessionId)
      if (result.exceptionDetails) {
        const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.'
        throw new Error(description)
      }
      return result.result?.value
    } catch (error) {
      const transientNavigation = /Inspected target navigated or closed|Cannot find context with specified id|Execution context was destroyed/i.test(String(error?.message || error))
      if (!transientNavigation || attempt === 4) throw error
      await delay(150 * (attempt + 1))
    }
  }
  throw new Error('Browser evaluation did not recover after navigation.')
}`

const source = await readFile(sourcePath, 'utf8')
if (!source.includes(staleReloadWait)) {
  throw new Error('The browser acceptance reload probe changed; update the stable runner instead of silently skipping the synchronization fix.')
}
if (!source.includes(brittleProfileCleanup)) {
  throw new Error('The browser profile cleanup changed; update the stable runner instead of silently skipping cleanup hardening.')
}
if (!source.includes(brittleEvaluate)) {
  throw new Error('The browser evaluation helper changed; update the stable runner instead of silently skipping navigation hardening.')
}

const generatedSource = source
  .replace(staleReloadWait, stableReloadWait)
  .replace(brittleProfileCleanup, retryTolerantProfileCleanup)
  .replace(brittleEvaluate, navigationTolerantEvaluate)

await writeFile(generatedPath, generatedSource, 'utf8')
try {
  await import(`${pathToFileURL(generatedPath.pathname).href}?run=${Date.now()}`)
} finally {
  await rm(generatedPath, { force: true, maxRetries: 3, retryDelay: 100 })
}
