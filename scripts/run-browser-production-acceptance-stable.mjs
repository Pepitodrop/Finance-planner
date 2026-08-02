import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const sourcePath = new URL('./browser-production-acceptance.mjs', import.meta.url)
const generatedPath = new URL('./.browser-production-acceptance.generated.mjs', import.meta.url)

const staleReloadWait = `await waitFor(client, sessionId, 'document.body?.innerText.includes("Finanzübersicht")', 'online reload before offline test')`
const stableReloadWait = `await waitFor(client, sessionId, 'document.readyState === "complete" && Boolean(document.querySelector("#root")?.children.length) && Boolean(navigator.serviceWorker?.controller) && Boolean(document.querySelector(".app-shell") || document.querySelector(".vault-screen"))', 'online service-worker-controlled shell before offline test')`

const source = await readFile(sourcePath, 'utf8')
if (!source.includes(staleReloadWait)) {
  throw new Error('The browser acceptance reload probe changed; update the stable runner instead of silently skipping the synchronization fix.')
}

await writeFile(generatedPath, source.replace(staleReloadWait, stableReloadWait), 'utf8')
try {
  await import(`${pathToFileURL(generatedPath.pathname).href}?run=${Date.now()}`)
} finally {
  await rm(generatedPath, { force: true })
}
