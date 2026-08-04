import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.ACCEPTANCE_ARTIFACT_PATH || 'artifacts/browser-production-acceptance.json')
const VAULT_PASSWORD = 'Acceptance-Vault-Password-2026!'
const TRANSACTION_DESCRIPTION = 'Production acceptance coffee'
const DEADLINE_MS = 45_000

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error('A Chromium or Google Chrome executable is required for browser production acceptance.')
}

async function chromeExecutable() {
  const configured = process.env.CHROME_BIN
  if (configured) return firstExecutable([configured])
  const paths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  if (process.platform === 'win32') {
    paths.unshift(
      join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    )
  }
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
    const listeners = this.listeners.get(message.method) || []
    for (const listener of listeners) listener(message.params || {}, message.sessionId)
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

  close() {
    this.socket?.close()
  }
}

async function launchChrome() {
  const executable = await chromeExecutable()
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-acceptance-'))
  const process = spawn(executable, [
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
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let stderr = ''
  process.stderr.on('data', (chunk) => { stderr += String(chunk).slice(-4_000) })
  const activePort = await waitForFile(join(profile, 'DevToolsActivePort'))
  const [port, websocketPath] = activePort.trim().split('\n')
  if (!port || !websocketPath) throw new Error(`Chrome did not publish a DevTools endpoint: ${stderr}`)
  const client = new CdpClient(`ws://127.0.0.1:${port}${websocketPath}`)
  await client.connect()
  return { client, process, profile, executable, stderr: () => stderr }
}

async function evaluate(client, sessionId, expression) {
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

async function navigate(client, sessionId, url) {
  await client.send('Page.navigate', { url }, sessionId)
  await waitFor(client, sessionId, 'document.readyState === "complete"', `page load: ${url}`)
}

async function clickButton(client, sessionId, text) {
  const clicked = await evaluate(client, sessionId, `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const target = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().includes(${JSON.stringify(text)}) && !button.disabled && visible(button))
    if (!target) return false
    target.click()
    return true
  })()`)
  assert.equal(clicked, true, `Button not found or disabled: ${text}`)
}

async function setInput(client, sessionId, selector, value) {
  const changed = await evaluate(client, sessionId, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return false
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
    if (setter) setter.call(input, ${JSON.stringify(value)})
    else input.value = ${JSON.stringify(value)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  assert.equal(changed, true, `Input not found: ${selector}`)
}

async function runAcceptance() {
  const launched = await launchChrome()
  const { client } = launched
  const browserErrors = []
  let sessionId
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    appUrl: APP_URL,
    browser: launched.executable,
    checks: {},
    browserErrors,
  }

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
      if (eventSession === sessionId) browserErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught browser exception')
    })

    await navigate(client, sessionId, APP_URL)
    const localSession = await evaluate(client, sessionId, `(async () => {
      const response = await fetch('/api/session/local', { method: 'POST', credentials: 'include', cache: 'no-store' })
      return { ok: response.ok, status: response.status }
    })()`)
    assert.deepEqual(localSession, { ok: true, status: 200 })
    await client.send('Page.reload', { ignoreCache: true }, sessionId)
    await waitFor(client, sessionId, 'document.body?.innerText.includes("Sicheren Datenspeicher einrichten") || document.body?.innerText.includes("Finance Planner entsperren")', 'vault gate')

    const vaultMode = await evaluate(client, sessionId, 'document.body.innerText.includes("Sicheren Datenspeicher einrichten") ? "setup" : "unlock"')
    const passwordInputs = await evaluate(client, sessionId, 'document.querySelectorAll("input[type=password]").length')
    assert.ok(passwordInputs >= (vaultMode === 'setup' ? 2 : 1))
    await evaluate(client, sessionId, `(() => {
      const inputs = [...document.querySelectorAll('input[type=password]')]
      for (const input of inputs) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, ${JSON.stringify(VAULT_PASSWORD)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return inputs.length
    })()`)
    await clickButton(client, sessionId, vaultMode === 'setup' ? 'Verschlüsselung aktivieren' : 'Entsperren')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated finance dashboard')

    report.checks.serviceWorker = await evaluate(client, sessionId, `(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, ready: false }
      const ready = await Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
      ])
      return { supported: true, ready, controlled: Boolean(navigator.serviceWorker.controller) }
    })()`)
    assert.equal(report.checks.serviceWorker.supported, true)
    assert.equal(report.checks.serviceWorker.ready, true)

    report.checks.desktopAccessibility = await evaluate(client, sessionId, `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      }
      const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(visible)
      const unnamedButtons = [...document.querySelectorAll('button')].filter(visible).filter((button) => !(button.textContent || button.getAttribute('aria-label') || button.getAttribute('title'))?.trim())
      const unlabelledInputs = [...document.querySelectorAll('input, select, textarea')].filter(visible).filter((input) => {
        const id = input.id
        return !input.closest('label') && !input.getAttribute('aria-label') && !(id && document.querySelector('label[for="' + CSS.escape(id) + '"]'))
      })
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
      const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
      return {
        title: document.title,
        language: document.documentElement.lang,
        mainExists: Boolean(document.querySelector('main#main-content')),
        skipLinkExists: Boolean(document.querySelector('a.skip-link[href="#main-content"]')),
        currentNavigationItems: [...document.querySelectorAll('nav [aria-current="page"]')].filter(visible).length,
        visibleControlCount: controls.length,
        unnamedButtons: unnamedButtons.length,
        unlabelledInputs: unlabelledInputs.length,
        duplicateIds,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
    })()`)
    assert.equal(report.checks.desktopAccessibility.mainExists, true)
    assert.equal(report.checks.desktopAccessibility.skipLinkExists, true)
    assert.equal(report.checks.desktopAccessibility.currentNavigationItems, 1)
    assert.equal(report.checks.desktopAccessibility.unnamedButtons, 0)
    assert.equal(report.checks.desktopAccessibility.unlabelledInputs, 0)
    assert.deepEqual(report.checks.desktopAccessibility.duplicateIds, [])
    assert.equal(report.checks.desktopAccessibility.horizontalOverflow, false)

    await clickButton(client, sessionId, 'Add transaction')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[role=dialog][aria-modal=true]"))', 'transaction dialog')
    report.checks.dialog = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('[role=dialog][aria-modal=true]')
      return {
        labelled: Boolean(dialog?.getAttribute('aria-labelledby') && document.getElementById(dialog.getAttribute('aria-labelledby'))),
        focusInside: Boolean(dialog?.contains(document.activeElement)),
      }
    })()`)
    assert.equal(report.checks.dialog.labelled, true)
    assert.equal(report.checks.dialog.focusInside, true)
    await setInput(client, sessionId, 'input[name=description]', TRANSACTION_DESCRIPTION)
    await setInput(client, sessionId, 'input[name=amount]', '4.20')
    await setInput(client, sessionId, 'input[name=category]', 'Acceptance')
    const submitted = await evaluate(client, sessionId, `(() => {
      const form = document.querySelector('[role=dialog]')
      if (!(form instanceof HTMLFormElement)) return false
      form.requestSubmit()
      return true
    })()`)
    assert.equal(submitted, true)
    await waitFor(client, sessionId, `document.body?.innerText.includes(${JSON.stringify(TRANSACTION_DESCRIPTION)})`, 'new transaction')

    await clickButton(client, sessionId, 'Add transaction')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[role=dialog]"))', 'second transaction dialog')
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(client, sessionId, '!document.querySelector("[role=dialog]")', 'Escape closing transaction dialog')
    report.checks.transactionCrud = { created: true, escapeClosesDialog: true }

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    }, sessionId)
    await delay(250)
    report.checks.mobile = await evaluate(client, sessionId, `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      }
      const buttons = [...document.querySelectorAll('button')].filter(visible)
      const undersized = buttons.filter((button) => button.getBoundingClientRect().height < 43).map((button) => (button.textContent || button.getAttribute('aria-label') || 'unnamed').trim()).slice(0, 20)
      return {
        width: innerWidth,
        height: innerHeight,
        currentNavigationItems: [...document.querySelectorAll('nav [aria-current="page"]')].filter(visible).length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        visibleButtons: buttons.length,
        undersized,
        standaloneMediaSupported: matchMedia('(display-mode: standalone)').media.length > 0,
      }
    })()`)
    assert.equal(report.checks.mobile.width, 390)
    assert.equal(report.checks.mobile.currentNavigationItems, 1)
    assert.equal(report.checks.mobile.horizontalOverflow, false)
    assert.deepEqual(report.checks.mobile.undersized, [])

    report.checks.manifest = await evaluate(client, sessionId, `(async () => {
      const response = await fetch('/manifest.webmanifest', { cache: 'no-store' })
      const manifest = await response.json()
      return {
        ok: response.ok,
        id: manifest.id,
        startUrl: manifest.start_url,
        display: manifest.display,
        iconCount: Array.isArray(manifest.icons) ? manifest.icons.length : 0,
        shortcutCount: Array.isArray(manifest.shortcuts) ? manifest.shortcuts.length : 0,
      }
    })()`)
    assert.equal(report.checks.manifest.ok, true)
    assert.equal(report.checks.manifest.id, '/')
    assert.equal(report.checks.manifest.display, 'standalone')
    assert.ok(report.checks.manifest.iconCount >= 2)

    await clickButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet')
    await clickButton(client, sessionId, 'Data and Backup')
    await waitFor(client, sessionId, 'document.body?.innerText.includes("Konto und sämtliche Serverdaten löschen")', 'account deletion controls')
    report.checks.accountDeletion = await evaluate(client, sessionId, `(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Konto endgültig löschen'))
      const input = [...document.querySelectorAll('input')].find((item) => item.closest('label')?.textContent?.includes('DELETE MY ACCOUNT'))
      return { present: Boolean(button && input), initiallyDisabled: Boolean(button?.disabled) }
    })()`)
    assert.deepEqual(report.checks.accountDeletion, { present: true, initiallyDisabled: true })
    const deletionInputSelector = `.account-deletion-controls input`
    await setInput(client, sessionId, deletionInputSelector, 'DELETE MY ACCOUNT')
    report.checks.accountDeletion.enabledAfterExactConfirmation = await evaluate(client, sessionId, `!document.querySelector('.danger-action')?.disabled`)
    assert.equal(report.checks.accountDeletion.enabledAfterExactConfirmation, true)

    await clickButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet for Finance Assistant')
    await clickButton(client, sessionId, 'Finance Assistant')
    await waitFor(client, sessionId, 'document.body?.innerText.includes("Lernender Monatsbudgetplan")', 'learning budget assistant')
    report.checks.smartBudget = await evaluate(client, sessionId, `(() => ({
      persistentLearning: document.body.innerText.includes('Persistentes Verhaltenslernen'),
      explicitLearningConsent: [...document.querySelectorAll('label')].some((label) => label.textContent?.includes('persönliches Lernprofil')),
      explicitHostedConsent: [...document.querySelectorAll('label')].some((label) => label.textContent?.includes('Hugging-Face-Modell')),
      explicitLocationConsent: [...document.querySelectorAll('label')].some((label) => label.textContent?.includes('IP-Adresse')),
    }))()`)
    assert.deepEqual(report.checks.smartBudget, {
      persistentLearning: true,
      explicitLearningConsent: true,
      explicitHostedConsent: true,
      explicitLocationConsent: true,
    })

    await client.send('Emulation.clearDeviceMetricsOverride', {}, sessionId)
    await client.send('Page.reload', { ignoreCache: false }, sessionId)
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'online reload before offline test')
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none',
    }, sessionId)
    await client.send('Page.reload', { ignoreCache: false }, sessionId)
    await waitFor(client, sessionId, 'document.readyState === "complete" && Boolean(document.querySelector("#root")?.children.length)', 'offline application shell', 20_000)
    report.checks.offline = await evaluate(client, sessionId, `(() => ({
      rootRendered: Boolean(document.querySelector('#root')?.children.length),
      shellLoaded: Boolean(document.querySelector('main') || document.querySelector('.app-shell')),
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    }))()`)
    assert.equal(report.checks.offline.rootRendered, true)
    assert.equal(report.checks.offline.shellLoaded, true)
    assert.equal(report.checks.offline.serviceWorkerControlled, true)
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'wifi',
    }, sessionId)

    assert.deepEqual(browserErrors, [], `Uncaught browser errors: ${browserErrors.join(' | ')}`)
    report.passed = true
    await mkdir(resolve(ARTIFACT_PATH, '..'), { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Browser production acceptance passed. Evidence: ${ARTIFACT_PATH}`)
  } catch (error) {
    report.passed = false
    report.failure = error instanceof Error ? error.stack || error.message : String(error)
    await mkdir(resolve(ARTIFACT_PATH, '..'), { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    throw error
  } finally {
    client.close()
    launched.process.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => launched.process.once('exit', resolveExit)),
      delay(2_000).then(() => launched.process.kill('SIGKILL')),
    ]).catch(() => {})
    await rm(launched.profile, { recursive: true, force: true })
  }
}

await runAcceptance()
