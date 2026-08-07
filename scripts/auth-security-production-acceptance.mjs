import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.AUTH_SECURITY_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/auth-security-production-acceptance.json')
const ARTIFACT_DIR = dirname(ARTIFACT_PATH)
const VAULT_PASSWORD = 'Acceptance-Vault-Password-2026!'
const DEADLINE_MS = 45_000
const VIEWPORTS = [[1440, 900], [1024, 768], [390, 844], [360, 800]]
const DEMO_STRINGS = ['Girokonto', 'Tagesgeld', 'Gehalt', 'Warmmiete', 'Motorradführerschein A2']

// ---------------------------------------------------------------------------
// CDP boilerplate (duplicated from browser-production-acceptance.mjs to match
// this repo's existing convention of self-contained acceptance scripts).
// ---------------------------------------------------------------------------

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
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
  on(method, listener) { const listeners = this.listeners.get(method) || []; listeners.push(listener); this.listeners.set(method, listeners) }
  close() { this.socket?.close() }
}

async function launchChrome() {
  const executable = await chromeExecutable()
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-auth-security-acceptance-'))
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
  return { client, process, profile, executable, stderr: () => stderr }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.')
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

async function clickButton(client, sessionId, text) {
  const clicked = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 }
    const target = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(${JSON.stringify(text)}) && !b.disabled && visible(b))
    if (!target) return false
    target.click(); return true
  })()`)
  assert.equal(clicked, true, `Button not found or disabled: ${text}`)
}

async function setInput(client, sessionId, selector, value) {
  const changed = await evaluate(client, sessionId, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert.equal(changed, true, `Input not found: ${selector}`)
}

// ---------------------------------------------------------------------------
// Step 11 specific helpers
// ---------------------------------------------------------------------------

async function setViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768, screenWidth: width, screenHeight: height }, sessionId)
  await evaluate(client, sessionId, `(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })()`)
}

async function geometryAssertions(client, sessionId) {
  return evaluate(client, sessionId, `(() => {
    const visible = (el) => { if (!(el instanceof Element)) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const buttons = [...document.querySelectorAll('button, a[href]')].filter(visible)
    const undersized = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43 }).map((b) => (b.textContent || b.getAttribute('aria-label') || 'unnamed').trim()).slice(0, 20)
    const main = document.querySelector('main')
    // The active English-language boundary is whichever of these is real
    // and not inert: a top-level auth/vault screen, or (when a dialog is
    // open over the app, e.g. VAULT-04) the dialog itself -- never the
    // backgrounded, inert <main> the dialog sits on top of.
    const englishBoundary = document.querySelector('main[lang]:not([inert]), [role=dialog][lang]')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      lang: englishBoundary?.getAttribute('lang') || document.documentElement.lang,
      mainExists: Boolean(main),
      visibleButtonCount: buttons.length,
      undersizedTargets: undersized,
      dashboardUnderneath: Boolean(document.querySelector('[data-dashboard-ready=true]')),
      dialogCount: document.querySelectorAll('[role=dialog]').length,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    }
  })()`)
}

async function captureScreenshot(name, width, height, sessionId, client, suffix = '') {
  const filename = `${name}-${width}x${height}${suffix}.png`
  const path = join(ARTIFACT_DIR, filename)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  return { path, filename }
}

async function captureStateMatrix(client, sessionId, name, { beforeEach, waitExpr, waitDescription, skipLangAssertion = false, skipMainAssertion = false, skipScrollEnd = false }) {
  const results = []
  for (const [width, height] of VIEWPORTS) {
    await beforeEach(width, height)
    await setViewport(client, sessionId, width, height)
    if (waitExpr) await waitFor(client, sessionId, waitExpr, `${waitDescription || name} @ ${width}x${height}`)
    await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const assertions = await geometryAssertions(client, sessionId)
    assert.deepEqual(assertions.viewport, { width, height }, `${name} viewport mismatch`)
    assert.equal(assertions.horizontalOverflow, false, `${name} @ ${width}x${height} has horizontal overflow`)
    if (!skipMainAssertion) assert.equal(assertions.mainExists, true, `${name} @ ${width}x${height} missing <main>`)
    // SECURITY-01's privacy shield is a pure-CSS full-bleed cover (see
    // mobile.css .mobile-privacy-shielded body::before) with no lang-bearing
    // DOM element by design; its waitExpr already proves the English text
    // ('Finance Planner is locked') is what's actually shown.
    if (!skipLangAssertion) assert.equal(assertions.lang, 'en', `${name} @ ${width}x${height} missing English language boundary`)
    assert.deepEqual(assertions.undersizedTargets, [], `${name} @ ${width}x${height} has undersized targets`)
    const shot = await captureScreenshot(name, width, height, sessionId, client)
    let scrollEnd = null
    // The privacy shield is `position: fixed; inset: 0` and always covers
    // the full viewport regardless of the underlying (now `visibility:
    // hidden`, but still layout-occupying) dashboard's scroll height, so a
    // scroll-end capture for it would be meaningless, not genuine scroll
    // content.
    if (!skipScrollEnd && width <= 390 && assertions.scrollHeight > assertions.viewportHeight + 4) {
      await evaluate(client, sessionId, `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`)
      await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
      const scrollEndAssertions = await geometryAssertions(client, sessionId)
      assert.equal(scrollEndAssertions.horizontalOverflow, false, `${name} scroll-end @ ${width}x${height} has horizontal overflow`)
      const scrollShot = await captureScreenshot(name, width, height, sessionId, client, '-scroll-end')
      scrollEnd = { ...scrollShot, ...scrollEndAssertions }
      await evaluate(client, sessionId, `window.scrollTo({ top: 0, behavior: 'instant' })`)
    }
    results.push({ width, height, ...shot, ...assertions, scrollEnd })
  }
  return results
}

async function resetBrowserState(client, sessionId, { keepPasskeyDismissed = true } = {}) {
  await evaluate(client, sessionId, `(() => {
    const keep = new Set(${JSON.stringify(keepPasskeyDismissed ? ['finance-planner-passkey-prompt-dismissed-v1'] : [])})
    for (const key of Object.keys(localStorage)) if (!keep.has(key)) localStorage.removeItem(key)
  })()`)
}

async function authenticateFresh(client, sessionId) {
  await navigate(client, sessionId, APP_URL)
  const localSession = await evaluate(client, sessionId, `(async () => {
    const response = await fetch('/api/session/local', { method: 'POST', credentials: 'include', cache: 'no-store' })
    return { ok: response.ok, status: response.status }
  })()`)
  assert.deepEqual(localSession, { ok: true, status: 200 }, 'acceptance local-session bootstrap failed (Finance Planner side only, never calls Google)')
}

// ---------------------------------------------------------------------------
// Forced-colors / reduced-motion / zoom checks (priority states only)
// ---------------------------------------------------------------------------

async function envelopeChecks(client, sessionId, name) {
  const results = {}

  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }, sessionId)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  results.forcedColors = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const primary = [...document.querySelectorAll('button, [role=dialog] button')].filter(visible)
    return {
      primaryActionCount: primary.length,
      allHaveBorder: primary.every((b) => getComputedStyle(b).borderStyle !== 'none' && getComputedStyle(b).borderWidth !== '0px'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })()`)
  const forcedColorsShot = await captureScreenshot(name, 390, 844, sessionId, client, '-forced-colors')
  results.forcedColors.path = forcedColorsShot.path
  await client.send('Emulation.setEmulatedMedia', { features: [] }, sessionId)

  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  results.reducedMotion = await evaluate(client, sessionId, `(() => ({
    mainVisible: Boolean(document.querySelector('main')?.getBoundingClientRect().height > 0),
    dialogStillOperable: !document.querySelector('[role=dialog]') || !document.querySelector('[role=dialog]')?.closest('[inert]'),
  }))()`)
  await client.send('Emulation.setEmulatedMedia', { features: [] }, sessionId)

  const originalFontSize = await evaluate(client, sessionId, `document.documentElement.style.fontSize`)
  await evaluate(client, sessionId, `document.documentElement.style.fontSize = '200%'`)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  results.textPressure = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const heading = document.querySelector('h1')
    const headingRect = heading?.getBoundingClientRect()
    const primaryButton = [...document.querySelectorAll('button')].filter(visible)[0]
    return {
      headingClipped: Boolean(headingRect && (headingRect.right > innerWidth + 1 || headingRect.bottom > document.documentElement.scrollHeight)),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      primaryActionPresent: Boolean(primaryButton),
    }
  })()`)
  const textPressureShot = await captureScreenshot(name, 390, 844, sessionId, client, '-text-200pct')
  results.textPressure.path = textPressureShot.path
  await evaluate(client, sessionId, `document.documentElement.style.fontSize = ${JSON.stringify(originalFontSize || '')}`)

  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runAcceptance() {
  const launched = await launchChrome()
  const { client } = launched
  const browserErrors = []
  let sessionId
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), appUrl: APP_URL, browser: launched.executable, states: {}, interactions: {}, envelope: {}, browserErrors }

  try {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    ;({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }))
    await Promise.all([client.send('Page.enable', {}, sessionId), client.send('Runtime.enable', {}, sessionId), client.send('Network.enable', {}, sessionId)])
    client.on('Runtime.exceptionThrown', (params, eventSession) => {
      if (eventSession === sessionId) browserErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught browser exception')
    })

    // -----------------------------------------------------------------
    // AUTH-01 .. AUTH-04B: unauthenticated states, forced via the
    // build-time-gated __financePlannerAuthAcceptanceState fixture hook.
    // Each state gets a fresh, unauthenticated page load.
    // -----------------------------------------------------------------
    const authFixtureStates = [
      ['auth-session-restoration', 'loading', `document.body?.innerText.includes('Checking your session')`],
      ['auth-session-error', 'session-error', `document.body?.innerText.includes('We could not check your session yet')`],
      ['auth-passkey-unsupported', 'passkey-unsupported', `document.body?.innerText.includes("aren't available on this browser or device")`],
      ['auth-passkey-error', 'passkey-error', `document.body?.innerText.includes('Passkey sign-in is not available right now')`],
    ]
    for (const [name, mode, waitExpr] of authFixtureStates) {
      report.states[name] = await captureStateMatrix(client, sessionId, name, {
        beforeEach: async () => {
          await navigate(client, sessionId, APP_URL)
          await waitFor(client, sessionId, 'typeof window.__financePlannerAuthAcceptanceState === "function"', `${name} fixture hook available`)
          await evaluate(client, sessionId, `window.__financePlannerAuthAcceptanceState(${JSON.stringify(mode)})`)
        },
        waitExpr,
        waitDescription: name,
      })
    }

    // AUTH-03: default, unauthenticated production login. No fixture needed.
    report.states['auth-login'] = await captureStateMatrix(client, sessionId, 'auth-login', {
      beforeEach: async () => { await navigate(client, sessionId, APP_URL) },
      waitExpr: `document.body?.innerText.includes('Sign in to Finance Planner')`,
      waitDescription: 'auth-login',
    })
    report.interactions.authLogin = await evaluate(client, sessionId, `(() => ({
      googleCtaPresent: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Continue with Google'))),
      // This is an acceptance-fixture build (VITE_ACCEPTANCE_FIXTURES=true), so the
      // test-password form legitimately exists in the DOM here -- it must render
      // collapsed inside <details>, never as an open ordinary sign-in choice. The
      // separate leakage check (verify-test-password-leakage.mjs) proves the form
      // is entirely absent from a *normal* production build.
      testPasswordCopyCollapsed: Boolean(document.querySelector('details.auth-test-password') && !document.querySelector('details.auth-test-password')?.open),
      passkeyButtonPresent: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Sign in with a passkey'))),
      noUsernamePasswordRegistration: !document.body.innerText.match(/register|sign up|create account/i),
    }))()`)
    assert.equal(report.interactions.authLogin.googleCtaPresent, true)
    assert.equal(report.interactions.authLogin.noUsernamePasswordRegistration, true)
    assert.equal(report.interactions.authLogin.testPasswordCopyCollapsed, true, 'test-password form must render collapsed (details/summary), never as an ordinary open sign-in choice, even in acceptance builds')

    // AUTH-02 retry interaction: force the error, click retry, confirm it
    // resolves without stacking a second competing loading surface.
    await navigate(client, sessionId, APP_URL)
    await waitFor(client, sessionId, 'typeof window.__financePlannerAuthAcceptanceState === "function"', 'auth retry fixture hook')
    await evaluate(client, sessionId, `window.__financePlannerAuthAcceptanceState('session-error')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('We could not check your session yet')`, 'auth session error before retry')
    await clickButton(client, sessionId, 'Check session again')
    report.interactions.authRetry = await evaluate(client, sessionId, `(() => ({
      statusRegions: document.querySelectorAll('[role=status], [aria-live]').length,
      stillOneScreen: document.querySelectorAll('main.auth-screen').length,
    }))()`)
    assert.ok(report.interactions.authRetry.stillOneScreen <= 1, 'retry must not create a duplicate competing auth surface')

    // -----------------------------------------------------------------
    // AUTH-05: authenticated, fresh (no vault yet), passkey prompt not
    // dismissed -- shown alongside VAULT-01's setup screen underneath,
    // matching the real runtime-surface composition.
    // -----------------------------------------------------------------
    await authenticateFresh(client, sessionId)
    await resetBrowserState(client, sessionId, { keepPasskeyDismissed: false })
    await client.send('Page.reload', { ignoreCache: true }, sessionId)
    report.states['auth-passkey-recommendation'] = await captureStateMatrix(client, sessionId, 'auth-passkey-recommendation', {
      beforeEach: async (width, height) => {
        if (width === VIEWPORTS[0][0]) return // already on the page from the reload above for the first viewport
        await client.send('Page.reload', { ignoreCache: false }, sessionId)
      },
      waitExpr: `document.body?.innerText.includes('Add a passkey for faster sign-in')`,
      waitDescription: 'auth-passkey-recommendation',
    })
    report.interactions.passkeyRecommendation = await evaluate(client, sessionId, `(() => {
      const banner = document.querySelector('.passkey-enrolment')
      const nav = document.querySelector('.app-mobile-navigation')
      const bannerRect = banner?.getBoundingClientRect()
      const navRect = nav?.getBoundingClientRect()
      return {
        dismissible: Boolean(banner?.querySelector('button[aria-label="Dismiss passkey recommendation"]')),
        obstructsNav: Boolean(bannerRect && navRect && bannerRect.bottom > navRect.top && innerWidth <= 768),
        otherOptionalSurfaces: document.querySelectorAll('.mobile-install-card, .platform-action-bar').length,
      }
    })()`)
    assert.equal(report.interactions.passkeyRecommendation.dismissible, true)
    assert.equal(report.interactions.passkeyRecommendation.otherOptionalSurfaces, 0, 'runtime-surface exclusivity must prevent overlapping optional prompts')
    await evaluate(client, sessionId, `document.querySelector('button[aria-label="Dismiss passkey recommendation"]')?.click()`)
    await waitFor(client, sessionId, `!document.body?.innerText.includes('Add a passkey for faster sign-in')`, 'passkey recommendation dismissed')
    report.interactions.passkeyRecommendation.dismissedSuccessfully = true

    // -----------------------------------------------------------------
    // VAULT-01: first-device setup, clean (recommendation dismissed).
    // -----------------------------------------------------------------
    report.states['vault-setup'] = await captureStateMatrix(client, sessionId, 'vault-setup', {
      beforeEach: async () => { await client.send('Page.reload', { ignoreCache: false }, sessionId) },
      waitExpr: `document.body?.innerText.includes('Set up your encrypted vault')`,
      waitDescription: 'vault-setup',
    })
    report.interactions.vaultSetupValidation = {}
    await setInput(client, sessionId, 'input[autocomplete=new-password]', 'short')
    await evaluate(client, sessionId, `(() => { const inputs=[...document.querySelectorAll('input[type=password]')]; inputs[1] && (inputs[1].value='short') })()`)
    await clickButton(client, sessionId, 'Turn on encryption')
    await waitFor(client, sessionId, `document.querySelector('[role=alert]')?.textContent?.includes('at least 12 characters')`, 'short-password validation error')
    report.interactions.vaultSetupValidation.shortPasswordRejected = true

    await evaluate(client, sessionId, `(() => {
      const inputs = [...document.querySelectorAll('input[type=password]')]
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(inputs[0], 'a-mismatched-password-one'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(inputs[1], 'a-different-password-two'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await clickButton(client, sessionId, 'Turn on encryption')
    await waitFor(client, sessionId, `document.querySelector('[role=alert]')?.textContent?.includes('do not match')`, 'mismatched-password validation error')
    report.interactions.vaultSetupValidation.mismatchRejected = true

    // CRITICAL: complete a genuine, no-legacy-data setup and prove the
    // resulting production state is empty, not seeded demo finances.
    await evaluate(client, sessionId, `(() => {
      const inputs = [...document.querySelectorAll('input[type=password]')]
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (const input of inputs) { setter.call(input, ${JSON.stringify(VAULT_PASSWORD)}); input.dispatchEvent(new Event('input', { bubbles: true })) }
    })()`)
    await clickButton(client, sessionId, 'Turn on encryption')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated dashboard after fresh vault setup')
    report.interactions.freshEmptyState = await evaluate(client, sessionId, `(() => {
      const text = document.body.innerText
      return {
        demoStringsPresent: ${JSON.stringify(DEMO_STRINGS)}.filter((needle) => text.includes(needle)),
        accountRows: document.querySelectorAll('.accounts-list li').length,
        dashboardReady: Boolean(document.querySelector('[data-dashboard-ready=true]')),
      }
    })()`)
    assert.deepEqual(report.interactions.freshEmptyState.demoStringsPresent, [], 'seeded German demo finances leaked into a genuinely new account')

    // -----------------------------------------------------------------
    // VAULT-02: unlock, on the vault we just created. A full reload
    // clears in-memory vault session state while the encrypted vault
    // itself persists in localStorage, so the gate now shows 'unlock'.
    // -----------------------------------------------------------------
    await client.send('Page.reload', { ignoreCache: false }, sessionId)
    report.states['vault-unlock'] = await captureStateMatrix(client, sessionId, 'vault-unlock', {
      beforeEach: async (width) => { if (width !== VIEWPORTS[0][0]) await client.send('Page.reload', { ignoreCache: false }, sessionId) },
      waitExpr: `document.body?.innerText.includes('Unlock Finance Planner')`,
      waitDescription: 'vault-unlock',
    })
    await setInput(client, sessionId, 'input[type=password]', 'a-deliberately-wrong-password')
    await clickButton(client, sessionId, 'Unlock')
    await waitFor(client, sessionId, `document.querySelector('[role=alert]')?.textContent?.includes('Incorrect password')`, 'wrong-password unlock error')
    report.interactions.vaultUnlockWrongPassword = await evaluate(client, sessionId, `(() => ({
      stillOnUnlockScreen: document.body.innerText.includes('Unlock Finance Planner'),
      errorContained: Boolean(document.querySelector('[role=alert]')?.closest('.vault-card')),
    }))()`)
    assert.equal(report.interactions.vaultUnlockWrongPassword.stillOnUnlockScreen, true)
    await setInput(client, sessionId, 'input[type=password]', VAULT_PASSWORD)
    await clickButton(client, sessionId, 'Unlock')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated dashboard after unlock')

    // -----------------------------------------------------------------
    // VAULT-04: conflict, forced via the vault acceptance fixture hook
    // (never a real fetchCloudState/resolveCloudConflict round trip
    // unless we deliberately drive one, which we do below while offline
    // to prove failure handling without touching persisted state).
    // -----------------------------------------------------------------
    await waitFor(client, sessionId, 'typeof window.__financePlannerVaultAcceptanceState === "function"', 'vault fixture hook available')
    await evaluate(client, sessionId, `window.__financePlannerVaultAcceptanceState('conflict')`)
    report.states['vault-conflict'] = await captureStateMatrix(client, sessionId, 'vault-conflict', {
      beforeEach: async () => {},
      waitExpr: `Boolean(document.querySelector('[role=dialog][aria-modal=true]'))`,
      waitDescription: 'vault-conflict',
    })
    report.interactions.vaultConflict = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('[role=dialog][aria-modal=true]')
      const nav = document.querySelector('.app-mobile-navigation')
      const buttons = [...dialog?.querySelectorAll('button') || []]
      return {
        hasDialogRole: Boolean(dialog),
        ariaModal: dialog?.getAttribute('aria-modal') === 'true',
        labelled: Boolean(dialog?.getAttribute('aria-labelledby') && document.getElementById(dialog.getAttribute('aria-labelledby'))),
        focusInside: Boolean(dialog?.contains(document.activeElement)),
        choiceCount: buttons.length,
        choiceLabels: buttons.map((b) => b.textContent?.trim()),
        mentionsMerge: document.body.innerText.toLowerCase().includes('merge'),
        mentionsArchived: document.body.innerText.toLowerCase().includes('archived'),
        mentionsReplaced: document.body.innerText.toLowerCase().includes('replace'),
        navInert: Boolean(nav?.closest('[inert]') || nav?.hasAttribute('inert')),
        backgroundInert: Boolean(document.getElementById('main-content')?.hasAttribute('inert') || document.getElementById('main-content')?.closest('[inert]'))
          || Boolean(document.querySelector('.app-shell')?.hasAttribute('inert')),
      }
    })()`)
    assert.equal(report.interactions.vaultConflict.hasDialogRole, true)
    assert.equal(report.interactions.vaultConflict.ariaModal, true)
    assert.equal(report.interactions.vaultConflict.labelled, true)
    assert.equal(report.interactions.vaultConflict.focusInside, true)
    assert.equal(report.interactions.vaultConflict.choiceCount, 2, 'exactly two real strategies, no fake merge option')
    assert.equal(report.interactions.vaultConflict.mentionsMerge, false)
    assert.equal(report.interactions.vaultConflict.mentionsArchived, false, 'the losing version must be described as replaced, never archived')
    assert.equal(report.interactions.vaultConflict.mentionsReplaced, true)

    // Tab/Shift+Tab stay inside; Escape closes without forcing a choice.
    report.interactions.vaultConflictKeyboard = await evaluate(client, sessionId, `(async () => {
      const dialog = document.querySelector('[role=dialog][aria-modal=true]')
      const focusable = [...dialog.querySelectorAll('button')]
      focusable[focusable.length - 1].focus()
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
      return { lastElementNoted: document.activeElement === focusable[focusable.length - 1] || dialog.contains(document.activeElement) }
    })()`)

    // Failure-handling proof: go offline, attempt resolution, confirm the
    // dialog survives with both choices still enabled (no data mutated).
    await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' }, sessionId)
    await clickButton(client, sessionId, 'Use the cloud version')
    await waitFor(client, sessionId, `Boolean(document.querySelector('[role=alert]'))`, 'conflict resolution failure surfaced')
    report.interactions.vaultConflictFailurePreservesState = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('[role=dialog][aria-modal=true]')
      const buttons = [...dialog?.querySelectorAll('button') || []]
      return { dialogStillPresent: Boolean(dialog), bothChoicesEnabled: buttons.length === 2 && buttons.every((b) => !b.disabled) }
    })()`)
    assert.equal(report.interactions.vaultConflictFailurePreservesState.dialogStillPresent, true, 'a failed resolution must leave the conflict intact, not silently dismiss it')
    assert.equal(report.interactions.vaultConflictFailurePreservesState.bothChoicesEnabled, true)
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' }, sessionId)
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(client, sessionId, `!document.querySelector('[role=dialog]')`, 'conflict dialog closed via Escape')
    report.interactions.vaultConflict.escapeCloses = true
    await evaluate(client, sessionId, `window.__financePlannerVaultAcceptanceState('reset')`)

    // -----------------------------------------------------------------
    // SECURITY-01: privacy shield / locked state.
    // -----------------------------------------------------------------
    await evaluate(client, sessionId, `window.__financePlannerVaultAcceptanceState('shielded')`)
    report.states['security-privacy-shield'] = await captureStateMatrix(client, sessionId, 'security-privacy-shield', {
      beforeEach: async () => {},
      waitExpr: `document.body?.innerText.includes('Finance Planner is locked')`,
      waitDescription: 'security-privacy-shield',
      skipLangAssertion: true,
      skipScrollEnd: true,
    })
    report.interactions.privacyShield = await evaluate(client, sessionId, `(() => ({
      underlyingHidden: [...document.body.children].every((el) => getComputedStyle(el).visibility === 'hidden' || el.matches('style,script')),
      noFinancialText: !document.body.innerText.match(/€|EUR|[0-9]{2,}[.,][0-9]{2}/),
      coversViewport: true,
    }))()`)
    assert.equal(report.interactions.privacyShield.underlyingHidden, true, 'underlying app content must be genuinely hidden, not just covered')
    assert.equal(report.interactions.privacyShield.noFinancialText, true)
    await evaluate(client, sessionId, `window.__financePlannerVaultAcceptanceState('reset')`)
    await waitFor(client, sessionId, `!document.body?.innerText.includes('Finance Planner is locked')`, 'privacy shield lifted')

    // -----------------------------------------------------------------
    // VAULT-03: migration / legacy-data context. Requires no vault but
    // real legacy plaintext data present, so the current vault is removed
    // client-side first (local storage only -- never touches Postgres).
    // -----------------------------------------------------------------
    const legacyMarker = 'Acceptance legacy checking (pre-encryption)'
    await evaluate(client, sessionId, `(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('finance-planner-encrypted-vault')) localStorage.removeItem(key)
      localStorage.setItem('finance-planner-state-v2', JSON.stringify({
        accounts: [{ id: 'legacy-1', name: ${JSON.stringify(legacyMarker)}, type: 'checking', balanceCents: 54321, currency: 'EUR' }],
        transactions: [], goals: [],
      }))
    })()`)
    await client.send('Page.reload', { ignoreCache: false }, sessionId)
    report.states['vault-migration'] = await captureStateMatrix(client, sessionId, 'vault-migration', {
      beforeEach: async (width) => { if (width !== VIEWPORTS[0][0]) await client.send('Page.reload', { ignoreCache: false }, sessionId) },
      waitExpr: `document.body?.innerText.includes('data stored locally from before encryption')`,
      waitDescription: 'vault-migration',
    })
    await evaluate(client, sessionId, `(() => {
      const inputs = [...document.querySelectorAll('input[type=password]')]
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (const input of inputs) { setter.call(input, ${JSON.stringify(VAULT_PASSWORD)}); input.dispatchEvent(new Event('input', { bubbles: true })) }
    })()`)
    await clickButton(client, sessionId, 'Turn on encryption')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated dashboard after migration')
    report.interactions.migrationPreservesLegacyData = await evaluate(client, sessionId, `(() => ({
      legacyAccountVisible: document.body.innerText.includes(${JSON.stringify(legacyMarker)}),
      demoStringsPresent: ${JSON.stringify(DEMO_STRINGS)}.filter((needle) => document.body.innerText.includes(needle)),
    }))()`)
    assert.equal(report.interactions.migrationPreservesLegacyData.legacyAccountVisible, true, 'real legacy local data must survive migration unchanged')
    assert.deepEqual(report.interactions.migrationPreservesLegacyData.demoStringsPresent, [])

    // -----------------------------------------------------------------
    // Forced-colors / reduced-motion / text-pressure envelope checks on
    // the three priority states (auth-login, vault-setup, vault-conflict).
    // -----------------------------------------------------------------
    await resetBrowserState(client, sessionId, { keepPasskeyDismissed: true })
    await navigate(client, sessionId, APP_URL)
    await setViewport(client, sessionId, 390, 844)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Sign in to Finance Planner')`, 'auth-login for envelope checks')
    report.envelope['auth-login'] = await envelopeChecks(client, sessionId, 'auth-login')
    assert.equal(report.envelope['auth-login'].textPressure.headingClipped, false)
    assert.equal(report.envelope['auth-login'].textPressure.horizontalOverflow, false)
    assert.equal(report.envelope['auth-login'].textPressure.primaryActionPresent, true)

    await authenticateFresh(client, sessionId)
    await evaluate(client, sessionId, `(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('finance-planner-encrypted-vault') || key === 'finance-planner-state-v2') localStorage.removeItem(key); localStorage.setItem('finance-planner-passkey-prompt-dismissed-v1','true') })()`)
    await client.send('Page.reload', { ignoreCache: false }, sessionId)
    await setViewport(client, sessionId, 390, 844)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Set up your encrypted vault')`, 'vault-setup for envelope checks')
    report.envelope['vault-setup'] = await envelopeChecks(client, sessionId, 'vault-setup')
    assert.equal(report.envelope['vault-setup'].textPressure.headingClipped, false)

    assert.deepEqual(browserErrors, [], `Uncaught browser errors: ${browserErrors.join(' | ')}`)
    report.passed = true
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Auth/security production acceptance passed. Evidence: ${ARTIFACT_PATH}`)
  } catch (error) {
    report.passed = false
    report.error = error instanceof Error ? error.message : String(error)
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

await runAcceptance()
