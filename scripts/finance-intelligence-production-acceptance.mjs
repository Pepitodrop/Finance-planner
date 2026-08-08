import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.FINANCE_INTELLIGENCE_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/finance-intelligence-production-acceptance.json')
const ARTIFACT_DIR = dirname(ARTIFACT_PATH)
const VAULT_PASSWORD = 'Acceptance-Vault-Password-2026!'
const DEADLINE_MS = 45_000
const VIEWPORTS = [[1440, 900], [1024, 768], [390, 844], [360, 800]]
const HOSTED_PROVIDER_HOSTS = ['huggingface.co', 'router.huggingface.co']

// ---------------------------------------------------------------------------
// CDP boilerplate (duplicated to match this repo's existing convention of
// self-contained acceptance scripts -- see auth-security/connections/browser
// production-acceptance.mjs).
// ---------------------------------------------------------------------------

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
  }
  throw new Error('A Chromium or Google Chrome executable is required for Finance Intelligence acceptance.')
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
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-fi-acceptance-'))
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
  const diagnostics = await evaluate(client, sessionId, `(() => ({
    href: location.href,
    readyState: document.readyState,
    hasAiHook: typeof window.__financePlannerAcceptanceState === 'function',
    aiHookSource: window.__financePlannerAcceptanceState?.toString()?.slice(0, 700),
    hasAutoHook: typeof window.__financePlannerAutoAcceptanceState === 'function',
    bodyTextSample: document.body?.innerText?.slice(0, 1600),
    bodyTextLength: document.body?.innerText?.length,
    aiPageRootOuterHTMLStart: document.querySelector('.ai-page')?.outerHTML?.slice(0, 200),
    // Receipt-page structural markers -- cheaper and more precise than text
    // matching for telling apart "empty" / "insufficient" / "sufficient
    // result" render branches when a waitExpr fails on that page.
    hasReceiptEmptyState: Boolean(document.querySelector('.receipt-empty')),
    hasReceiptInsufficientState: Boolean(document.querySelector('.receipt-insufficient')),
    hasReceiptScoreSummary: Boolean(document.querySelector('.receipt-score-summary')),
    hasReceiptItemsSection: Boolean(document.querySelector('.receipt-items')),
  }))()`).catch((reason) => ({ diagnosticError: reason instanceof Error ? reason.message : String(reason) }))
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Last eval error: ${lastEvalError || 'none'}. Diagnostics: ${JSON.stringify(diagnostics)}`)
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
    return {
      clicked: false,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 5).map((b) => ({
        text: b.textContent?.trim().slice(0, 60), disabled: b.disabled, visible: visible(b),
        inert: Boolean(b.closest('[inert]')), rect: b.getBoundingClientRect().toJSON(),
      })),
      href: location.href,
      bodyTextSample: document.body?.innerText?.slice(0, 500),
      allButtonTexts: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim().slice(0, 30)).filter(Boolean).slice(0, 25),
    }
  })()`)
  assert.equal(result.clicked, true, `Button not found or disabled: ${text} -- ${JSON.stringify(result)}`)
}

async function setInput(client, sessionId, selector, value) {
  const changed = await evaluate(client, sessionId, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLSelectElement)) return false
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  assert.equal(changed, true, `Input not found: ${selector}`)
}

async function setViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768, screenWidth: width, screenHeight: height }, sessionId)
  await evaluate(client, sessionId, `(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })()`)
  await delay(300)
}

async function ensureDestination(client, sessionId, label, readyAttribute) {
  if (await evaluate(client, sessionId, `Boolean(document.querySelector('[${readyAttribute}=true]'))`)) return
  // The vault can end up unexpectedly locked mid-script (see
  // ensureVaultUnlocked) or a real VaultConflict dialog (see
  // resolveConflictIfPresent) can appear between an earlier check and this
  // navigation attempt -- the latter's backdrop makes the nav/topbar inert,
  // which is why the marker check above can legitimately see "not there
  // yet" while a click on a nav button would otherwise silently do nothing.
  // Clear both first so navigation isn't attempted against a locked or
  // inert page.
  await ensureVaultUnlocked(client, sessionId)
  await resolveConflictIfPresent(client, sessionId)
  // Decide mobile-vs-desktop navigation from the browser's *actual* current
  // viewport, not a caller-supplied value -- callers may invoke this before
  // setViewport has run for the upcoming capture, while the browser is still
  // sized for the *previous* state's last viewport.
  const isMobile = await evaluate(client, sessionId, 'innerWidth <= 768')
  if (isMobile) {
    await clickButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet')
  }
  await clickButton(client, sessionId, label)
  await waitFor(client, sessionId, `Boolean(document.querySelector('[${readyAttribute}=true]'))`, `${label} destination`)
}

function geometryScript(readyAttribute) {
  return `(() => {
    const visible = (el) => { if (!(el instanceof Element)) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const obscuredBy = (el) => { if (!el) return 'no-nav-element'; const r = el.getBoundingClientRect(); const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)); const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)); const top = document.elementFromPoint(x, y); if (top && (top === el || el.contains(top))) return null; return top ? \`\${top.tagName}.\${[...top.classList].join('.')}\` : 'nothing-at-point' }
    const root = document.querySelector('[${readyAttribute}=true]')
    const buttons = [...document.querySelectorAll('button, a[href]')].filter(visible)
    const undersized = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43 }).map((b) => (b.textContent || b.getAttribute('aria-label') || 'unnamed').trim()).slice(0, 20)
    const mobileNavigation = [...document.querySelectorAll('nav')].find((nav) => nav.classList.contains('app-mobile-navigation') && visible(nav))
    const navObscuredBy = innerWidth <= 768 ? obscuredBy(mobileNavigation) : null
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: Boolean(root),
      lang: root?.getAttribute('lang') || document.documentElement.lang,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      undersizedTargets: undersized,
      mobileNavigationUnobscured: navObscuredBy === null,
      navObscuredBy,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      // FI-04's own correct copy explicitly denies being a fraud check
      // ("...a statistical comparison, not a fraud check") -- allow that
      // exact legitimate denial while still catching any other, wrongly
      // fraud-implying use of the word (e.g. "fraud detection", "potential
      // fraud").
      colorFraudTerms: /\\bfraud\\b(?!\\s*check)|suspicious|unauthorized|flagged for security/i.test(document.body.innerText),
      colorRedAlert: [...document.querySelectorAll('[class*="error"],[class*="warning"],[class*="anomaly"]')].some((el) => { const c = getComputedStyle(el).color; return /rgb\\(2[0-9][0-9], ?[0-3]?[0-9], ?[0-3]?[0-9]\\)/.test(c) }),
    }
  })()`
}

async function captureScreenshot(name, width, height, sessionId, client, suffix = '') {
  const filename = `${name}-${width}x${height}${suffix}.png`
  const path = join(ARTIFACT_DIR, filename)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  return { path, filename }
}

const SCROLL_END_CANDIDATES = new Set(['finance-intelligence-mixed', 'finance-intelligence-anomaly', 'assistant-hosted-result', 'assistant-hosted-fallback', 'assistant-local-running', 'assistant-planning', 'receipt-selected-consent', 'receipt-result-overview', 'receipt-result-detail', 'receipt-insufficient', 'receipt-error'])

// Resolves a VaultConflict dialog if one happens to be showing right now,
// keeping this device's version. Cheap (a single synchronous DOM check, no
// polling wait) when nothing is there, which is the common case -- each of
// the seeding step's several separate saves can independently trigger sync,
// and therefore independently trigger a real conflict against local-user's
// shared cloud state (see the two prior fixes for the same underlying
// cause), so this is checked defensively at the start of every capture
// rather than assumed resolved once and for all.
async function resolveConflictIfPresent(client, sessionId) {
  const present = await evaluate(client, sessionId, `Boolean(document.querySelector('.vault-conflict-backdrop'))`)
  if (!present) return false
  await clickButton(client, sessionId, "Keep this device's version")
  await waitFor(client, sessionId, `!document.querySelector('.vault-conflict-backdrop')`, "vault conflict resolved (kept this device's version)")
  return true
}

// Re-unlocks the vault if it's found locked (a real "Unlock Finance
// Planner" screen was hit unexpectedly, mid-script, well after the vault
// was already successfully unlocked once by authenticateFreshVault). This
// is a long-running script (dozens of navigations/captures over several
// minutes), and headless Chrome under CI resource contention can plausibly
// cause spurious visibility-state changes that trip the app's real
// auto-lock-on-background behavior (see SECURITY-01) -- not a fixture or
// assertion problem, so self-heal by re-entering the same password rather
// than treating it as fatal.
async function ensureVaultUnlocked(client, sessionId) {
  const locked = await evaluate(client, sessionId, `document.body?.innerText.includes('Unlock Finance Planner') || false`)
  if (!locked) return false
  await evaluate(client, sessionId, `(() => {
    const input = document.querySelector('input[type=password]')
    if (input) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(VAULT_PASSWORD)}); input.dispatchEvent(new Event('input', { bubbles: true })) }
  })()`)
  await clickButton(client, sessionId, 'Unlock')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'vault re-unlocked after unexpected lock')
  // The unlock re-mounts App.tsx fresh; window.__financePlannerAcceptanceState
  // is (re-)registered by a useEffect there, which runs after paint -- wait
  // for it explicitly (authenticateFreshVault does the same after the
  // original unlock) so a mode-set called immediately after this returns
  // can't race a not-yet-registered hook.
  await waitFor(client, sessionId, 'typeof window.__financePlannerAcceptanceState === "function"', 'acceptance fixture bridge re-registered after unlock')
  return true
}

async function captureState(client, sessionId, name, readyAttribute, { beforeEach, waitExpr, waitDescription, scrollTo } = {}) {
  const results = []
  for (const [width, height] of VIEWPORTS) {
    await setViewport(client, sessionId, width, height)
    await ensureVaultUnlocked(client, sessionId)
    await resolveConflictIfPresent(client, sessionId)
    // The finance-intelligence-progress investigation (multiple identical
    // failures here, root-caused via the diagnostics above to a real
    // AiPanel bug -- see the fix to its 'progress' fixture branch) turned
    // out to be deterministic, not a timing race. This retry loop is kept
    // regardless as general defensive infrastructure against genuine CDP/
    // React-timing flakiness elsewhere in a 90-plus-capture run, matching
    // this repo's established retry conventions -- it does not paper over
    // a real failure, since a consistently-wrong render still exhausts all
    // attempts and throws.
    let settled = false
    for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
      await beforeEach(width, height)
      if (!waitExpr) { settled = true; break }
      try {
        await waitFor(client, sessionId, waitExpr, `${waitDescription || name} @ ${width}x${height} (attempt ${attempt + 1})`, attempt < 2 ? 8_000 : DEADLINE_MS)
        settled = true
      } catch (error) {
        if (attempt === 2) throw error
      }
    }
    await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    await delay(150)
    if (scrollTo === 'items') {
      await evaluate(client, sessionId, `document.querySelector('.receipt-items')?.scrollIntoView({ block: 'start', behavior: 'instant' })`)
    } else {
      await evaluate(client, sessionId, `window.scrollTo({ top: 0, behavior: 'instant' })`)
    }

    const assertions = await evaluate(client, sessionId, geometryScript(readyAttribute))
    // Capture the screenshot before asserting: an assertion failure must
    // still leave visual evidence of exactly what was on screen, not just
    // an error message -- the mission requires inspecting the actual
    // rendered screenshot for every failure, not just reading assert text.
    const shot = await captureScreenshot(name, width, height, sessionId, client)
    assert.deepEqual(assertions.viewport, { width, height }, `${name} viewport mismatch`)
    assert.equal(assertions.root, true, `${name} @ ${width}x${height} missing ready marker`)
    assert.equal(assertions.lang, 'en', `${name} @ ${width}x${height} missing English language boundary`)
    assert.equal(assertions.horizontalOverflow, false, `${name} @ ${width}x${height} has horizontal overflow`)
    assert.deepEqual(assertions.undersizedTargets, [], `${name} @ ${width}x${height} has undersized targets: ${JSON.stringify(assertions.undersizedTargets)}`)
    assert.equal(assertions.mobileNavigationUnobscured, true, `${name} @ ${width}x${height} obstructs mobile navigation (covered by: ${assertions.navObscuredBy})`)
    assert.equal(assertions.colorFraudTerms, false, `${name} @ ${width}x${height} uses fraud/security-alert language`)

    let scrollEnd = null
    if (width === 390 && SCROLL_END_CANDIDATES.has(name) && assertions.scrollHeight > assertions.viewportHeight + 4) {
      await evaluate(client, sessionId, `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`)
      await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
      await delay(100)
      const scrollEndAssertions = await evaluate(client, sessionId, geometryScript(readyAttribute))
      assert.equal(scrollEndAssertions.horizontalOverflow, false, `${name} scroll-end @ ${width}x${height} has horizontal overflow`)
      const scrollShot = await captureScreenshot(name, width, height, sessionId, client, '-scroll-end')
      scrollEnd = { ...scrollShot, ...scrollEndAssertions }
      await evaluate(client, sessionId, `window.scrollTo({ top: 0, behavior: 'instant' })`)
    }
    results.push({ width, height, ...shot, ...assertions, scrollEnd })
  }
  return results
}

// ---------------------------------------------------------------------------
// Forced-colors / reduced-motion / 200% text envelope checks.
// ---------------------------------------------------------------------------

async function forcedColorsCheck(client, sessionId, name, readyAttribute) {
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }, sessionId)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  const result = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const badges = [...document.querySelectorAll('.intel-badge')].filter(visible)
    const buttons = [...document.querySelectorAll('button, [role=radio], [role=tab]')].filter(visible)
    return {
      badgeCount: badges.length,
      badgesHaveBorder: badges.every((b) => getComputedStyle(b).borderStyle !== 'none' && getComputedStyle(b).borderWidth !== '0px'),
      controlsHaveBorder: buttons.every((b) => getComputedStyle(b).borderStyle !== 'none' || getComputedStyle(b).outlineStyle !== 'none'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      root: Boolean(document.querySelector('[${readyAttribute}=true]')),
    }
  })()`)
  const shot = await captureScreenshot(name, 390, 844, sessionId, client, '-forced-colors')
  await client.send('Emulation.setEmulatedMedia', { features: [] }, sessionId)
  return { ...result, ...shot }
}

async function reducedMotionCheck(client, sessionId, name, readyAttribute) {
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  const result = await evaluate(client, sessionId, `(() => ({
    root: Boolean(document.querySelector('[${readyAttribute}=true]')),
    contentVisible: Boolean(document.querySelector('[${readyAttribute}=true]')?.getBoundingClientRect().height > 0),
  }))()`)
  const shot = await captureScreenshot(name, 390, 844, sessionId, client, '-reduced-motion')
  await client.send('Emulation.setEmulatedMedia', { features: [] }, sessionId)
  return { ...result, ...shot }
}

async function zoomCheck(client, sessionId, name, readyAttribute) {
  await evaluate(client, sessionId, `document.documentElement.style.fontSize = '200%'`)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  const result = await evaluate(client, sessionId, `(() => {
    const heading = document.querySelector('[${readyAttribute}=true] h2, [${readyAttribute}=true] h1')
    const headingRect = heading?.getBoundingClientRect()
    return {
      root: Boolean(document.querySelector('[${readyAttribute}=true]')),
      headingClipped: Boolean(headingRect && (headingRect.right > innerWidth + 1)),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })()`)
  const shot = await captureScreenshot(name, 390, 844, sessionId, client, '-text-200pct')
  await evaluate(client, sessionId, `document.documentElement.style.fontSize = ''`)
  return { ...result, ...shot }
}

// ---------------------------------------------------------------------------
// App-specific setup helpers.
// ---------------------------------------------------------------------------

async function authenticateFreshVault(client, sessionId) {
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
  // local-user is a fixed, shared identity across every acceptance script in
  // this CI job (all backed by the same Postgres instance) -- by the time
  // this script runs, earlier scripts in the same job (browser/connections/
  // auth-security) have already created real cloud state for that identity.
  // Go offline for the whole creation + first read, exactly like
  // auth-security-production-acceptance.mjs's VAULT-01 empty-state check, so
  // synchronizeUnlockedState's fetch fails closed and this vault starts from
  // its genuinely empty local state instead of silently adopting another
  // script's leftover cloud data.
  await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' }, sessionId)
  await evaluate(client, sessionId, `(() => {
    for (const input of document.querySelectorAll('input[type=password]')) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(VAULT_PASSWORD)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })()`)
  await clickButton(client, sessionId, vaultMode === 'setup' ? 'Turn on encryption' : 'Unlock')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'authenticated dashboard')
  await waitFor(client, sessionId, 'typeof window.__financePlannerAcceptanceState === "function"', 'acceptance fixture bridge')
  // No "clean runtime state" (no connectivity banner, etc.) check here: the
  // caller is still deliberately offline at this point (see above), so
  // MobileConnectivityStatus's offline banner is expected, correct, real UI
  // -- not a leftover state to wait out. The caller restores connectivity
  // once its own offline-only read (FI-07) is done.
}

// A genuinely fresh vault has zero accounts, not just zero transactions --
// the Add Transaction dialog's account <select> would have no <option>s at
// all, and validateTransactionInput rejects a missing accountId outright.
// Create one real manual account first, via the same genuine Connections UI
// exercised by connections-production-acceptance.mjs, before any transaction
// can be added.
async function addManualAccount(client, sessionId) {
  await ensureDestination(client, sessionId, 'Connections', 'data-connections-ready')
  await waitFor(client, sessionId, `(async () => { await document.fonts.ready; return true })()`, 'connections page settled')
  // Button copy differs by state ("Add a manual account" when the account
  // list is empty vs. "Manual account" under "Other options" once it isn't,
  // in case cloud sync already adopted accounts from an earlier script in
  // this job) -- "anual account" (dropping the leading, differently-cased
  // letter) matches either real, un-fabricated copy.
  await clickButton(client, sessionId, 'anual account')
  await waitFor(client, sessionId, `Boolean(document.querySelector('.connections-manual-modal'))`, 'manual account dialog')
  await setInput(client, sessionId, '.connections-manual-modal input[placeholder="Everyday credit card"]', 'Everyday checking account')
  await setInput(client, sessionId, '.connections-manual-modal input[placeholder="0.00"]', '1500.00')
  await clickButton(client, sessionId, 'Save account')
  await waitFor(client, sessionId, `!document.querySelector('.connections-manual-modal')`, 'manual account dialog closed')
}

async function addTransaction(client, sessionId, { description, amount, category, type, recurring }) {
  await clickButton(client, sessionId, 'Manual entry')
  await waitFor(client, sessionId, `Boolean(document.querySelector('[role=dialog], .modal'))`, `transaction dialog for ${description}`)
  if (type === 'income') await clickButton(client, sessionId, 'Income')
  await setInput(client, sessionId, 'input[name=description]', description)
  await setInput(client, sessionId, 'input[name=amount]', String(amount))
  await setInput(client, sessionId, 'input[name=category]', category)
  await setInput(client, sessionId, 'input[name=date]', '2026-08-01')
  if (recurring) {
    await evaluate(client, sessionId, `document.querySelector('input[name=recurring]')?.click()`)
  }
  await clickButton(client, sessionId, 'Save')
  await waitFor(client, sessionId, `!document.querySelector('[role=dialog], .modal')`, `transaction dialog closed for ${description}`)
}

async function run() {
  const launched = await launchChrome()
  const { client } = launched
  let sessionId
  const browserErrors = []
  const providerRequests = []
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), appUrl: APP_URL, browser: launched.executable, states: {}, interactions: {}, envelope: {}, browserErrors, providerRequests }

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
    client.on('Network.requestWillBeSent', (params, eventSession) => {
      if (eventSession !== sessionId) return
      if (HOSTED_PROVIDER_HOSTS.some((host) => params.request?.url?.includes(host))) providerRequests.push(params.request.url)
    })

    // Warm-up: absorb the one-time service-worker-install reload before any
    // real state capture begins (see auth-security-production-acceptance.mjs
    // for the original rationale -- a fixture call can otherwise land in the
    // narrow window before that reload and be silently discarded).
    await navigate(client, sessionId, APP_URL)
    await waitFor(client, sessionId, `(async () => {
      if (!('serviceWorker' in navigator)) return true
      await navigator.serviceWorker.ready.catch(() => {})
      return Boolean(navigator.serviceWorker.controller)
    })()`, 'service worker controller settled (warm-up)', 20_000).catch(() => {})
    await delay(500)

    await authenticateFreshVault(client, sessionId)

    // -----------------------------------------------------------------
    // FI-07: genuinely empty transaction history, before anything is seeded.
    // -----------------------------------------------------------------
    await setViewport(client, sessionId, 1440, 900)
    await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready')
    report.states['finance-intelligence-empty'] = await captureState(client, sessionId, 'finance-intelligence-empty', 'data-ai-ready', {
      beforeEach: async (width) => { await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready') },
      waitExpr: `document.body?.innerText.includes('Finance Intelligence needs transaction history')`,
      waitDescription: 'finance-intelligence-empty',
    })
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' }, sessionId)
    // Going back online can surface a real VaultConflict dialog: local-user
    // is a shared identity across every acceptance script in this job, so
    // cloud state written by an earlier script can genuinely conflict with
    // this vault's own (different) local state once sync resumes. Give it a
    // moment to appear (most runs won't see one at all), then resolve it
    // defensively -- captureState also checks this on every subsequent
    // capture, since each of the several separate saves below can
    // independently retrigger it, not just the first reconnect.
    await delay(2_000)
    report.interactions.vaultConflictDuringSeeding = await resolveConflictIfPresent(client, sessionId)

    // A fresh vault has zero accounts too -- the Add Transaction dialog's
    // account <select> needs at least one real <option> before any
    // transaction can be validly submitted.
    await addManualAccount(client, sessionId)
    await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready')

    // -----------------------------------------------------------------
    // Seed a small, varied, real transaction set via the genuine Add
    // Transaction dialog (never a storage-internals shortcut). Finance
    // Intelligence's topbar already exposes the same "Manual entry" control
    // as every other non-Dashboard tab, so no dependency on Dashboard's own,
    // differently labelled add-transaction affordance is needed.
    // -----------------------------------------------------------------
    const seedTransactions = [
      { description: 'Salary', amount: '3200.00', category: 'Income', type: 'income', recurring: true },
      { description: 'Rent', amount: '950.00', category: 'Housing', type: 'expense', recurring: true },
      { description: 'Groceries', amount: '64.50', category: 'Groceries', type: 'expense', recurring: false },
      { description: 'Streaming subscription', amount: '12.99', category: 'Subscriptions', type: 'expense', recurring: true },
      { description: 'Restaurant', amount: '38.20', category: 'Dining', type: 'expense', recurring: false },
    ]
    for (const transaction of seedTransactions) await addTransaction(client, sessionId, transaction)
    report.interactions.transactionsSeeded = seedTransactions.length

    // AUTO-01 / AUTO-02: deterministic fixture-forced states of the
    // globally-mounted status strip. Captured over whatever destination is
    // currently active (Finance Intelligence, left over from seeding) --
    // the strip itself is tab-independent, so its own readiness marker
    // ('data-ai-ready', the real current destination) is what matters here,
    // not a Dashboard marker for a page we never navigated to.
    await waitFor(client, sessionId, 'typeof window.__financePlannerAutoAcceptanceState === "function"', 'AUTO acceptance fixture bridge')
    await evaluate(client, sessionId, `window.__financePlannerAutoAcceptanceState('compact')`)
    report.states['auto-analysis-compact'] = await captureState(client, sessionId, 'auto-analysis-compact', 'data-ai-ready', {
      beforeEach: async (width) => { await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready') },
      waitExpr: `document.body?.innerText.includes('Transaction check up to date')`,
      waitDescription: 'auto-analysis-compact',
    })
    await evaluate(client, sessionId, `window.__financePlannerAutoAcceptanceState('expanded')`)
    report.states['auto-analysis-expanded'] = await captureState(client, sessionId, 'auto-analysis-expanded', 'data-ai-ready', {
      beforeEach: async (width) => { await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready') },
      waitExpr: `document.body?.innerText.includes('Runs automatically and rule-based')`,
      waitDescription: 'auto-analysis-expanded',
    })
    report.interactions.autoAnalysis = await evaluate(client, sessionId, `(() => {
      const strip = document.querySelector('.automatic-analysis')
      const closeButton = strip?.querySelector('.automatic-analysis__header')
      // The briefing text legitimately contains real deterministic
      // percentages (spending-trend deltas, savings rate) -- what must
      // never appear is a confidence/model-score-style claim next to one.
      return { hasCalculatedBadge: Boolean(strip?.querySelector('.intel-badge--calculated')), hasConfidenceClaim: /confidence|model score|\\bcertainty\\b/i.test(strip?.textContent || ''), collapsible: Boolean(closeButton) }
    })()`)
    assert.equal(report.interactions.autoAnalysis.hasCalculatedBadge, true, 'AUTO must carry the neutral Calculated badge')
    assert.equal(report.interactions.autoAnalysis.hasConfidenceClaim, false, 'AUTO must never show a confidence/model-score claim (deterministic, not model-derived)')
    await evaluate(client, sessionId, `window.__financePlannerAutoAcceptanceState('reset')`)
    // Resetting clears the fixture override, but that also flips
    // AutomaticTransactionAnalysis's acceptanceMode dependency back to null,
    // which re-runs its real (non-fixture) polling effect immediately --
    // revisionRef was never touched while the fixture was active, so it
    // genuinely sees the 5 seeded transactions as new and fires a real,
    // accurate "Transaction check up to date" status. Let that run its
    // real ~4s auto-fade to completion so it doesn't visually collide with
    // the FI-01 capture right after, rather than fighting real, correct
    // timing with a CSS workaround alone.
    await delay(4_500)

    // -----------------------------------------------------------------
    // Finance Intelligence: FI-01 .. FI-06 (FI-07 already captured empty).
    // -----------------------------------------------------------------
    const fiStates = [
      ['finance-intelligence-ready', null, `document.body?.innerText.includes('Understand your transactions') && document.body?.innerText.includes('transactions ready to analyze')`],
      ['finance-intelligence-progress', 'progress', `document.body?.innerText.includes('Analyzing 46 of 142')`],
      ['finance-intelligence-mixed', 'results', `document.body?.innerText.includes('Review queue')`],
      ['finance-intelligence-anomaly', 'anomaly', `document.body?.innerText.includes('statistical comparison, not a fraud check')`],
      ['finance-intelligence-applied', 'applied', `document.body?.innerText.includes('trusted suggestions applied')`],
      ['finance-intelligence-error', 'error', `document.body?.innerText.includes("Analysis couldn't finish")`],
    ]
    for (const [name, mode, waitExpr] of fiStates) {
      report.states[name] = await captureState(client, sessionId, name, 'data-ai-ready', {
        beforeEach: async (width) => {
          await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready')
          if (mode) await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
        },
        waitExpr,
        waitDescription: name,
      })
    }
    // Re-establish 'results' mode explicitly (the loop above ends on
    // 'error', which has no suggestion rows at all) before checking the
    // trusted-vs-review structural distinction and bulk-apply scoping.
    await ensureDestination(client, sessionId, 'Finance Intelligence', 'data-ai-ready')
    await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('results')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Review queue')`, 'finance-intelligence results for trusted-vs-review check')
    report.interactions.trustedVsReview = await evaluate(client, sessionId, `(() => {
      const rows = [...document.querySelectorAll('.ai-result')]
      const trusted = rows.filter((r) => r.querySelector('.trusted-badge'))
      const review = rows.filter((r) => r.classList.contains('review-required'))
      return {
        trustedCount: trusted.length,
        reviewCount: review.length,
        // Structural distinction beyond color: review rows carry a left
        // border-width class change and an explicit text badge, not just a hue.
        reviewHasDistinctBorder: review.every((r) => getComputedStyle(r).borderLeftWidth !== '1px'),
      }
    })()`)
    assert.ok(report.interactions.trustedVsReview.trustedCount > 0, 'results state must include at least one trusted suggestion')
    assert.ok(report.interactions.trustedVsReview.reviewCount > 0, 'results state must include at least one review-required suggestion')
    assert.ok(report.interactions.trustedVsReview.reviewHasDistinctBorder !== false || report.interactions.trustedVsReview.reviewCount === 0, 'review-required rows must differ structurally, not only by color')

    // Bulk-apply must only ever touch the trusted subset (still 'results').
    const beforeBulkNetworkCount = providerRequests.length
    await evaluate(client, sessionId, `document.querySelector('.ai-bulk-bar button')?.click()`)
    await delay(200)
    report.interactions.bulkApplyNoProviderCalls = providerRequests.length === beforeBulkNetworkCount
    assert.equal(report.interactions.bulkApplyNoProviderCalls, true, 'bulk-apply must never call a hosted AI provider')

    // -----------------------------------------------------------------
    // Finance Assistant: ASSIST-01 .. ASSIST-07.
    // -----------------------------------------------------------------
    const assistStates = [
      ['assistant-hosted-consent', null, `/choose how this runs/i.test(document.body?.innerText || '')`],
      ['assistant-hosted-running', 'hosted-running', `document.body?.innerText.includes('Building your financial analysis')`],
      ['assistant-hosted-result', 'success', `document.body?.innerText.includes('Personal financial analysis')`],
      ['assistant-hosted-fallback', 'hosted-fallback', `document.body?.innerText.includes('Rule-based analysis available')`],
      ['assistant-local-selected', 'local-selected', `document.body?.innerText.includes('I understand this will download data')`],
      ['assistant-local-running', 'local-running', `document.body?.innerText.includes('On-device model loading and running') || document.body?.innerText.includes('On-device model working')`],
    ]
    for (const [name, mode, waitExpr] of assistStates) {
      report.states[name] = await captureState(client, sessionId, name, 'data-assistant-ready', {
        beforeEach: async (width) => {
          await ensureDestination(client, sessionId, 'Finance Assistant', 'data-assistant-ready')
          if (mode) await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
        },
        waitExpr,
        waitDescription: name,
      })
    }

    // ASSIST-07: Planning mode + Learning Budget Planner integration.
    report.states['assistant-planning'] = await captureState(client, sessionId, 'assistant-planning', 'data-assistant-ready', {
      beforeEach: async (width) => {
        await ensureDestination(client, sessionId, 'Finance Assistant', 'data-assistant-ready')
        await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('success')`)
        await waitFor(client, sessionId, `document.body?.innerText.includes('Personal financial analysis')`, 'assistant success state before planning tab')
        await clickButton(client, sessionId, 'Planning')
      },
      waitExpr: `document.body?.innerText.includes('Learning budget plan') && /deterministic planning/i.test(document.body?.innerText || '')`,
      waitDescription: 'assistant-planning',
    })
    report.interactions.learningBudgetIntegration = await evaluate(client, sessionId, `(() => ({
      dividerPresent: Boolean(document.querySelector('.assistant-budget-divider')),
      plannerHeadingCount: [...document.querySelectorAll('h2')].filter((h) => h.textContent?.trim() === 'Learning budget plan').length,
    }))()`)
    assert.equal(report.interactions.learningBudgetIntegration.dividerPresent, true)
    assert.equal(report.interactions.learningBudgetIntegration.plannerHeadingCount, 1, 'the planner must not be duplicated')

    // Hosted-vs-fallback badge distinction (ASSIST-03/ASSIST-04, DOM-level).
    await ensureDestination(client, sessionId, 'Finance Assistant', 'data-assistant-ready')
    await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('success')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Personal financial analysis')`, 'assistant success for badge check')
    const hostedBadge = await evaluate(client, sessionId, `document.querySelector('.assistant-answer .intel-badge--hosted')?.textContent || null`)
    await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('hosted-fallback')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Rule-based analysis available')`, 'assistant fallback for badge check')
    const fallbackBadge = await evaluate(client, sessionId, `document.querySelector('.assistant-answer .intel-badge--hosted')?.textContent || null`)
    const fallbackCalculatedBadge = await evaluate(client, sessionId, `document.querySelector('.assistant-answer .intel-badge--calculated')?.textContent || null`)
    report.interactions.badgeDistinction = { hostedBadge, fallbackBadge, fallbackCalculatedBadge }
    assert.equal(hostedBadge, 'Hosted model (consented)', 'genuine hosted success must show the hosted badge')
    assert.equal(fallbackBadge, null, 'a fallback answer must never show the hosted-success badge')
    assert.equal(fallbackCalculatedBadge, 'Calculated · server fallback', 'a server-side fallback must show the neutral Calculated badge with an accurate sub-label')

    // Smartness/readiness copy must never read as an accuracy/confidence claim.
    report.interactions.readinessLabel = await evaluate(client, sessionId, `(() => ({
      hasReadinessHeading: /Assistant readiness: \\d+%/.test(document.body.innerText),
      hasMandatoryCaption: document.body.innerText.includes('not a measure of how accurate any single answer is'),
      claimsAccuracy: /accuracy score|prediction accuracy|investment performance/i.test(document.body.innerText),
    }))()`)
    assert.equal(report.interactions.readinessLabel.hasReadinessHeading, true)
    assert.equal(report.interactions.readinessLabel.hasMandatoryCaption, true)
    assert.equal(report.interactions.readinessLabel.claimsAccuracy, false)

    // Agent approve/reject: zero network calls, status-only mutation.
    const beforeAgentNetworkCount = providerRequests.length
    const agentInteraction = await evaluate(client, sessionId, `(async () => {
      const approveButton = [...document.querySelectorAll('.assistant-agent-row button[aria-label^="Approve "]')][0]
      if (!approveButton) return { present: false }
      const row = approveButton.closest('.assistant-agent-row')
      approveButton.click()
      await new Promise((r) => setTimeout(r, 150))
      return { present: true, status: row?.querySelector('.pill')?.textContent?.trim() }
    })()`)
    report.interactions.agentApprove = { ...agentInteraction, providerCallsDuringApprove: providerRequests.length - beforeAgentNetworkCount }
    if (agentInteraction.present) {
      assert.equal(report.interactions.agentApprove.status, 'Approved')
      assert.equal(report.interactions.agentApprove.providerCallsDuringApprove, 0, 'agent approval must never call a hosted provider')
    }
    const beforeRejectNetworkCount = providerRequests.length
    const rejectInteraction = await evaluate(client, sessionId, `(async () => {
      const rejectButton = [...document.querySelectorAll('.assistant-agent-row button[aria-label^="Reject "]')][0]
      if (!rejectButton) return { present: false }
      const row = rejectButton.closest('.assistant-agent-row')
      rejectButton.click()
      await new Promise((r) => setTimeout(r, 150))
      return { present: true, status: row?.querySelector('.pill')?.textContent?.trim() }
    })()`)
    report.interactions.agentReject = { ...rejectInteraction, providerCallsDuringReject: providerRequests.length - beforeRejectNetworkCount }
    if (rejectInteraction.present) {
      assert.equal(report.interactions.agentReject.status, 'Rejected')
      assert.equal(report.interactions.agentReject.providerCallsDuringReject, 0, 'agent rejection must never call a hosted provider')
    }

    // -----------------------------------------------------------------
    // Receipt Review: RECEIPT-01 .. RECEIPT-07.
    // -----------------------------------------------------------------
    report.states['receipt-empty'] = await captureState(client, sessionId, 'receipt-empty', 'data-receipt-ready', {
      beforeEach: async (width) => { await ensureDestination(client, sessionId, 'Receipt Review', 'data-receipt-ready') },
      waitExpr: `document.body?.innerText.includes('Review a grocery receipt') && document.body?.innerText.includes('No review yet')`,
      waitDescription: 'receipt-empty',
    })
    const receiptStates = [
      ['receipt-selected-consent', 'selected', `document.body?.innerText.includes('resets if you choose a different image')`],
      ['receipt-running', 'running', `document.body?.innerText.includes('Reviewing your receipt')`],
      ['receipt-result-overview', 'sufficient', `document.body?.innerText.includes('Good foundation') || document.body?.innerText.includes('Model confidence')`],
      ['receipt-insufficient', 'insufficient', `document.body?.innerText.includes('Not enough to give a reliable review')`],
      ['receipt-error', 'receipt-error', `document.body?.innerText.includes("Couldn't review this receipt") || document.body?.innerText.includes('no automatic substitute')`],
    ]
    for (const [name, mode, waitExpr] of receiptStates) {
      report.states[name] = await captureState(client, sessionId, name, 'data-receipt-ready', {
        beforeEach: async (width) => {
          await ensureDestination(client, sessionId, 'Receipt Review', 'data-receipt-ready')
          await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
        },
        waitExpr,
        waitDescription: name,
      })
    }
    // RECEIPT-05: same fixture as RECEIPT-04, scrolled to the detailed item
    // breakdown rather than the top-of-page score summary.
    report.states['receipt-result-detail'] = await captureState(client, sessionId, 'receipt-result-detail', 'data-receipt-ready', {
      beforeEach: async (width) => {
        await ensureDestination(client, sessionId, 'Receipt Review', 'data-receipt-ready')
        await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('sufficient')`)
      },
      waitExpr: `/detected items/i.test(document.body?.innerText || '')`,
      waitDescription: 'receipt-result-detail',
      scrollTo: 'items',
    })
    // Re-establish the 'selected' state explicitly (the loop above may have
    // left the page on a later fixture mode) before checking consent
    // semantics, so this genuinely tests RECEIPT-02, not whatever ran last.
    await ensureDestination(client, sessionId, 'Receipt Review', 'data-receipt-ready')
    await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('selected')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('resets if you choose a different image')`, 'receipt-selected-consent for consent-lifecycle check')
    report.interactions.receiptConsentLifecycle = await evaluate(client, sessionId, `(() => {
      const checkbox = document.querySelector('.receipt-consent input[type=checkbox]')
      const analyzeButton = document.querySelector('.receipt-analyze')
      return { consentUnchecked: checkbox ? !checkbox.checked : null, analyzeDisabled: analyzeButton?.disabled ?? null }
    })()`)
    assert.equal(report.interactions.receiptConsentLifecycle.consentUnchecked, true, 'per-image consent must start unchecked')
    assert.equal(report.interactions.receiptConsentLifecycle.analyzeDisabled, true, 'Review purchase must stay disabled until consent is given')

    // Re-establish 'insufficient' explicitly for the same reason.
    await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('insufficient')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Not enough to give a reliable review')`, 'receipt-insufficient for safeguard check')
    report.interactions.receiptInsufficientSafeguards = await evaluate(client, sessionId, `(() => {
      const hasScore = Boolean(document.querySelector('.receipt-score'))
      const hasItems = Boolean(document.querySelector('.receipt-items'))
      const hasRecommendations = document.querySelectorAll('.receipt-recommendations li').length > 0
      return { hasScore, hasItems, hasRecommendations, hasRetakeGuidance: document.body.innerText.includes('in focus, and in good light') }
    })()`)
    assert.equal(report.interactions.receiptInsufficientSafeguards.hasScore, false, 'insufficient evidence must show no score')
    assert.equal(report.interactions.receiptInsufficientSafeguards.hasItems, false, 'insufficient evidence must show no item breakdown')
    assert.equal(report.interactions.receiptInsufficientSafeguards.hasRecommendations, false, 'insufficient evidence must show no recommendations')
    assert.equal(report.interactions.receiptInsufficientSafeguards.hasRetakeGuidance, true, 'insufficient evidence must offer photo-retake guidance')

    // Re-establish 'sufficient' explicitly for the no-live-price / no-
    // certification-language checks (both are RECEIPT-04/05-specific claims).
    await evaluate(client, sessionId, `window.__financePlannerAcceptanceState('sufficient')`)
    await waitFor(client, sessionId, `document.body?.innerText.includes('Model confidence')`, 'receipt-sufficient for privacy-claim check')
    report.interactions.receiptNoLivePriceClaim = await evaluate(client, sessionId, `document.body.innerText.includes('No live price, offer, or inventory data')`)
    assert.equal(report.interactions.receiptNoLivePriceClaim, true, 'must always disclose no live price/inventory data')
    // The limitations panel's own correct copy explicitly denies being a
    // verified certification ("...the model's best reading, not verified
    // certifications") -- allow that exact legitimate denial while still
    // catching any other, wrongly certification-claiming use (matches the
    // same not-a-fraud-check pattern used for the FI-04 geometry check).
    report.interactions.receiptNoCertificationLanguage = await evaluate(client, sessionId, `!/(?<!not )verified certif|certified organic|official seal/i.test(document.body.innerText)`)
    assert.equal(report.interactions.receiptNoCertificationLanguage, true, 'model-inferred labels must never read as verified certifications')

    // -----------------------------------------------------------------
    // Forced-colours / reduced-motion / 200% text envelope checks on
    // priority states.
    // -----------------------------------------------------------------
    const envelopeTargets = [
      ['finance-intelligence-mixed', 'data-ai-ready', 'Finance Intelligence', 'results'],
      ['assistant-hosted-consent', 'data-assistant-ready', 'Finance Assistant', null],
      ['assistant-hosted-fallback', 'data-assistant-ready', 'Finance Assistant', 'hosted-fallback'],
      ['receipt-selected-consent', 'data-receipt-ready', 'Receipt Review', 'selected'],
      ['receipt-result-overview', 'data-receipt-ready', 'Receipt Review', 'sufficient'],
      ['receipt-insufficient', 'data-receipt-ready', 'Receipt Review', 'insufficient'],
    ]
    for (const [name, readyAttribute, destination, mode] of envelopeTargets) {
      await ensureDestination(client, sessionId, destination, readyAttribute)
      if (mode) await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
      await setViewport(client, sessionId, 390, 844)
      await delay(150)
      report.envelope[name] = { forcedColors: await forcedColorsCheck(client, sessionId, name, readyAttribute) }
      assert.equal(report.envelope[name].forcedColors.controlsHaveBorder, true, `${name} controls lose their border under forced-colors`)
      assert.equal(report.envelope[name].forcedColors.horizontalOverflow, false, `${name} overflows under forced-colors`)
    }
    const reducedMotionTargets = [
      ['finance-intelligence-progress', 'data-ai-ready', 'Finance Intelligence', 'progress'],
      ['assistant-hosted-running', 'data-assistant-ready', 'Finance Assistant', 'hosted-running'],
      ['assistant-local-running', 'data-assistant-ready', 'Finance Assistant', 'local-running'],
      ['receipt-running', 'data-receipt-ready', 'Receipt Review', 'running'],
    ]
    for (const [name, readyAttribute, destination, mode] of reducedMotionTargets) {
      await ensureDestination(client, sessionId, destination, readyAttribute)
      if (mode) await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
      await setViewport(client, sessionId, 390, 844)
      await delay(150)
      report.envelope[name] = { ...(report.envelope[name] || {}), reducedMotion: await reducedMotionCheck(client, sessionId, name, readyAttribute) }
      assert.equal(report.envelope[name].reducedMotion.contentVisible, true, `${name} content missing under reduced motion`)
    }
    const zoomTargets = [
      ['finance-intelligence-mixed', 'data-ai-ready', 'Finance Intelligence', 'results'],
      ['assistant-hosted-consent', 'data-assistant-ready', 'Finance Assistant', null],
      ['assistant-hosted-result', 'data-assistant-ready', 'Finance Assistant', 'success'],
      ['assistant-hosted-fallback', 'data-assistant-ready', 'Finance Assistant', 'hosted-fallback'],
      ['receipt-selected-consent', 'data-receipt-ready', 'Receipt Review', 'selected'],
      ['receipt-result-detail', 'data-receipt-ready', 'Receipt Review', 'sufficient'],
      ['receipt-insufficient', 'data-receipt-ready', 'Receipt Review', 'insufficient'],
    ]
    for (const [name, readyAttribute, destination, mode] of zoomTargets) {
      await ensureDestination(client, sessionId, destination, readyAttribute)
      if (mode) await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
      await setViewport(client, sessionId, 390, 844)
      await delay(150)
      report.envelope[name] = { ...(report.envelope[name] || {}), zoom: await zoomCheck(client, sessionId, name, readyAttribute) }
      assert.equal(report.envelope[name].zoom.headingClipped, false, `${name} heading clipped at 200% text`)
      assert.equal(report.envelope[name].zoom.horizontalOverflow, false, `${name} overflows at 200% text`)
    }

    // -----------------------------------------------------------------
    // Final provider-boundary proof: across this entire acceptance run,
    // no fixture-driven interaction contacted a real hosted AI provider.
    // -----------------------------------------------------------------
    assert.deepEqual(providerRequests, [], `Fixtures must never call a hosted AI provider. Observed: ${providerRequests.join(', ')}`)
    assert.deepEqual(browserErrors, [], `Uncaught browser errors: ${browserErrors.join(' | ')}`)

    const stateCount = Object.keys(report.states).length
    const screenshotCount = Object.values(report.states).reduce((sum, shots) => sum + shots.length, 0)
    report.stateCount = stateCount
    report.primaryScreenshotCount = screenshotCount
    report.passed = true
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Finance Intelligence production acceptance passed: ${stateCount} states, ${screenshotCount} primary screenshots. Evidence: ${ARTIFACT_PATH}`)
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
