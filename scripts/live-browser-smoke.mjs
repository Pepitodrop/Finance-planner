import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.LIVE_APP_URL || 'https://finance.luisbenedikt.de'
const OUTPUT_PATH = resolve(process.env.LIVE_BROWSER_ARTIFACT || 'artifacts/live-browser-smoke.json')
const SCREENSHOT_PATH = resolve(process.env.LIVE_BROWSER_SCREENSHOT || 'artifacts/live-browser-mobile.png')
const DEADLINE_MS = Math.max(10_000, Math.min(90_000, Number(process.env.LIVE_BROWSER_TIMEOUT_MS || 45_000)))

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
  }
  throw new Error('A Chromium or Google Chrome executable is required.')
}

async function chromeExecutable() {
  return firstExecutable([
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ])
}

async function waitForFile(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8')) } catch { await delay(100) }
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
        for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed.'))
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
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-live-browser-'))
  const child = spawn(executable, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000) })
  const activePort = await waitForFile(join(profile, 'DevToolsActivePort'))
  const [port, websocketPath] = activePort.trim().split('\n')
  if (!port || !websocketPath) throw new Error(`Chrome did not publish a DevTools endpoint: ${stderr}`)
  const client = new CdpClient(`ws://127.0.0.1:${port}${websocketPath}`)
  await client.connect()
  return { client, child, profile, executable, stderr: () => stderr }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.')
  return result.result?.value
}

async function waitFor(client, sessionId, expression, description, timeoutMs = DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(client, sessionId, expression)
      if (lastValue) return lastValue
    } catch {}
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`)
}

function summarizedArgs(args = []) {
  return args.map((argument) => argument.value ?? argument.description ?? argument.type).join(' ').slice(0, 500)
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  appUrl: APP_URL,
  browser: null,
  checks: {},
  consoleErrors: [],
  runtimeExceptions: [],
  networkFailures: [],
  failedResponses: [],
  failures: [],
}

function record(name, passed, details = {}) {
  report.checks[name] = { passed, ...details }
  if (!passed) report.failures.push(name)
}

async function run() {
  const launched = await launchChrome()
  report.browser = launched.executable
  const { client } = launched
  let sessionId
  try {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    ;({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }))
    await Promise.all([
      client.send('Page.enable', {}, sessionId),
      client.send('Runtime.enable', {}, sessionId),
      client.send('Network.enable', {}, sessionId),
      client.send('Log.enable', {}, sessionId),
    ])

    client.on('Runtime.exceptionThrown', (params, eventSession) => {
      if (eventSession !== sessionId) return
      report.runtimeExceptions.push((params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught exception').slice(0, 1_000))
    })
    client.on('Runtime.consoleAPICalled', (params, eventSession) => {
      if (eventSession === sessionId && ['error', 'assert'].includes(params.type)) report.consoleErrors.push(summarizedArgs(params.args))
    })
    client.on('Log.entryAdded', (params, eventSession) => {
      if (eventSession === sessionId && ['error'].includes(params.entry?.level)) report.consoleErrors.push(String(params.entry?.text || 'Browser log error').slice(0, 1_000))
    })
    client.on('Network.loadingFailed', (params, eventSession) => {
      if (eventSession === sessionId && !params.canceled) report.networkFailures.push({ requestId: params.requestId, errorText: params.errorText, blockedReason: params.blockedReason })
    })
    client.on('Network.responseReceived', (params, eventSession) => {
      if (eventSession !== sessionId) return
      const { response } = params
      if (response.status >= 400 && !/favicon\.ico(?:$|\?)/.test(response.url)) report.failedResponses.push({ status: response.status, url: response.url.slice(0, 500) })
    })

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 900,
    }, sessionId)
    await client.send('Page.navigate', { url: APP_URL }, sessionId)
    await waitFor(client, sessionId, 'document.readyState === "complete"', 'desktop page load')
    await waitFor(client, sessionId, 'document.body && document.body.innerText.trim().length > 20', 'visible application content')
    await delay(1_000)

    const desktop = await evaluate(client, sessionId, `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      }
      const labelled = (element) => {
        if ((element.textContent || '').trim()) return true
        if ((element.getAttribute('aria-label') || '').trim()) return true
        if ((element.getAttribute('title') || '').trim()) return true
        const id = element.id
        return Boolean(id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || Boolean(element.closest('label'))
      }
      const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(visible)
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
      return {
        title: document.title,
        language: document.documentElement.lang,
        bodyText: document.body.innerText.slice(0, 600),
        headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        h1Count: document.querySelectorAll('h1').length,
        landmarkMain: document.querySelectorAll('main').length,
        visibleControlCount: controls.length,
        unnamedControls: controls.filter((control) => !labelled(control)).map((control) => control.outerHTML.slice(0, 180)),
        duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        activeElement: document.activeElement?.tagName,
      }
    })()`)
    record('desktopLayout', !desktop.horizontalOverflow && desktop.visibleControlCount > 0, desktop)
    record('basicAccessibility', desktop.h1Count <= 1 && desktop.headingCount > 0 && desktop.unnamedControls.length === 0 && desktop.duplicateIds.length === 0, desktop)

    const performance = await evaluate(client, sessionId, `(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const resources = performance.getEntriesByType('resource')
      return {
        domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
        loadEventMs: Math.round(navigation?.loadEventEnd || 0),
        transferSize: Math.round((navigation?.transferSize || 0) + resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0)),
        decodedBodySize: Math.round((navigation?.decodedBodySize || 0) + resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0)),
        resourceCount: resources.length,
      }
    })()`)
    record('navigationPerformance', performance.loadEventMs > 0 && performance.loadEventMs < 15_000, performance)

    const serviceWorker = await evaluate(client, sessionId, `(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, ready: false, controlled: false }
      const ready = await Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
      ])
      return { supported: true, ready, controlled: Boolean(navigator.serviceWorker.controller), registrations: (await navigator.serviceWorker.getRegistrations()).length }
    })()`)
    record('serviceWorker', serviceWorker.supported && serviceWorker.ready, serviceWorker)

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 800,
      deviceScaleFactor: 3,
      mobile: true,
      screenWidth: 360,
      screenHeight: 800,
    }, sessionId)
    await delay(500)
    const mobile = await evaluate(client, sessionId, `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      }
      const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(visible)
      return {
        width: innerWidth,
        height: innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        documentWidth: document.documentElement.scrollWidth,
        undersizedControls: controls.filter((control) => {
          const rect = control.getBoundingClientRect()
          return rect.width < 40 || rect.height < 40
        }).map((control) => (control.textContent || control.getAttribute('aria-label') || control.tagName).trim()).slice(0, 30),
        clippedControls: controls.filter((control) => {
          const rect = control.getBoundingClientRect()
          return rect.left < -1 || rect.right > innerWidth + 1
        }).map((control) => (control.textContent || control.getAttribute('aria-label') || control.tagName).trim()).slice(0, 30),
      }
    })()`)
    record('mobile360Layout', mobile.width === 360 && !mobile.horizontalOverflow && mobile.clippedControls.length === 0, mobile)
    record('mobileTouchTargets', mobile.undersizedControls.length === 0, mobile)

    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }, sessionId)
    await delay(300)
    const zoom = await evaluate(client, sessionId, `({
      visualViewportWidth: Math.round(visualViewport?.width || innerWidth),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyVisible: document.body.getBoundingClientRect().height > 0,
    })`)
    record('zoom200Percent', zoom.bodyVisible, zoom)

    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
    await mkdir(dirname(SCREENSHOT_PATH), { recursive: true })
    await writeFile(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'))

    record('runtimeExceptions', report.runtimeExceptions.length === 0, { errors: report.runtimeExceptions })
    record('consoleErrors', report.consoleErrors.length === 0, { errors: [...new Set(report.consoleErrors)] })
    record('networkFailures', report.networkFailures.length === 0, { failures: report.networkFailures })
    record('failedResponses', report.failedResponses.length === 0, { responses: report.failedResponses })
  } finally {
    client.close()
    launched.child.kill('SIGTERM')
    await Promise.race([new Promise((resolveExit) => launched.child.once('exit', resolveExit)), delay(2_000)])
    if (launched.child.exitCode === null) launched.child.kill('SIGKILL')
    await rm(launched.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

try {
  await run()
} catch (error) {
  report.failures.push('browserSmokeExecution')
  report.checks.browserSmokeExecution = { passed: false, error: String(error?.stack || error) }
}

await mkdir(dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ appUrl: APP_URL, passed: report.failures.length === 0, failures: report.failures }))
assert.equal(report.failures.length, 0, `Live browser smoke failures: ${report.failures.join(', ')}`)
