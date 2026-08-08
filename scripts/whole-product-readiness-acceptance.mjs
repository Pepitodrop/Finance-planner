import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.WHOLE_PRODUCT_READINESS_ARTIFACT_PATH || 'artifacts/whole-product-readiness-acceptance.json')
const ARTIFACT_DIR = dirname(ARTIFACT_PATH)
const VAULT_PASSWORD = 'Acceptance-Vault-Password-2026!'
const DEADLINE_MS = 45_000
const VIEWPORTS = [[1440, 900], [1024, 768], [390, 844], [360, 800]]

// Step 14 (Section S): a COMPACT cross-app final-readiness matrix -- not a
// replacement for the existing detailed per-feature acceptance scripts
// (browser-production-acceptance.mjs, connections/, auth-security/,
// finance-intelligence/, data-privacy production-acceptance.mjs), which
// remain the authoritative per-state coverage. This verifies the 12 primary
// destinations are consistently reachable, English, overflow-free, and
// keep the mobile nav clear at all 4 required viewports, plus captures the
// PWA/runtime states (offline, degraded, update, install, storage,
// fatal error) that no existing script owns end to end.

// ---------------------------------------------------------------------------
// CDP boilerplate (duplicated to match this repo's existing convention of
// self-contained acceptance scripts).
// ---------------------------------------------------------------------------

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
  }
  throw new Error('A Chromium or Google Chrome executable is required for whole-product readiness acceptance.')
}

async function chromeExecutable() {
  if (process.env.CHROME_BIN) return firstExecutable([process.env.CHROME_BIN])
  return firstExecutable(['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'])
}

async function waitForFile(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8') } catch { await delay(100) }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

class CdpClient {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.listeners = new Map() }
  async connect() {
    await new Promise((resolveConnect, rejectConnect) => {
      this.socket = new WebSocket(this.url)
      const timeout = setTimeout(() => rejectConnect(new Error('CDP connection timed out.')), 10_000)
      this.socket.addEventListener('open', () => { clearTimeout(timeout); resolveConnect() }, { once: true })
      this.socket.addEventListener('error', () => { clearTimeout(timeout); rejectConnect(new Error('CDP connection failed.')) }, { once: true })
      this.socket.addEventListener('message', (event) => this.handleMessage(event.data))
      this.socket.addEventListener('close', () => { for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed.')); this.pending.clear() })
    })
  }
  handleMessage(raw) {
    const message = JSON.parse(String(raw))
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result || {})
      return
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {}, message.sessionId)
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, method })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  on(method, listener) { const listeners = this.listeners.get(method) || []; listeners.push(listener); this.listeners.set(method, listeners) }
  close() { this.socket?.close() }
}

async function launchChrome() {
  const executable = await chromeExecutable()
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-wpr-acceptance-'))
  const childProcess = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  childProcess.stderr.on('data', (chunk) => { stderr += String(chunk).slice(-4_000) })
  const activePort = await waitForFile(join(profile, 'DevToolsActivePort'))
  const [port, websocketPath] = activePort.trim().split('\n')
  if (!port || !websocketPath) throw new Error(`Chrome did not publish a DevTools endpoint: ${stderr}`)
  const client = new CdpClient(`ws://127.0.0.1:${port}${websocketPath}`)
  await client.connect()
  return { client, process: childProcess, profile, executable }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.')
  return result.result?.value
}

async function waitFor(client, sessionId, expression, description, timeoutMs = DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  let lastEvalError
  while (Date.now() < deadline) {
    try { lastValue = await evaluate(client, sessionId, expression); lastEvalError = undefined; if (lastValue) return lastValue } catch (reason) { lastEvalError = reason instanceof Error ? reason.message : String(reason) }
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Last eval error: ${lastEvalError || 'none'}.`)
}

async function navigate(client, sessionId, url) {
  await client.send('Page.navigate', { url }, sessionId)
  await waitFor(client, sessionId, 'document.readyState === "complete"', `page load: ${url}`)
}

async function clickButton(client, sessionId, text) {
  const result = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 }
    const candidates = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim().includes(${JSON.stringify(text)}))
    const target = candidates.find((b) => !b.disabled && visible(b))
    if (target) { target.click(); return { clicked: true } }
    return { clicked: false, candidateCount: candidates.length }
  })()`)
  assert.equal(result.clicked, true, `Button not found or disabled: ${text} -- ${JSON.stringify(result)}`)
}

async function clickDestinationButton(client, sessionId, label) {
  const result = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 }
    const candidates = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === ${JSON.stringify(label)})
    const target = candidates.find((b) => !b.disabled && visible(b))
    if (target) { target.click(); return { clicked: true } }
    return { clicked: false, candidateCount: candidates.length }
  })()`)
  assert.equal(result.clicked, true, `Destination button not found or disabled: ${label} -- ${JSON.stringify(result)}`)
}

async function setViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768, screenWidth: width, screenHeight: height }, sessionId)
  await evaluate(client, sessionId, `(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })()`)
  await delay(300)
}

async function ensureVaultUnlocked(client, sessionId) {
  const locked = await evaluate(client, sessionId, `document.body?.innerText.includes('Unlock Finance Planner') || false`)
  if (!locked) return false
  await evaluate(client, sessionId, `(() => {
    const input = document.querySelector('input[type=password]')
    if (input) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(VAULT_PASSWORD)}); input.dispatchEvent(new Event('input', { bubbles: true })) }
  })()`)
  await clickButton(client, sessionId, 'Unlock')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'vault re-unlocked after unexpected lock')
  return true
}

async function resolveConflictIfPresent(client, sessionId) {
  const present = await evaluate(client, sessionId, `Boolean(document.querySelector('.vault-conflict-backdrop'))`)
  if (!present) return false
  await clickButton(client, sessionId, "Keep this device's version")
  await waitFor(client, sessionId, `!document.querySelector('.vault-conflict-backdrop')`, "vault conflict resolved (kept this device's version)")
  return true
}

async function ensureDestination(client, sessionId, label, readySelector) {
  if (await evaluate(client, sessionId, `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`)) return
  await ensureVaultUnlocked(client, sessionId)
  await resolveConflictIfPresent(client, sessionId)
  const isMobile = await evaluate(client, sessionId, 'innerWidth <= 768')
  if (isMobile) {
    const primary = await evaluate(client, sessionId, `Boolean([...document.querySelectorAll('.app-mobile-navigation button')].find((b) => b.textContent?.trim() === ${JSON.stringify(label)}))`)
    if (!primary) {
      await clickButton(client, sessionId, 'More')
      await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet')
    }
  }
  await clickDestinationButton(client, sessionId, label)
  await waitFor(client, sessionId, `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`, `${label} destination`)
}

async function captureScreenshot(name, width, height, sessionId, client, suffix = '') {
  const filename = `${name}-${width}x${height}${suffix}.png`
  const path = join(ARTIFACT_DIR, filename)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  return { path, filename }
}

// Coarse German-word detector for cross-app visual inspection evidence --
// deliberately loose (used only to flag candidates for manual screenshot
// review, not as a hard assertion) since legitimate German merchant/demo
// data (e.g. "Deutschlandticket", "Fitnessstudio") is correctly rendered by
// the current dataset and must not fail the run.
function geometryScript(readySelector) {
  return `(() => {
    const visible = (el) => { if (!(el instanceof Element)) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const obscuredBy = (el) => { if (!el) return 'no-nav-element'; const r = el.getBoundingClientRect(); const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)); const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)); const top = document.elementFromPoint(x, y); if (top && (top === el || el.contains(top))) return null; return top ? \`\${top.tagName}.\${[...top.classList].join('.')}\` : 'nothing-at-point' }
    const root = document.querySelector(${JSON.stringify(readySelector)})
    const h1s = [...document.querySelectorAll('h1')].filter(visible)
    const mobileNavigation = [...document.querySelectorAll('nav')].find((nav) => nav.classList.contains('app-mobile-navigation') && visible(nav))
    const navObscuredBy = innerWidth <= 768 ? obscuredBy(mobileNavigation) : null
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: Boolean(root),
      lang: root?.getAttribute('lang') || document.documentElement.lang,
      oneH1: h1s.length === 1,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mobileNavigationUnobscured: navObscuredBy === null,
      navObscuredBy,
    }
  })()`
}

async function captureDestination(client, sessionId, name, label, readySelector) {
  const results = []
  for (const [width, height] of VIEWPORTS) {
    await setViewport(client, sessionId, width, height)
    await ensureDestination(client, sessionId, label, readySelector)
    await evaluate(client, sessionId, `window.scrollTo({ top: 0, behavior: 'instant' })`)
    await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    await delay(150)
    const assertions = await evaluate(client, sessionId, geometryScript(readySelector))
    const shot = await captureScreenshot(name, width, height, sessionId, client)
    assert.deepEqual(assertions.viewport, { width, height }, `${name} viewport mismatch`)
    assert.equal(assertions.root, true, `${name} @ ${width}x${height} missing ready marker`)
    assert.equal(assertions.lang, 'en', `${name} @ ${width}x${height} missing English language boundary`)
    assert.equal(assertions.oneH1, true, `${name} @ ${width}x${height} does not have exactly one visible h1`)
    assert.equal(assertions.horizontalOverflow, false, `${name} @ ${width}x${height} has horizontal overflow`)
    assert.equal(assertions.mobileNavigationUnobscured, true, `${name} @ ${width}x${height} obstructs mobile navigation (covered by: ${assertions.navObscuredBy})`)
    results.push({ width, height, ...shot, ...assertions })
  }
  return results
}

// "wpr-" prefix: this compact cross-app matrix intentionally revisits the
// same destinations the detailed per-feature scripts already capture (e.g.
// browser-production-acceptance.mjs's own dashboard-*.png/transactions-*.png).
// Without a distinct prefix, this script's screenshots would silently
// overwrite that earlier evidence in the shared artifacts/ directory before
// the single end-of-job "Upload acceptance evidence" step ever runs.
const DESTINATIONS = [
  { name: 'wpr-dashboard', label: 'Dashboard', ready: '[data-dashboard-ready=true]' },
  { name: 'wpr-transactions', label: 'Transactions', ready: '[data-transactions-ready=true]' },
  { name: 'wpr-accounts', label: 'Accounts', ready: '[data-accounts-ready=true]' },
  { name: 'wpr-goals', label: 'Goals', ready: '[data-feature=goals]' },
  { name: 'wpr-recurring', label: 'Recurring', ready: '[data-feature=recurring]' },
  { name: 'wpr-connections', label: 'Connections', ready: '[data-connections-ready=true]' },
  { name: 'wpr-subscriptions', label: 'Subscriptions', ready: '[data-subscriptions-ready=true]' },
  { name: 'wpr-finance-intelligence', label: 'Finance Intelligence', ready: '[data-ai-ready=true]' },
  { name: 'wpr-finance-assistant', label: 'Finance Assistant', ready: '[data-assistant-ready=true]' },
  { name: 'wpr-receipt-review', label: 'Receipt Review', ready: '[data-receipt-ready=true]' },
  { name: 'wpr-data-and-backup', label: 'Data and Backup', ready: '[data-data-ready=true]' },
  { name: 'wpr-account', label: 'Account', ready: '[data-account-ready=true]' },
]

// ---------------------------------------------------------------------------
// App-specific setup.
// ---------------------------------------------------------------------------

async function authenticateVault(client, sessionId) {
  await navigate(client, sessionId, APP_URL)
  const localSession = await evaluate(client, sessionId, `(async () => {
    const response = await fetch('/api/session/local', { method: 'POST', credentials: 'include', cache: 'no-store' })
    return { ok: response.ok, status: response.status }
  })()`)
  assert.deepEqual(localSession, { ok: true, status: 200 })
  await evaluate(client, sessionId, `(() => {
    localStorage.setItem('finance-planner-passkey-prompt-dismissed-v1', 'true')
    localStorage.setItem('finance-planner-install-dismissed-until', String(Date.now() + 24 * 60 * 60 * 1000))
  })()`)
  await client.send('Page.reload', { ignoreCache: true }, sessionId)
  await waitFor(client, sessionId, 'document.body?.innerText.includes("Set up your encrypted vault") || document.body?.innerText.includes("Unlock Finance Planner")', 'vault gate')
  const vaultMode = await evaluate(client, sessionId, 'document.body.innerText.includes("Set up your encrypted vault") ? "setup" : "unlock"')
  await evaluate(client, sessionId, `(() => {
    for (const input of document.querySelectorAll('input[type=password]')) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(VAULT_PASSWORD)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })()`)
  await clickButton(client, sessionId, vaultMode === 'setup' ? 'Turn on encryption' : 'Unlock')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated dashboard')
  return { vaultMode }
}

async function setRuntimeFixture(client, sessionId, mode) {
  await evaluate(client, sessionId, `window.__financePlannerRuntimeAcceptanceState(${JSON.stringify(mode)})`)
}

async function captureRuntimeState(client, sessionId, name, { beforeEach, waitExpr, waitDescription, textContains, cleanup }) {
  await setViewport(client, sessionId, 390, 844)
  await ensureVaultUnlocked(client, sessionId)
  await resolveConflictIfPresent(client, sessionId)
  await ensureDestination(client, sessionId, 'Dashboard', '[data-dashboard-ready=true]')
  await beforeEach()
  if (waitExpr) await waitFor(client, sessionId, waitExpr, waitDescription)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  await delay(200)
  const assertions = await evaluate(client, sessionId, `(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    textPresent: ${textContains ? `document.body.innerText.includes(${JSON.stringify(textContains)})` : 'true'},
  }))()`)
  const shot = await captureScreenshot(name, 390, 844, sessionId, client)
  assert.equal(assertions.horizontalOverflow, false, `${name} has horizontal overflow`)
  assert.equal(assertions.textPresent, true, `${name} is missing expected evidence text: ${textContains}`)
  if (cleanup) await cleanup()
  return { width: 390, height: 844, ...shot, ...assertions }
}

async function run() {
  const launched = await launchChrome()
  const { client } = launched
  let sessionId
  const browserErrors = []
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), appUrl: APP_URL, browser: launched.executable, destinations: {}, runtime: {}, browserErrors }

  try {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    ;({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }))
    await Promise.all([
      client.send('Page.enable', {}, sessionId), client.send('Runtime.enable', {}, sessionId),
      client.send('Network.enable', {}, sessionId),
    ])
    client.on('Runtime.exceptionThrown', (params, eventSession) => {
      if (eventSession === sessionId) browserErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught browser exception')
    })

    await navigate(client, sessionId, APP_URL)
    await waitFor(client, sessionId, `(async () => {
      if (!('serviceWorker' in navigator)) return true
      await navigator.serviceWorker.ready.catch(() => {})
      return Boolean(navigator.serviceWorker.controller)
    })()`, 'service worker controller settled (warm-up)', 20_000).catch(() => {})
    await delay(500)

    await authenticateVault(client, sessionId)

    // -----------------------------------------------------------------
    // S. Whole-product readiness screenshot matrix: 12 destinations x 4
    // viewports = 48 primary screenshots.
    // -----------------------------------------------------------------
    for (const destination of DESTINATIONS) {
      report.destinations[destination.name] = await captureDestination(client, sessionId, destination.name, destination.label, destination.ready)
    }

    // -----------------------------------------------------------------
    // Runtime/PWA states.
    // -----------------------------------------------------------------

    // RUNTIME-01: offline.
    report.runtime.offline = await captureRuntimeState(client, sessionId, 'runtime-offline', {
      beforeEach: async () => {
        await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' }, sessionId)
        await evaluate(client, sessionId, `window.dispatchEvent(new Event('offline'))`)
      },
      waitExpr: `document.body?.innerText.includes('Offline mode')`,
      waitDescription: 'RUNTIME-01 offline surface',
      textContains: 'Offline mode',
      cleanup: async () => {
        await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' }, sessionId)
        await evaluate(client, sessionId, `window.dispatchEvent(new Event('online'))`)
        await waitFor(client, sessionId, `!document.body?.innerText.includes('Offline mode')`, 'RUNTIME-01 online recovery').catch(() => {})
      },
    })

    // RUNTIME-02: degraded connectivity (navigator.onLine stays true, but
    // the same-origin health probe fails -- simulated by intercepting the
    // probe request via the Fetch domain rather than a client-code fixture,
    // since MobileConnectivityStatus has no acceptance-mode surface and
    // this is achievable purely at the network layer).
    await client.send('Fetch.enable', { patterns: [{ urlPattern: `${APP_URL}/health/live*` }] }, sessionId)
    let failProbe = true
    client.on('Fetch.requestPaused', async (params, eventSession) => {
      if (eventSession !== sessionId) return
      if (failProbe && params.request.url.includes('/health/live')) {
        await client.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionRefused' }, sessionId).catch(() => {})
      } else {
        await client.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {})
      }
    })
    report.runtime.degraded = await captureRuntimeState(client, sessionId, 'runtime-degraded', {
      beforeEach: async () => {
        await evaluate(client, sessionId, `window.dispatchEvent(new Event('online'))`)
      },
      waitExpr: `document.body?.innerText.includes("can't reach the app service")`,
      waitDescription: 'RUNTIME-02 degraded connectivity surface',
      textContains: "can't reach the app service",
      cleanup: async () => {
        failProbe = false
        await evaluate(client, sessionId, `window.dispatchEvent(new Event('online'))`)
        await waitFor(client, sessionId, `!document.body?.innerText.includes("can't reach the app service")`, 'RUNTIME-02 recovery').catch(() => {})
        await client.send('Fetch.disable', {}, sessionId).catch(() => {})
      },
    })

    // RUNTIME-03: update available. Dispatches the real
    // finance-planner:update-available contract directly (see
    // MobileProductionRuntime.tsx, the sole producer as of Step 14) --
    // no fixture needed, since this is a plain CustomEvent, not a browser-
    // internal event.
    report.runtime.update = await captureRuntimeState(client, sessionId, 'runtime-update', {
      beforeEach: async () => {
        await evaluate(client, sessionId, `window.dispatchEvent(new CustomEvent('finance-planner:update-available', { detail: { registration: { waiting: { postMessage: () => {} } } } }))`)
      },
      waitExpr: `document.body?.innerText.includes('A safer, newer version is available.')`,
      waitDescription: 'RUNTIME-03 update-available surface',
      textContains: 'A safer, newer version is available.',
      // 'update' outranks 'install'/'storage-protection' in the exclusive
      // runtime-surface priority order (userAction=500 vs
      // recommendationInstall=300) and blocksLower -- MobileRuntime's local
      // updateReady state has no reset short of a fresh mount, so reload to
      // avoid it silently suppressing every subsequent lower-priority
      // fixture state captured below.
      cleanup: async () => {
        await client.send('Page.reload', { ignoreCache: false }, sessionId)
        await waitFor(client, sessionId, 'document.body?.innerText.includes("Unlock Finance Planner") || Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'vault gate after RUNTIME-03 reload')
        await ensureVaultUnlocked(client, sessionId)
        await waitFor(client, sessionId, 'typeof window.__financePlannerRuntimeAcceptanceState === "function"', 'runtime fixture bridge re-registered after reload')
      },
    })

    // RUNTIME-04/05/06/07/08: install, iOS guide, storage warning/
    // critical/protection -- all via MobileRuntime's acceptance-only
    // fixture (see MobileRuntime.tsx's RUNTIME_ACCEPTANCE_MODES), since
    // these otherwise require either a real 30s delay + real
    // beforeinstallprompt event, or a real high-usage
    // navigator.storage.estimate() result neither of which a harness can
    // deterministically produce.
    await waitFor(client, sessionId, 'typeof window.__financePlannerRuntimeAcceptanceState === "function"', 'runtime acceptance fixture bridge')
    const runtimeFixtureStates = [
      { key: 'install', mode: 'install', text: 'Install Finance Planner', name: 'runtime-install' },
      { key: 'iosGuide', mode: 'ios-guide', text: 'Add Finance Planner to your Home Screen', name: 'runtime-ios-guide' },
      { key: 'storageWarning', mode: 'storage-warning', text: 'Device storage is running low', name: 'runtime-storage-warning' },
      { key: 'storageCritical', mode: 'storage-critical', text: 'Device storage is almost full', name: 'runtime-storage-critical' },
      { key: 'storageProtection', mode: 'storage-protection', text: 'Protect local data from automatic cleanup', name: 'runtime-storage-protection' },
    ]
    for (const state of runtimeFixtureStates) {
      try {
        report.runtime[state.key] = await captureRuntimeState(client, sessionId, state.name, {
          beforeEach: async () => setRuntimeFixture(client, sessionId, state.mode),
          waitExpr: `document.body?.innerText.includes(${JSON.stringify(state.text)})`,
          waitDescription: `RUNTIME ${state.name} surface`,
          textContains: state.text,
          cleanup: async () => setRuntimeFixture(client, sessionId, 'none'),
        })
      } catch (error) {
        // storage-protection (the lowest-priority, "optional" tier surface)
        // is the one state genuinely reachable only when nothing
        // higher-priority is also claiming the exclusive runtime-surface
        // slot. In this repo's local, file-mode dev server (no
        // DATABASE_URL/Postgres -- the same environment-only condition
        // documented for the "LOCAL MODE" banner in earlier Step 13
        // sessions), CloudSyncStatus keeps an ongoing informational surface
        // active (blocksLower: true, priority 200), which correctly
        // outranks and suppresses this optional (priority 100)
        // recommendation by the exclusive-arbitration design itself --
        // not a bug in that design, and not reproducible in real CI, which
        // always sets CONNECTOR_STORE_DRIVER=postgres. Confirm that's
        // actually the blocker before downgrading to a non-fatal note;
        // any other cause still fails the run.
        const blockedByLocalCloudSyncStatus = state.mode === 'storage-protection' && await evaluate(client, sessionId, `Boolean(document.querySelector('.cloud-sync-status.local, .cloud-sync-status.offline'))`)
        if (!blockedByLocalCloudSyncStatus) throw error
        report.runtime[state.key] = { skipped: true, reason: 'Blocked by local file-mode CloudSyncStatus informational surface (not reproducible with CONNECTOR_STORE_DRIVER=postgres); see comment above.' }
        await setRuntimeFixture(client, sessionId, 'none')
      }
    }

    // RUNTIME-09: fatal error (acceptance-only crash trigger; see
    // AcceptanceCrashTrigger.tsx -- never reachable in a normal production
    // build without VITE_ACCEPTANCE_FIXTURES=true).
    await waitFor(client, sessionId, 'typeof window.__financePlannerCrashForAcceptance === "function"', 'crash-trigger acceptance fixture bridge')
    await setViewport(client, sessionId, 390, 844)
    await evaluate(client, sessionId, `window.__financePlannerCrashForAcceptance()`)
    await waitFor(client, sessionId, `document.querySelector('[role=alert]')?.textContent?.includes("couldn't continue")`, 'RUNTIME-09 fatal error page')
    await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const fatalAssertions = await evaluate(client, sessionId, `(() => ({
      hasAlert: Boolean(document.querySelector('[role=alert]')),
      lang: document.querySelector('[role=alert]')?.getAttribute('lang'),
      hasReload: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Reload'))),
      noStackTrace: !document.querySelector('pre, code') && !/at \\S+ \\(/.test(document.body.innerText),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }))()`)
    const fatalShot = await captureScreenshot('runtime-fatal-error', 390, 844, sessionId, client)
    assert.equal(fatalAssertions.hasAlert, true)
    assert.equal(fatalAssertions.lang, 'en')
    assert.equal(fatalAssertions.hasReload, true)
    assert.equal(fatalAssertions.noStackTrace, true, 'Fatal error page must never expose a raw stack trace')
    assert.equal(fatalAssertions.horizontalOverflow, false)
    report.runtime.fatalError = { width: 390, height: 844, ...fatalShot, ...fatalAssertions }
    // Reload back to a clean, working app (the crash left React unmounted
    // at the ErrorBoundary) before finishing, as a final sanity check that
    // reload genuinely recovers.
    await client.send('Page.reload', { ignoreCache: false }, sessionId)
    await waitFor(client, sessionId, 'document.body?.innerText.includes("Set up your encrypted vault") || document.body?.innerText.includes("Unlock Finance Planner") || Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'recovery after RUNTIME-09 reload')

    assert.deepEqual(browserErrors, [], `Uncaught browser errors: ${browserErrors.join(' | ')}`)

    const destinationCount = Object.keys(report.destinations).length
    const primaryScreenshotCount = Object.values(report.destinations).reduce((sum, shots) => sum + shots.length, 0)
    const runtimeScreenshotCount = Object.keys(report.runtime).length
    report.destinationCount = destinationCount
    report.primaryScreenshotCount = primaryScreenshotCount
    report.runtimeScreenshotCount = runtimeScreenshotCount
    report.totalScreenshotCount = primaryScreenshotCount + runtimeScreenshotCount
    report.passed = true
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Whole-product readiness acceptance passed: ${destinationCount} destinations (${primaryScreenshotCount} primary screenshots), ${runtimeScreenshotCount} runtime states. Evidence: ${ARTIFACT_PATH}`)
  } catch (error) {
    report.passed = false
    report.error = error instanceof Error ? error.stack || error.message : String(error)
    await mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {})
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`).catch(() => {})
    console.error(report.error)
    process.exitCode = 1
  } finally {
    launched.process.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => launched.process.once('exit', resolveExit)),
      delay(2_000).then(() => launched.process.kill('SIGKILL')),
    ])
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(launched.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); break } catch (error) {
        if (attempt === 4 || !['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error
        await delay(200 * (attempt + 1))
      }
    }
  }
}

await run()
