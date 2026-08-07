import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.CONNECTIONS_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/connections-production-acceptance.json')
const ARTIFACT_DIR = dirname(ARTIFACT_PATH)
const VAULT_PASSWORD = 'Acceptance-Vault-Password-2026!'
const DEADLINE_MS = 45_000
const VIEWPORTS = [[1440, 900], [1024, 768], [390, 844], [360, 800]]

const MODES = [
  ['empty', 'Connect your financial accounts'],
  ['populated', 'Connected accounts'],
  ['institution-selector', 'Choose your institution'],
  ['institution-search', 'Choose your institution'],
  ['account-type', 'What would you like to connect?'],
  ['bank-confirmation', 'Continue to your provider'],
  ['paypal-confirmation', 'Continue to PayPal'],
  ['checking', 'Checking your connection'],
  ['sync-selection', 'Choose accounts'],
  ['attention', 'Connection needs attention'],
  ['manual', 'Add manual account'],
  ['statement-preview', 'finance_statement_march.csv'],
]

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
  }
  throw new Error('A Chromium or Google Chrome executable is required for Connections acceptance.')
}

async function chromeExecutable() {
  if (process.env.CHROME_BIN) return firstExecutable([process.env.CHROME_BIN])
  const paths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return firstExecutable(paths)
}

async function waitForFile(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8') } catch { await delay(100) }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

class CdpClient {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }

  async connect() {
    await new Promise((resolveConnect, rejectConnect) => {
      this.socket = new WebSocket(this.url)
      const timeout = setTimeout(() => rejectConnect(new Error('CDP connection timed out.')), 10_000)
      this.socket.addEventListener('open', () => { clearTimeout(timeout); resolveConnect() }, { once: true })
      this.socket.addEventListener('error', () => { clearTimeout(timeout); rejectConnect(new Error('CDP connection failed.')) }, { once: true })
      this.socket.addEventListener('message', (event) => this.handleMessage(event.data))
      this.socket.addEventListener('close', () => {
        for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed.'))
        this.pending.clear()
      })
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

  on(method, listener) {
    const listeners = this.listeners.get(method) || []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  close() { this.socket?.close() }
}

async function launchChrome() {
  const executable = await chromeExecutable()
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-connections-'))
  const process = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  process.stderr.on('data', (chunk) => { stderr += String(chunk).slice(-4_000) })
  const activePort = await waitForFile(join(profile, 'DevToolsActivePort'))
  const [port, websocketPath] = activePort.trim().split('\n')
  if (!port || !websocketPath) throw new Error(`Chrome did not publish a DevTools endpoint: ${stderr}`)
  const client = new CdpClient(`ws://127.0.0.1:${port}${websocketPath}`)
  await client.connect()
  return { client, process, profile, executable }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.')
  }
  return result.result?.value
}

async function waitFor(client, sessionId, expression, description, timeoutMs = DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    try { lastValue = await evaluate(client, sessionId, expression); if (lastValue) return lastValue } catch {}
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`)
}

async function navigate(client, sessionId, url) {
  await client.send('Page.navigate', { url }, sessionId)
  await waitFor(client, sessionId, 'document.readyState === "complete"', `page load: ${url}`)
}

async function clickVisibleButton(client, sessionId, text) {
  const clicked = await evaluate(client, sessionId, `(() => {
    const visible = (element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 }
    const target = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().includes(${JSON.stringify(text)}) && !button.disabled && visible(button))
    if (!target) return false
    target.click()
    return true
  })()`)
  assert.equal(clicked, true, `Button not found or disabled: ${text}`)
}

async function authenticate(client, sessionId) {
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
  await clickVisibleButton(client, sessionId, vaultMode === 'setup' ? 'Turn on encryption' : 'Unlock')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated dashboard')
  await waitFor(client, sessionId, 'typeof window.__financePlannerAcceptanceState === "function"', 'Connections acceptance fixture bridge')
  await waitFor(client, sessionId, '!document.querySelector(".automatic-analysis, .mobile-connectivity-status, .mobile-install-card, .passkey-enrolment, .platform-action-bar")', 'clean runtime state')
}

async function setViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768, screenWidth: width, screenHeight: height }, sessionId)
  await delay(100)
}

async function ensureConnectionsDestination(client, sessionId, width) {
  if (await evaluate(client, sessionId, 'Boolean(document.querySelector("[data-connections-ready=true]"))')) return
  if (width <= 768) {
    await clickVisibleButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet')
  }
  await clickVisibleButton(client, sessionId, 'Connections')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-connections-ready=true]"))', 'Connections destination')
}

async function capture(client, sessionId, mode, expectedText, width, height, suffix = '') {
  await setViewport(client, sessionId, width, height)
  await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
  await ensureConnectionsDestination(client, sessionId, width)
  await waitFor(client, sessionId, `(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return innerWidth === ${width} && innerHeight === ${height} && Boolean(document.querySelector('[data-connections-ready=true]')) && document.body.innerText.includes(${JSON.stringify(expectedText)})
  })()`, `${mode} at ${width}x${height}`)

  if (suffix === 'final-row') {
    await evaluate(client, sessionId, `(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' })
      const main = document.querySelector('main#main-content')
      if (main) main.scrollTo({ top: main.scrollHeight, left: 0, behavior: 'instant' })
    })()`)
    await delay(200)
  } else {
    await evaluate(client, sessionId, `(() => { window.scrollTo(0, 0); document.querySelector('main#main-content')?.scrollTo(0, 0) })()`)
  }

  const assertions = await evaluate(client, sessionId, `(() => {
    const visible = (element) => { if (!(element instanceof Element)) return false; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 }
    const unobscured = (element) => { if (!element) return false; const rect = element.getBoundingClientRect(); const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)); const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)); const top = document.elementFromPoint(x, y); return Boolean(top && (top === element || element.contains(top))) }
    const root = document.querySelector('[data-connections-ready=true]')
    const current = [...document.querySelectorAll('nav [aria-current="page"]')].filter(visible)
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    const mobileNavigation = [...document.querySelectorAll('nav')].find((nav) => nav.classList.contains('app-mobile-navigation') && visible(nav))
    const bodyText = document.body.innerText
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: Boolean(root),
      language: root?.getAttribute('lang'),
      currentCount: current.length,
      currentDestination: current[0]?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      expectedText: bodyText.includes(${JSON.stringify(expectedText)}),
      dialogOpen: Boolean(dialog),
      focusInsideDialog: !dialog || dialog.contains(document.activeElement),
      mobileNavigationUnobscured: ${width <= 768} ? unobscured(mobileNavigation) : true,
      searchValue: document.querySelector('.connections-search input')?.value || null,
      selectedAccounts: document.querySelectorAll('.connections-account-select-row input:checked').length,
      manualPasswordFields: document.querySelectorAll('.connections-manual-modal input[type=password]').length,
      setupStep: document.querySelector('.connections-step-label')?.textContent?.trim() || null,
      finalScrollReached: ${suffix === 'final-row'} ? ((document.querySelector('main#main-content')?.scrollTop || window.scrollY) > 0) : true,
    }
  })()`)

  assert.deepEqual(assertions.viewport, { width, height })
  assert.equal(assertions.root, true)
  assert.equal(assertions.language, 'en')
  assert.equal(assertions.currentCount, 1)
  assert.match(assertions.currentDestination || '', /Connections|More/)
  assert.equal(assertions.horizontalOverflow, false)
  assert.equal(assertions.expectedText, true)
  assert.equal(assertions.mobileNavigationUnobscured, true)
  assert.equal(assertions.focusInsideDialog, true)
  assert.equal(assertions.manualPasswordFields, 0)
  assert.equal(assertions.finalScrollReached, true)

  const setupModes = new Set(['institution-selector', 'institution-search', 'account-type', 'bank-confirmation', 'paypal-confirmation', 'manual'])
  assert.equal(assertions.dialogOpen, setupModes.has(mode))
  if (mode === 'institution-search') assert.equal(assertions.searchValue, 'bank')
  if (mode === 'sync-selection') assert.equal(assertions.selectedAccounts, 3)
  if (mode === 'institution-selector' || mode === 'institution-search') assert.equal(assertions.setupStep, 'Step 1 of 3')
  if (mode === 'account-type') assert.equal(assertions.setupStep, 'Step 2 of 3')
  if (mode === 'bank-confirmation' || mode === 'paypal-confirmation') assert.equal(assertions.setupStep, 'Step 3 of 3')

  await mkdir(ARTIFACT_DIR, { recursive: true })
  const suffixPart = suffix ? `-${suffix}` : ''
  const path = join(ARTIFACT_DIR, `connections-${mode}-${width}x${height}${suffixPart}.png`)
  const image = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, image.data, 'base64')
  return { mode, path, ...assertions }
}

async function run() {
  const launched = await launchChrome()
  const { client } = launched
  let sessionId
  const browserErrors = []
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), appUrl: APP_URL, browser: launched.executable, screenshots: [], browserErrors }

  try {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    ;({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }))
    await Promise.all([
      client.send('Page.enable', {}, sessionId), client.send('Runtime.enable', {}, sessionId),
      client.send('Network.enable', {}, sessionId), client.send('Log.enable', {}, sessionId),
    ])
    client.on('Runtime.exceptionThrown', (params, eventSession) => {
      if (eventSession === sessionId) browserErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught browser exception')
    })

    await authenticate(client, sessionId)
    for (const [mode, expectedText] of MODES) {
      for (const [width, height] of VIEWPORTS) report.screenshots.push(await capture(client, sessionId, mode, expectedText, width, height))
    }
    for (const mode of ['populated', 'sync-selection', 'attention', 'statement-preview']) {
      const expectedText = MODES.find(([candidate]) => candidate === mode)[1]
      report.screenshots.push(await capture(client, sessionId, mode, expectedText, 390, 844, 'final-row'))
    }

    assert.deepEqual(browserErrors, [], `Uncaught browser errors: ${browserErrors.join(' | ')}`)
    report.passed = true
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Connections production acceptance passed with ${report.screenshots.length} screenshots. Evidence: ${ARTIFACT_PATH}`)
  } catch (error) {
    report.passed = false
    report.failure = error instanceof Error ? error.stack || error.message : String(error)
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    throw error
  } finally {
    client.close()
    launched.process.kill('SIGTERM')
    await Promise.race([new Promise((resolveExit) => launched.process.once('exit', resolveExit)), delay(2_000).then(() => launched.process.kill('SIGKILL'))]).catch(() => {})
    await rm(launched.profile, { recursive: true, force: true })
  }
}

await run()
