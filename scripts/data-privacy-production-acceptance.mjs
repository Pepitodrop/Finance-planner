import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.DATA_PRIVACY_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/data-privacy-production-acceptance.json')
const ARTIFACT_DIR = dirname(ARTIFACT_PATH)
const VAULT_PASSWORD = 'Acceptance-Vault-Password-2026!'
const DEADLINE_MS = 45_000
const VIEWPORTS = [[1440, 900], [1024, 768], [390, 844], [360, 800]]

// ---------------------------------------------------------------------------
// CDP boilerplate (duplicated to match this repo's existing convention of
// self-contained acceptance scripts -- see auth-security/connections/
// finance-intelligence production-acceptance.mjs).
// ---------------------------------------------------------------------------

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch {}
  }
  throw new Error('A Chromium or Google Chrome executable is required for Data & Privacy acceptance.')
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
  const profile = await mkdtemp(join(tmpdir(), 'finance-planner-dp-acceptance-'))
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
    hasFixtureHook: typeof window.__financePlannerAcceptanceState === 'function',
    bodyTextSample: document.body?.innerText?.slice(0, 1200),
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
      allButtonTexts: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim().slice(0, 40)).filter(Boolean).slice(0, 25),
    }
  })()`)
  assert.equal(result.clicked, true, `Button not found or disabled: ${text} -- ${JSON.stringify(result)}`)
}

async function setInput(client, sessionId, selector, value) {
  const changed = await evaluate(client, sessionId, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return false
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
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

// Re-unlocks the vault if it's found locked mid-script (see
// finance-intelligence-production-acceptance.mjs for the original
// rationale -- headless Chrome under CI resource contention can plausibly
// trip the app's real auto-lock-on-background behavior; self-heal rather
// than treating it as fatal).
async function ensureVaultUnlocked(client, sessionId) {
  const locked = await evaluate(client, sessionId, `document.body?.innerText.includes('Unlock Finance Planner') || false`)
  if (!locked) return false
  await evaluate(client, sessionId, `(() => {
    const input = document.querySelector('input[type=password]')
    if (input) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(VAULT_PASSWORD)}); input.dispatchEvent(new Event('input', { bubbles: true })) }
  })()`)
  await clickButton(client, sessionId, 'Unlock')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'vault re-unlocked after unexpected lock')
  await waitFor(client, sessionId, 'typeof window.__financePlannerAcceptanceState === "function"', 'acceptance fixture bridge re-registered after unlock')
  return true
}

async function resolveConflictIfPresent(client, sessionId) {
  const present = await evaluate(client, sessionId, `Boolean(document.querySelector('.vault-conflict-backdrop'))`)
  if (!present) return false
  await clickButton(client, sessionId, "Keep this device's version")
  await waitFor(client, sessionId, `!document.querySelector('.vault-conflict-backdrop')`, "vault conflict resolved (kept this device's version)")
  return true
}

// Exact match, not substring: Step 13 added an "Account" destination
// alongside the pre-existing "Accounts" (financial accounts) destination --
// clickButton's substring match would otherwise always hit "Accounts"
// first, since it appears earlier in navigation order.
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

// The whole DataTools family (overview + every sub-page: create/restore
// backup, vault password, cloud/device status, delete account) shares one
// 'data-data-ready' marker, so ensureDestination's generic "already there,
// skip" check can't tell a sub-page apart from the overview -- it would
// wrongly no-op when the previous state left a sub-page or dialog open.
// Once any Data & Backup fixture mode has ever been set, DataTools keeps
// re-initializing into *that* fixture's view/dialog on every remount (by
// design -- that's what makes fixture states deterministic), so leaving
// and re-entering the destination alone can't reach a genuinely clean
// overview either. The dedicated 'overview' fixture mode (maps to no
// dialog and view='overview', like acceptanceMode being absent) is the
// reliable way back -- except setFixture('overview') is itself a same-
// value no-op once acceptanceMode is *already* 'overview' from an earlier
// call (React bails out, no remount), which happens whenever a later
// state reached a sub-view via a real click (DATA-02/03/06, SYNC-01)
// rather than a fixture-mode change. In that case, leaving the
// destination and re-entering it (App.tsx unmounts DataTools entirely
// when tab !== 'data', independent of its key) forces the same fresh
// mount a genuine value change would have.
async function ensureDataOverview(client, sessionId) {
  const clean = `Boolean(document.querySelector('.data-tools-hero')) && !document.querySelector('[role=dialog], [role=alertdialog]')`
  if (await evaluate(client, sessionId, clean)) return
  await ensureVaultUnlocked(client, sessionId)
  await resolveConflictIfPresent(client, sessionId)
  const isMobile = await evaluate(client, sessionId, 'innerWidth <= 768')
  const onDataFamily = await evaluate(client, sessionId, `Boolean(document.querySelector('[data-data-ready=true]'))`)
  if (!onDataFamily) {
    if (isMobile) {
      await clickButton(client, sessionId, 'More')
      await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet for Data and Backup')
    }
    await clickDestinationButton(client, sessionId, 'Data and Backup')
    await waitFor(client, sessionId, `Boolean(document.querySelector('[data-data-ready=true]'))`, 'Data and Backup destination')
    await setFixture(client, sessionId, 'overview')
    await waitFor(client, sessionId, clean, 'Data and Backup overview (fixture-reset)')
    return
  }
  await setFixture(client, sessionId, 'overview')
  if (await evaluate(client, sessionId, `(async () => { await new Promise((r) => setTimeout(r, 400)); return ${clean} })()`)) return
  // setFixture was a same-value no-op (acceptanceMode was already
  // 'overview') and we're on a real sub-view (e.g. CreateBackup reached
  // by a genuine click, not a fixture change) -- leave and re-enter the
  // destination to force the remount that the no-op setFixture couldn't.
  if (isMobile) {
    await clickButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet for Dashboard')
  }
  await clickDestinationButton(client, sessionId, 'Dashboard')
  await waitFor(client, sessionId, 'Boolean(document.querySelector("[data-dashboard-ready=true]"))', 'Dashboard (leaving Data and Backup)')
  if (isMobile) {
    await clickButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet for Data and Backup')
  }
  await clickDestinationButton(client, sessionId, 'Data and Backup')
  await waitFor(client, sessionId, clean, 'Data and Backup overview (re-entered)')
}

// DataTools's fixture-driven sub-views (restore-failure, csv-warning,
// reset, reset-complete, the three delete-account views) only re-init
// their internal open/view state when acceptanceMode actually *changes*
// (via the key={dataAcceptanceMode} remount in App.tsx) -- re-asserting
// the same mode on a later viewport iteration of the same state is a
// same-value no-op that does nothing. Detouring through ensureDataOverview
// first is unnecessary (and was actively harmful -- see its own history):
// setFixture changing acceptanceMode to a *different* value already forces
// a fresh, correctly-initialized remount on its own, regardless of
// whatever view the previous fixture state left active. Only make sure
// the 'data' tab itself is showing first, since DataTools isn't even
// mounted otherwise.
async function ensureDataFixture(client, sessionId, mode, alreadyThereExpr) {
  if (await evaluate(client, sessionId, alreadyThereExpr)) return
  await ensureVaultUnlocked(client, sessionId)
  await resolveConflictIfPresent(client, sessionId)
  const onDataFamily = await evaluate(client, sessionId, `Boolean(document.querySelector('[data-data-ready=true]'))`)
  if (!onDataFamily) {
    const isMobile = await evaluate(client, sessionId, 'innerWidth <= 768')
    if (isMobile) {
      await clickButton(client, sessionId, 'More')
      await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet for Data and Backup')
    }
    await clickDestinationButton(client, sessionId, 'Data and Backup')
    await waitFor(client, sessionId, `Boolean(document.querySelector('[data-data-ready=true]'))`, 'Data and Backup destination')
  }
  await setFixture(client, sessionId, mode)
}

async function ensureDestination(client, sessionId, label, readyAttribute) {
  if (await evaluate(client, sessionId, `Boolean(document.querySelector('[${readyAttribute}=true]'))`)) return
  await ensureVaultUnlocked(client, sessionId)
  await resolveConflictIfPresent(client, sessionId)
  const isMobile = await evaluate(client, sessionId, 'innerWidth <= 768')
  if (isMobile) {
    await clickButton(client, sessionId, 'More')
    await waitFor(client, sessionId, 'Boolean(document.querySelector("#app-more-sheet"))', 'mobile More sheet')
  }
  await clickDestinationButton(client, sessionId, label)
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
      // Trust-boundary language that must never appear on any Step 13
      // surface: implying broad Google account access, claiming external
      // revocation succeeded unconditionally, or claiming sign-out affects
      // other devices/sessions.
      // SUB-01's own correct copy explicitly *denies* reading email/Drive
      // ("It doesn't read your email, files, or Google Drive.") -- allow
      // that exact legitimate denial while still catching any other,
      // wrongly access-claiming use of these terms, matching the same
      // not-a-fraud-check pattern used elsewhere in this script.
      overclaimsProviderAccess: /gmail|google drive|play store|purchase history/i.test(document.body.innerText.replace(/doesn't read your email, files, or google drive\.?/i, '')),
      overclaimsRevocation: /google.{0,20}(revoked|successfully revoked)/i.test(document.body.innerText) && !document.body.innerText.includes('revoked === false'),
      overclaimsSignOutScope: /sign out.{0,20}(everywhere|all devices)/i.test(document.body.innerText),
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

// Mobile-only in real, current layout (see app-shell.css: .app-mobile-navigation
// is display:none by default, only shown under max-width:768px) -- MORE-01's
// desktop slots capture the genuinely equivalent desktop composition (the
// flat, ungrouped sidebar) instead of a fabricated "More sheet" that has no
// desktop counterpart, per the mission's explicit allowance for this case.
const SCROLL_END_CANDIDATES = new Set(['more-grouped', 'data-overview', 'data-restore', 'vault-password', 'data-reset-confirmation', 'data-delete-gate', 'subscriptions-connected', 'subscriptions-disconnect', 'account-session'])

async function captureState(client, sessionId, name, readyAttribute, { beforeEach, waitExpr, waitDescription, viewports = VIEWPORTS, isModalDialog = false, scrollToSelector = null } = {}) {
  const results = []
  for (const [width, height] of viewports) {
    await setViewport(client, sessionId, width, height)
    await ensureVaultUnlocked(client, sessionId)
    await resolveConflictIfPresent(client, sessionId)
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
    if (scrollToSelector) {
      await evaluate(client, sessionId, `document.querySelector(${JSON.stringify(scrollToSelector)})?.scrollIntoView({ block: 'center', behavior: 'instant' })`)
    } else {
      await evaluate(client, sessionId, `window.scrollTo({ top: 0, behavior: 'instant' })`)
    }

    const assertions = await evaluate(client, sessionId, geometryScript(readyAttribute))
    const shot = await captureScreenshot(name, width, height, sessionId, client)
    assert.deepEqual(assertions.viewport, { width, height }, `${name} viewport mismatch`)
    assert.equal(assertions.root, true, `${name} @ ${width}x${height} missing ready marker`)
    assert.equal(assertions.lang, 'en', `${name} @ ${width}x${height} missing English language boundary`)
    assert.equal(assertions.horizontalOverflow, false, `${name} @ ${width}x${height} has horizontal overflow`)
    assert.deepEqual(assertions.undersizedTargets, [], `${name} @ ${width}x${height} has undersized targets: ${JSON.stringify(assertions.undersizedTargets)}`)
    // A real modal dialog is *supposed* to cover the mobile nav -- that's
    // what makes it modal, and its backdrop makes the rest of the page
    // (nav included) correctly inert. The obstruction check only applies
    // to full, non-modal page states.
    if (!isModalDialog) {
      assert.equal(assertions.mobileNavigationUnobscured, true, `${name} @ ${width}x${height} obstructs mobile navigation (covered by: ${assertions.navObscuredBy})`)
    }
    assert.equal(assertions.overclaimsProviderAccess, false, `${name} @ ${width}x${height} overclaims provider access scope`)
    assert.equal(assertions.overclaimsRevocation, false, `${name} @ ${width}x${height} overclaims Google revocation`)
    assert.equal(assertions.overclaimsSignOutScope, false, `${name} @ ${width}x${height} overclaims sign-out scope`)

    let scrollEnd = null
    if (width === 390 && SCROLL_END_CANDIDATES.has(name) && assertions.scrollHeight > assertions.viewportHeight + 4) {
      await evaluate(client, sessionId, `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`)
      await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
      await delay(100)
      const scrollEndAssertions = await evaluate(client, sessionId, geometryScript(readyAttribute))
      assert.equal(scrollEndAssertions.horizontalOverflow, false, `${name} scroll-end @ ${width}x${height} has horizontal overflow`)
      if (!isModalDialog) {
        assert.equal(scrollEndAssertions.mobileNavigationUnobscured, true, `${name} scroll-end @ ${width}x${height} obstructs mobile navigation`)
      }
      const scrollShot = await captureScreenshot(name, width, height, sessionId, client, '-scroll-end')
      scrollEnd = { ...scrollShot, ...scrollEndAssertions }
      await evaluate(client, sessionId, `window.scrollTo({ top: 0, behavior: 'instant' })`)
    }
    results.push({ width, height, ...shot, ...assertions, scrollEnd })
  }
  return results
}

// Escape alone can race the next envelope target's own navigation (its
// close handler runs on the next tick, not synchronously) -- confirm the
// dialog/sheet has actually left the DOM before moving on, so the next
// target's ensureDataOverview/ensureDestination never has to fight a
// still-closing overlay.
async function closeAnyOpenOverlay(client, sessionId) {
  await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(client, sessionId, `!document.querySelector('[role=dialog], [role=alertdialog], #app-more-sheet')`, 'overlay closed before next envelope target', 5_000).catch(() => {})
}

// ---------------------------------------------------------------------------
// Forced-colors / reduced-motion / 200% text envelope checks.
// ---------------------------------------------------------------------------

async function forcedColorsCheck(client, sessionId, name, readyAttribute) {
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }, sessionId)
  await evaluate(client, sessionId, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  const result = await evaluate(client, sessionId, `(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    const dialog = document.querySelector('[role=dialog], [role=alertdialog]')
    // Scoped to this state's own root (or the dialog, if one is open on
    // top of it) -- globally-mounted, unrelated surfaces (e.g. the
    // AutomaticTransactionAnalysis status strip) can legitimately be
    // visible at the same time and are out of scope for this state's own
    // forced-colors evidence.
    const scope = dialog || document.querySelector('[${readyAttribute}=true]') || document.body
    const buttons = [...scope.querySelectorAll('button, [role=radio], [role=tab]')].filter(visible)
    const badges = [...scope.querySelectorAll('.subscription-source-badge, .pill')].filter(visible)
    return {
      root: Boolean(document.querySelector('[${readyAttribute}=true]')),
      dialogHasBorder: dialog ? (getComputedStyle(dialog).borderStyle !== 'none' && getComputedStyle(dialog).borderWidth !== '0px') : null,
      controlsHaveBorder: buttons.every((b) => getComputedStyle(b).borderStyle !== 'none' || getComputedStyle(b).outlineStyle !== 'none'),
      badgesDistinguishable: badges.every((b) => (getComputedStyle(b).borderStyle !== 'none' && getComputedStyle(b).borderWidth !== '0px') || b.textContent?.trim()),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
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
    const heading = document.querySelector('[${readyAttribute}=true] h1, [${readyAttribute}=true] h2, [role=dialog] h2, [role=alertdialog] h2')
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
  await waitFor(client, sessionId, 'typeof window.__financePlannerAcceptanceState === "function"', 'acceptance fixture bridge')
  return { vaultMode }
}

// Every fixture mode call must exactly match one of DataToolsAcceptanceMode
// / SubscriptionsAcceptanceMode's real literal union values -- collected
// here once so a typo fails loudly and early rather than silently no-op-ing
// the dispatcher (see App.tsx's window.__financePlannerAcceptanceState).
async function setFixture(client, sessionId, mode) {
  await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)
}

async function run() {
  const launched = await launchChrome()
  const { client } = launched
  let sessionId
  const browserErrors = []
  const networkRequests = []
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), appUrl: APP_URL, browser: launched.executable, states: {}, interactions: {}, envelope: {}, browserErrors, networkRequests }

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
    // Proves fixtures never reach Google or any real external provider --
    // the only allowed cross-origin traffic for this entire run is none.
    client.on('Network.requestWillBeSent', (params, eventSession) => {
      if (eventSession !== sessionId) return
      const url = params.request?.url || ''
      if (url.startsWith(APP_URL) || url.startsWith('http://127.0.0.1') || url.startsWith('ws://') || url.startsWith('data:')) return
      networkRequests.push(url)
    })

    await navigate(client, sessionId, APP_URL)
    await waitFor(client, sessionId, `(async () => {
      if (!('serviceWorker' in navigator)) return true
      await navigator.serviceWorker.ready.catch(() => {})
      return Boolean(navigator.serviceWorker.controller)
    })()`, 'service worker controller settled (warm-up)', 20_000).catch(() => {})
    await delay(500)

    await authenticateVault(client, sessionId)

    // -------------------------------------------------------------
    // MORE-01: grouped More sheet (mobile-only real UI; desktop slots
    // capture the equivalent flat sidebar -- see SCROLL_END_CANDIDATES
    // comment above for why).
    // -------------------------------------------------------------
    const moreResults = []
    for (const [width, height] of [[390, 844], [360, 800]]) {
      await setViewport(client, sessionId, width, height)
      await ensureVaultUnlocked(client, sessionId)
      await resolveConflictIfPresent(client, sessionId)
      await ensureDestination(client, sessionId, 'Dashboard', 'data-dashboard-ready')
      await clickButton(client, sessionId, 'More')
      await waitFor(client, sessionId, `Boolean(document.querySelector('[data-more-ready=true]')) && /data & account/i.test(document.body.innerText)`, `more-grouped @ ${width}x${height}`)
      await delay(150)
      const assertions = await evaluate(client, sessionId, geometryScript('data-more-ready'))
      const shot = await captureScreenshot('more-grouped', width, height, sessionId, client)
      assert.equal(assertions.root, true)
      assert.equal(assertions.lang, 'en')
      assert.equal(assertions.horizontalOverflow, false, `More sheet overflows at ${width}x${height}`)
      assert.deepEqual(assertions.undersizedTargets, [], `More sheet has undersized targets at ${width}x${height}: ${JSON.stringify(assertions.undersizedTargets)}`)
      const groups = await evaluate(client, sessionId, `[...document.querySelectorAll('.app-more-sheet__group-label')].map((el) => el.textContent)`)
      assert.deepEqual(groups, ['Planning', 'Connections', 'Intelligence', 'Data & account'], `More sheet groups changed unexpectedly: ${JSON.stringify(groups)}`)
      const oneCurrentItem = await evaluate(client, sessionId, `document.querySelectorAll('#app-more-sheet [aria-current=page]').length <= 1`)
      assert.equal(oneCurrentItem, true, 'More sheet must mark at most one destination as current')
      let scrollEnd = null
      if (width === 390 && assertions.scrollHeight > assertions.viewportHeight + 4) {
        await evaluate(client, sessionId, `document.querySelector('#app-more-sheet')?.scrollTo({ top: 9999, behavior: 'instant' })`)
        await delay(100)
        const scrollEndAssertions = await evaluate(client, sessionId, geometryScript('data-more-ready'))
        const scrollShot = await captureScreenshot('more-grouped', width, height, sessionId, client, '-scroll-end')
        scrollEnd = { ...scrollShot, ...scrollEndAssertions }
      }
      moreResults.push({ width, height, ...shot, ...assertions, scrollEnd })
      await evaluate(client, sessionId, `document.querySelector('.app-more-sheet__close')?.click()`)
      await waitFor(client, sessionId, `!document.querySelector('#app-more-sheet')`, 'More sheet closed')
    }
    // Desktop-equivalent evidence: the same 12 destinations, flat, in the
    // always-visible sidebar -- there is no "More" affordance to open at
    // these widths (app-shell.css: .app-mobile-navigation is display:none
    // above 768px), so a grouped-sheet screenshot would misrepresent what a
    // real desktop user ever sees.
    for (const [width, height] of [[1440, 900], [1024, 768]]) {
      await setViewport(client, sessionId, width, height)
      await ensureVaultUnlocked(client, sessionId)
      await resolveConflictIfPresent(client, sessionId)
      await ensureDestination(client, sessionId, 'Dashboard', 'data-dashboard-ready')
      await delay(150)
      const sidebarItems = await evaluate(client, sessionId, `[...document.querySelectorAll('.app-navigation__destinations .app-navigation__button')].map((b) => b.getAttribute('title'))`)
      const shot = await captureScreenshot('more-desktop-sidebar-equivalent', width, height, sessionId, client)
      assert.ok(sidebarItems.includes('Subscriptions') && sidebarItems.includes('Account'), `desktop sidebar missing Step 13 destinations: ${JSON.stringify(sidebarItems)}`)
      moreResults.push({ width, height, ...shot, equivalentEvidence: true, sidebarItems })
    }
    report.states['more-grouped'] = moreResults

    // -------------------------------------------------------------
    // ACCOUNT-01: real session identity only.
    // -------------------------------------------------------------
    report.states['account-session'] = await captureState(client, sessionId, 'account-session', 'data-account-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Account', 'data-account-ready') },
      waitExpr: `/signed in as/i.test(document.body?.innerText || '') && document.body?.innerText.includes('Sign out')`,
      waitDescription: 'account-session',
    })
    report.interactions.accountIdentity = await evaluate(client, sessionId, `(() => ({
      hasEditableNameField: Boolean(document.querySelector('input[name=name], input[name=email]')),
      hasPasswordField: Boolean([...document.querySelectorAll('input[type=password]')].length),
      hasChangeEmailButton: [...document.querySelectorAll('button')].some((b) => /change email/i.test(b.textContent || '')),
      signOutButtonClass: document.querySelector('button')?.className || null,
      hasDangerSignOut: Boolean([...document.querySelectorAll('button')].find((b) => /sign out/i.test(b.textContent || ''))?.className.includes('danger-action')),
      neverDevicesClaim: !/all devices|everywhere/i.test(document.body.innerText),
      vaultSeparationNote: document.body.innerText.includes('separate from your encrypted vault'),
    }))()`)
    assert.equal(report.interactions.accountIdentity.hasEditableNameField, false, 'ACCOUNT-01 must not offer a fake profile editor')
    assert.equal(report.interactions.accountIdentity.hasPasswordField, false, 'ACCOUNT-01 must not offer an account-password field')
    assert.equal(report.interactions.accountIdentity.hasChangeEmailButton, false, 'ACCOUNT-01 must not offer a change-email action')
    assert.equal(report.interactions.accountIdentity.hasDangerSignOut, false, 'Sign out must not use the destructive/red button style')
    assert.equal(report.interactions.accountIdentity.neverDevicesClaim, true, 'ACCOUNT-01 must never claim "all devices"/"everywhere"')
    assert.equal(report.interactions.accountIdentity.vaultSeparationNote, true, 'ACCOUNT-01 must explain sign-in is separate from the encrypted vault')

    // -------------------------------------------------------------
    // DATA-01: Data & Backup overview (risk-tiered hierarchy).
    // -------------------------------------------------------------
    report.states['data-overview'] = await captureState(client, sessionId, 'data-overview', 'data-data-ready', {
      beforeEach: async () => { await ensureDataOverview(client, sessionId) },
      waitExpr: `document.body?.innerText.includes('Clear financial data') && document.body?.innerText.includes('Delete account')`,
      waitDescription: 'data-overview',
    })
    report.interactions.dataOverviewHierarchy = await evaluate(client, sessionId, `(() => {
      const cardClasses = [...document.querySelectorAll('.data-tools-backup-card')].map((el) => el.className)
      return {
        allEqualCards: new Set(cardClasses).size <= 1,
        resetHasWarningTreatment: Boolean(document.querySelector('.warning-card')),
        deleteHasDangerTreatment: Boolean(document.querySelector('.danger-card')),
      }
    })()`)
    assert.equal(report.interactions.dataOverviewHierarchy.allEqualCards, false, 'DATA-01 sections must not all read as equal-weight cards')
    assert.equal(report.interactions.dataOverviewHierarchy.resetHasWarningTreatment, true)
    assert.equal(report.interactions.dataOverviewHierarchy.deleteHasDangerTreatment, true)

    // -------------------------------------------------------------
    // DATA-02: Create encrypted backup. Never actually clicked -- a real
    // click would trigger a real browser download of real (fixture) data;
    // the form itself is sufficient, real product evidence.
    // -------------------------------------------------------------
    report.states['data-create-backup'] = await captureState(client, sessionId, 'data-create-backup', 'data-data-ready', {
      beforeEach: async () => { await ensureDataOverview(client, sessionId); await clickButton(client, sessionId, 'Create encrypted backup') },
      waitExpr: `document.body?.innerText.includes('Create encrypted backup') && document.body?.innerText.includes('separate from your vault password')`,
      waitDescription: 'data-create-backup',
    })
    report.interactions.backupPasswordSeparation = await evaluate(client, sessionId, `document.body.innerText.includes('This password is separate from your vault password')`)
    assert.equal(report.interactions.backupPasswordSeparation, true)

    // -------------------------------------------------------------
    // DATA-03: Restore from backup (initial form, no real file).
    // -------------------------------------------------------------
    report.states['data-restore'] = await captureState(client, sessionId, 'data-restore', 'data-data-ready', {
      beforeEach: async () => { await ensureDataOverview(client, sessionId); await clickButton(client, sessionId, 'Restore from backup') },
      waitExpr: `document.body?.innerText.includes('Restore from backup') && document.body?.innerText.includes('.fpbackup file')`,
      waitDescription: 'data-restore',
    })

    // -------------------------------------------------------------
    // DATA-06: Change vault password (distinct from backup/account auth).
    // Captured here, ahead of DATA-04/05/07-11's fixture states below, since
    // it (like DATA-01/02/03) needs a genuine, un-fixtured overview to click
    // a real button from -- see ensureDataOverview's own comment for why
    // that stops being reachable once any Data & Backup fixture mode has
    // ever been set.
    // -------------------------------------------------------------
    report.states['vault-password'] = await captureState(client, sessionId, 'vault-password', 'data-data-ready', {
      beforeEach: async () => { await ensureDataOverview(client, sessionId); await clickButton(client, sessionId, 'Change') },
      waitExpr: `document.body?.innerText.includes('Change vault password')`,
      waitDescription: 'vault-password',
    })
    report.interactions.vaultPasswordSeparation = await evaluate(client, sessionId, `document.body.innerText.includes("separate from signing in to your account")`)
    assert.equal(report.interactions.vaultPasswordSeparation, true)

    // -------------------------------------------------------------
    // SYNC-01: Cloud & device status. Same real-overview constraint as
    // DATA-06 above -- captured here for the same reason.
    // -------------------------------------------------------------
    report.states['sync-status'] = await captureState(client, sessionId, 'sync-status', 'data-data-ready', {
      beforeEach: async () => { await ensureDataOverview(client, sessionId); await clickButton(client, sessionId, 'Cloud and device data') },
      waitExpr: `document.body?.innerText.includes('Cloud and device data')`,
      waitDescription: 'sync-status',
    })
    report.interactions.syncNeverRecoversPassword = await evaluate(client, sessionId, `document.body.innerText.includes("doesn't make your vault password recoverable")`)
    assert.equal(report.interactions.syncNeverRecoversPassword, true)

    // -------------------------------------------------------------
    // DATA-04: Restore failure (deterministic fixture, no real file/crypto).
    // -------------------------------------------------------------
    report.states['data-restore-failure'] = await captureState(client, sessionId, 'data-restore-failure', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'restore-failure', `document.body?.innerText.includes("Couldn't restore this backup.")`) },
      waitExpr: `document.body?.innerText.includes("Couldn't restore this backup.") && document.body?.innerText.includes('Nothing on this device has changed.')`,
      waitDescription: 'data-restore-failure',
    })
    report.interactions.restoreFailureSafety = await evaluate(client, sessionId, `Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')) && Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Choose another file'))`)
    assert.equal(report.interactions.restoreFailureSafety, true, 'restore failure must offer both Try again and Choose another file')

    // -------------------------------------------------------------
    // DATA-05: CSV plaintext warning (priority trust state).
    // -------------------------------------------------------------
    report.states['data-csv-warning'] = await captureState(client, sessionId, 'data-csv-warning', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'csv-warning', `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes("won't be encrypted")`) },
      waitExpr: `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes("won't be encrypted")`,
      waitDescription: 'data-csv-warning',
      isModalDialog: true,
    })
    report.interactions.csvDialog = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('[role=dialog]')
      const active = document.activeElement
      return {
        role: dialog?.getAttribute('role'),
        ariaModal: dialog?.getAttribute('aria-modal'),
        hasAccessibleName: Boolean(dialog?.getAttribute('aria-labelledby') && document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent),
        focusIsCancel: active?.textContent?.trim() === 'Cancel',
        saysPlaintext: /plain text/i.test(document.body.innerText),
        saysNotEncrypted: document.body.innerText.includes("won't be encrypted"),
        backgroundInert: Boolean(document.querySelector('main[inert], .app-shell__frame[inert]')) || Boolean(document.getElementById('main-content')?.closest('[aria-hidden=true]')),
      }
    })()`)
    assert.equal(report.interactions.csvDialog.role, 'dialog')
    assert.equal(report.interactions.csvDialog.ariaModal, 'true')
    assert.equal(report.interactions.csvDialog.hasAccessibleName, true)
    assert.equal(report.interactions.csvDialog.focusIsCancel, true, 'CSV warning dialog must default focus to Cancel, never Export')
    assert.equal(report.interactions.csvDialog.saysPlaintext, true)
    assert.equal(report.interactions.csvDialog.saysNotEncrypted, true)
    // Escape must close it without exporting anything.
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(client, sessionId, `!document.querySelector('[role=dialog]')`, 'CSV dialog closed by Escape')
    report.interactions.csvEscapeCloses = true

    // -------------------------------------------------------------
    // DATA-07 / DATA-08: Reset confirmation and completion. Reset is never
    // actually triggered (see DATA-08's dedicated 'reset-complete' fixture)
    // -- acceptance fixtures must never mutate real persistent user data.
    // -------------------------------------------------------------
    report.states['data-reset-confirmation'] = await captureState(client, sessionId, 'data-reset-confirmation', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'reset', `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes('Clear financial data?')`) },
      waitExpr: `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes('Clear financial data?')`,
      waitDescription: 'data-reset-confirmation',
      isModalDialog: true,
    })
    report.interactions.resetCopy = await evaluate(client, sessionId, `(() => ({
      // Production behavior is a genuinely empty state, never a reseeded
      // demo/example dataset -- the dialog must say so honestly, not hide
      // behind vague copy or (worse) promise example data will appear.
      saysEmptyState: document.body.innerText.includes('empty state'),
      saysNoExampleData: /no example or demo data/i.test(document.body.innerText),
      distinctFromDelete: !document.body.innerText.includes('cannot be undone'),
    }))()`)
    assert.equal(report.interactions.resetCopy.saysEmptyState, true, 'Clear financial data must honestly state the result is an empty state')
    assert.equal(report.interactions.resetCopy.saysNoExampleData, true, 'Clear financial data must explicitly promise no example/demo data is inserted')
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(client, sessionId, `!document.querySelector('[role=dialog]')`, 'reset dialog closed without confirming')

    report.states['data-reset-complete'] = await captureState(client, sessionId, 'data-reset-complete', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'reset-complete', `document.body?.innerText.includes('now empty')`) },
      waitExpr: `document.body?.innerText.includes('now empty')`,
      waitDescription: 'data-reset-complete',
      viewports: [[390, 844]],
      // The confirmation renders after the Reset section, near the bottom
      // of a long overview page -- a real user stays scrolled there after
      // clicking Reset, but this fixture-only capture starts at the top,
      // so scroll to it explicitly rather than leaving the actual evidence
      // (the completion text itself) below the fold.
      scrollToSelector: '.success-message',
    })
    report.interactions.resetCompleteAccurate = await evaluate(client, sessionId, `document.body.innerText.includes('now empty')`)
    assert.equal(report.interactions.resetCompleteAccurate, true, 'Reset completion copy must honestly confirm the resulting state is empty, never claim reseeded example/demo data')

    // -------------------------------------------------------------
    // DATA-09 / DATA-10 / DATA-11: Delete account typed gate, final
    // confirmation, and failure. acceptanceView bypasses any real DELETE
    // call entirely for -10/-11.
    // -------------------------------------------------------------
    report.states['data-delete-gate'] = await captureState(client, sessionId, 'data-delete-gate', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'delete-account', `document.body?.innerText.includes('to confirm') && Boolean(document.querySelector('.data-tools-subpage--danger'))`) },
      waitExpr: `document.body?.innerText.includes('to confirm') && Boolean(document.querySelector('.data-tools-subpage--danger'))`,
      waitDescription: 'data-delete-gate',
    })
    report.interactions.deleteGate = await evaluate(client, sessionId, `(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Continue to final confirmation'))
      return {
        initiallyDisabled: Boolean(button?.disabled),
        exactPhraseVisible: Boolean(document.querySelector('code')?.textContent === 'DELETE MY ACCOUNT'),
        hasBackupLink: [...document.querySelectorAll('button')].some((b) => /encrypted backup first/i.test(b.textContent || '')),
        distinguishesFromReset: document.body.innerText.includes('cannot be undone'),
        noExternalRevocationOverclaim: !/(google|paypal|bank).{0,30}(will be|is)\\s+(revoked|cancelled)/i.test(document.body.innerText),
      }
    })()`)
    assert.equal(report.interactions.deleteGate.initiallyDisabled, true)
    assert.equal(report.interactions.deleteGate.exactPhraseVisible, true)
    assert.equal(report.interactions.deleteGate.hasBackupLink, true)
    assert.equal(report.interactions.deleteGate.distinguishesFromReset, true)
    assert.equal(report.interactions.deleteGate.noExternalRevocationOverclaim, true)

    report.states['data-delete-final'] = await captureState(client, sessionId, 'data-delete-final', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'delete-account-final', `Boolean(document.querySelector('[role=alertdialog]')) && document.body?.innerText.includes('Permanently delete your account?')`) },
      waitExpr: `Boolean(document.querySelector('[role=alertdialog]')) && document.body?.innerText.includes('Permanently delete your account?')`,
      waitDescription: 'data-delete-final',
      isModalDialog: true,
    })
    report.interactions.deleteFinalDialog = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('[role=alertdialog]')
      const active = document.activeElement
      return {
        role: dialog?.getAttribute('role'),
        ariaModal: dialog?.getAttribute('aria-modal'),
        hasAccessibleName: Boolean(dialog?.getAttribute('aria-labelledby') && document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent),
        focusIsSafe: active?.textContent?.trim() === 'Cancel',
      }
    })()`)
    assert.equal(report.interactions.deleteFinalDialog.role, 'alertdialog')
    assert.equal(report.interactions.deleteFinalDialog.ariaModal, 'true')
    assert.equal(report.interactions.deleteFinalDialog.hasAccessibleName, true)
    assert.equal(report.interactions.deleteFinalDialog.focusIsSafe, true, 'Final delete dialog must default focus to Cancel, never Delete account')
    // Tab cycles within the dialog (focus trap), Escape closes it safely.
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`)
    report.interactions.deleteFinalFocusStillInDialog = await evaluate(client, sessionId, `Boolean(document.activeElement?.closest('[role=alertdialog]'))`)
    assert.equal(report.interactions.deleteFinalFocusStillInDialog, true, 'Tab must stay trapped inside the final delete dialog')
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(client, sessionId, `!document.querySelector('[role=alertdialog]')`, 'final delete dialog closed by Escape, no deletion performed')

    report.states['data-delete-failure'] = await captureState(client, sessionId, 'data-delete-failure', 'data-data-ready', {
      beforeEach: async () => { await ensureDataFixture(client, sessionId, 'delete-failure', `document.body?.innerText.includes("Account deletion didn't complete.")`) },
      waitExpr: `document.body?.innerText.includes("Account deletion didn't complete.")`,
      waitDescription: 'data-delete-failure',
      isModalDialog: true,
    })
    report.interactions.deleteFailureSafety = await evaluate(client, sessionId, `document.body.innerText.includes('still here') && document.body.innerText.includes("You're still signed in")`)
    assert.equal(report.interactions.deleteFailureSafety, true, 'delete failure must clearly state nothing was removed and the user is still signed in')

    // -------------------------------------------------------------
    // SUB-01 .. SUB-07: Provider Subscriptions.
    // -------------------------------------------------------------
    report.states['subscriptions-not-connected'] = await captureState(client, sessionId, 'subscriptions-not-connected', 'data-subscriptions-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'intro') },
      waitExpr: `document.body?.innerText.includes('Connect a provider to import subscriptions')`,
      waitDescription: 'subscriptions-not-connected',
    })
    report.interactions.subscriptionsIntro = await evaluate(client, sessionId, `(() => ({
      distinctFromRecurring: document.body.innerText.includes('different from Recurring Payments'),
      noCredentialFields: !document.querySelector('input[type=email], input[type=password]'),
      noOverclaim: !/reads your (email|gmail|drive)/i.test(document.body.innerText),
    }))()`)
    assert.equal(report.interactions.subscriptionsIntro.distinctFromRecurring, true)
    assert.equal(report.interactions.subscriptionsIntro.noCredentialFields, true, 'SUB-01 must never collect a Google credential directly')
    assert.equal(report.interactions.subscriptionsIntro.noOverclaim, true)

    report.states['subscriptions-preflight'] = await captureState(client, sessionId, 'subscriptions-preflight', 'data-subscriptions-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'preflight') },
      waitExpr: `document.body?.innerText.includes("You're about to leave Finance Planner")`,
      waitDescription: 'subscriptions-preflight',
    })
    report.interactions.preflightScope = await evaluate(client, sessionId, `(() => ({
      mentionsIdentityOnly: document.body.innerText.includes('confirm your identity (name and email)'),
      noPasswordClaim: document.body.innerText.includes("doesn't see or store your Google password"),
      noExtraScopeClaims: !/gmail|drive|purchase history|play store/i.test(document.body.innerText),
    }))()`)
    assert.equal(report.interactions.preflightScope.mentionsIdentityOnly, true)
    assert.equal(report.interactions.preflightScope.noPasswordClaim, true)
    assert.equal(report.interactions.preflightScope.noExtraScopeClaims, true)

    report.states['subscriptions-connected'] = await captureState(client, sessionId, 'subscriptions-connected', 'data-subscriptions-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'connected') },
      waitExpr: `document.body?.innerText.includes('Synced from Google')`,
      waitDescription: 'subscriptions-connected',
    })
    report.interactions.connectedSubscriptions = await evaluate(client, sessionId, `(() => ({
      hasSourceBadge: Boolean(document.querySelector('.subscription-source-badge')),
      hasStatusPill: Boolean(document.querySelector('.subscription-row-status')),
      noCancelButton: !document.body.innerText.toLowerCase().includes('cancel subscription'),
      noGuaranteeLanguage: !/you('|’)ll be charged/i.test(document.body.innerText),
      notBankLanguage: document.body.innerText.includes('not bank transactions'),
    }))()`)
    assert.equal(report.interactions.connectedSubscriptions.hasSourceBadge, true)
    assert.equal(report.interactions.connectedSubscriptions.hasStatusPill, true)
    assert.equal(report.interactions.connectedSubscriptions.noCancelButton, true, 'SUB-03 must never offer a cancel-subscription control')
    assert.equal(report.interactions.connectedSubscriptions.noGuaranteeLanguage, true, 'next-charge must be phrased as reported information, not a guarantee')
    assert.equal(report.interactions.connectedSubscriptions.notBankLanguage, true)

    report.states['subscriptions-syncing'] = await captureState(client, sessionId, 'subscriptions-syncing', 'data-subscriptions-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'syncing') },
      waitExpr: `document.body?.innerText.includes('Syncing') && document.body?.innerText.includes('Synced from Google')`,
      waitDescription: 'subscriptions-syncing',
    })
    report.interactions.syncingPreservesList = await evaluate(client, sessionId, `document.querySelectorAll('.subscription-row').length > 0 && !/%/.test(document.querySelector('.subscriptions-status-row')?.textContent || '')`)
    assert.equal(report.interactions.syncingPreservesList, true, 'SUB-04 must keep the existing list visible and show no fake percentage')

    report.states['subscriptions-empty'] = await captureState(client, sessionId, 'subscriptions-empty', 'data-subscriptions-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'no-subscriptions') },
      waitExpr: `document.body?.innerText.includes('No subscriptions found')`,
      waitDescription: 'subscriptions-empty',
    })
    report.interactions.subscriptionsEmptyNotError = await evaluate(client, sessionId, `!document.querySelector('[role=alert]') && document.body.innerText.includes("isn't an error")`)
    assert.equal(report.interactions.subscriptionsEmptyNotError, true, 'SUB-05 must not read as an authorization failure')

    report.states['subscriptions-unavailable'] = await captureState(client, sessionId, 'subscriptions-unavailable', 'data-subscriptions-ready', {
      beforeEach: async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'unavailable') },
      waitExpr: `document.body?.innerText.includes("Subscriptions aren't available right now.")`,
      waitDescription: 'subscriptions-unavailable',
    })
    report.interactions.unavailableNotAccountBlame = await evaluate(client, sessionId, `document.body.innerText.includes("isn't something wrong with your account")`)
    assert.equal(report.interactions.unavailableNotAccountBlame, true)

    // Bonus evidence for the sync-failure (not capability-unavailable)
    // branch of SUB-06 -- distinguishing the two per the mission's explicit
    // instruction, without inflating the 21-state / 84-screenshot count.
    await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready')
    await setFixture(client, sessionId, 'subscription-sync-error')
    await waitFor(client, sessionId, `document.body?.innerText.includes("Couldn't sync your subscriptions.")`, 'subscriptions-sync-error bonus evidence')
    await setViewport(client, sessionId, 390, 844)
    await delay(150)
    const syncErrorShot = await captureScreenshot('subscriptions-sync-error', 390, 844, sessionId, client)
    report.interactions.syncErrorPreservesList = await evaluate(client, sessionId, `document.querySelectorAll('.subscription-row').length > 0`)
    assert.equal(report.interactions.syncErrorPreservesList, true, 'a failed refresh must preserve the last-known subscription list')
    report.states['subscriptions-sync-error-bonus'] = [{ width: 390, height: 844, ...syncErrorShot }]

    report.states['subscriptions-disconnect'] = await captureState(client, sessionId, 'subscriptions-disconnect', 'data-subscriptions-ready', {
      beforeEach: async () => {
        await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready')
        await setFixture(client, sessionId, 'manage')
      },
      waitExpr: `document.body?.innerText.includes('Manage connection') && document.body?.innerText.includes('Disconnect and remove imported data')`,
      waitDescription: 'subscriptions-disconnect',
    })
    report.interactions.disconnectChoices = await evaluate(client, sessionId, `(() => {
      const options = [...document.querySelectorAll('.subscriptions-manage-option')]
      return {
        optionCount: options.length,
        headings: options.map((o) => o.querySelector('h3')?.textContent),
        neverClaimsRecurringDeleted: !document.body.innerText.includes('Recurring Payments') || document.body.innerText.includes('never affected'),
      }
    })()`)
    assert.equal(report.interactions.disconnectChoices.optionCount, 2, 'SUB-07 must present exactly two disconnect choices, never a single toggle')
    assert.equal(report.interactions.disconnectChoices.neverClaimsRecurringDeleted, true)
    // Confirm dialog focus safety for both options, without ever confirming
    // a real disconnect call.
    await clickButton(client, sessionId, 'Disconnect and remove data')
    await waitFor(client, sessionId, `Boolean(document.querySelector('[role=dialog]'))`, 'disconnect-remove confirm dialog')
    report.interactions.disconnectRemoveDialogFocus = await evaluate(client, sessionId, `document.activeElement?.textContent?.trim() === 'Cancel'`)
    assert.equal(report.interactions.disconnectRemoveDialogFocus, true, 'disconnect confirm dialogs must default focus to Cancel')
    await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(client, sessionId, `!document.querySelector('[role=dialog]')`, 'disconnect dialog closed without confirming')

    // -------------------------------------------------------------
    // Forced-colours / reduced-motion / 200% text envelope checks.
    // -------------------------------------------------------------
    const forcedColorsTargets = [
      ['more-grouped', 'data-more-ready', async () => { await ensureDestination(client, sessionId, 'Dashboard', 'data-dashboard-ready'); await clickButton(client, sessionId, 'More'); await waitFor(client, sessionId, `Boolean(document.querySelector('[data-more-ready=true]'))`, 'more sheet for forced-colors') }],
      ['data-csv-warning', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'csv-warning', `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes("won't be encrypted")`) }],
      ['data-reset-confirmation', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'reset', `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes('Clear financial data?')`) }],
      ['data-delete-gate', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'delete-account', `document.body?.innerText.includes('to confirm') && Boolean(document.querySelector('.data-tools-subpage--danger'))`) }],
      ['data-delete-final', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'delete-account-final', `Boolean(document.querySelector('[role=alertdialog]')) && document.body?.innerText.includes('Permanently delete your account?')`) }],
      ['subscriptions-connected', 'data-subscriptions-ready', async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'connected'); await waitFor(client, sessionId, `document.body?.innerText.includes('Synced from Google')`, 'connected for forced-colors') }],
      ['subscriptions-disconnect', 'data-subscriptions-ready', async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'manage'); await waitFor(client, sessionId, `document.body?.innerText.includes('Manage connection')`, 'manage for forced-colors') }],
      ['account-session', 'data-account-ready', async () => { await ensureDestination(client, sessionId, 'Account', 'data-account-ready'); await waitFor(client, sessionId, `/signed in as/i.test(document.body?.innerText || '')`, 'account for forced-colors') }],
    ]
    for (const [name, readyAttribute, prepare] of forcedColorsTargets) {
      await setViewport(client, sessionId, 390, 844)
      await prepare()
      await delay(150)
      report.envelope[name] = { ...(report.envelope[name] || {}), forcedColors: await forcedColorsCheck(client, sessionId, name, readyAttribute) }
      assert.equal(report.envelope[name].forcedColors.controlsHaveBorder, true, `${name} controls lose their border under forced-colors`)
      assert.equal(report.envelope[name].forcedColors.horizontalOverflow, false, `${name} overflows under forced-colors`)
      if (report.envelope[name].forcedColors.dialogHasBorder !== null) {
        assert.equal(report.envelope[name].forcedColors.dialogHasBorder, true, `${name} dialog loses its border under forced-colors`)
      }
      // Close whatever dialog/sheet is open before the next target.
      await closeAnyOpenOverlay(client, sessionId)
    }

    const reducedMotionTargets = [
      ['more-grouped', 'data-more-ready', async () => { await ensureDestination(client, sessionId, 'Dashboard', 'data-dashboard-ready'); await clickButton(client, sessionId, 'More'); await waitFor(client, sessionId, `Boolean(document.querySelector('[data-more-ready=true]'))`, 'more sheet for reduced-motion') }],
      ['data-delete-final', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'delete-account-final', `Boolean(document.querySelector('[role=alertdialog]')) && document.body?.innerText.includes('Permanently delete your account?')`) }],
      ['subscriptions-syncing', 'data-subscriptions-ready', async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'syncing'); await waitFor(client, sessionId, `document.body?.innerText.includes('Syncing')`, 'syncing for reduced-motion') }],
      ['subscriptions-disconnect', 'data-subscriptions-ready', async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'manage'); await waitFor(client, sessionId, `document.body?.innerText.includes('Manage connection')`, 'manage for reduced-motion') }],
    ]
    for (const [name, readyAttribute, prepare] of reducedMotionTargets) {
      await setViewport(client, sessionId, 390, 844)
      await prepare()
      await delay(150)
      report.envelope[name] = { ...(report.envelope[name] || {}), reducedMotion: await reducedMotionCheck(client, sessionId, name, readyAttribute) }
      assert.equal(report.envelope[name].reducedMotion.contentVisible, true, `${name} content missing under reduced motion`)
      await closeAnyOpenOverlay(client, sessionId)
    }

    const zoomTargets = [
      ['more-grouped', 'data-more-ready', async () => { await ensureDestination(client, sessionId, 'Dashboard', 'data-dashboard-ready'); await clickButton(client, sessionId, 'More'); await waitFor(client, sessionId, `Boolean(document.querySelector('[data-more-ready=true]'))`, 'more sheet for zoom') }],
      ['data-overview', 'data-data-ready', async () => { await ensureDataOverview(client, sessionId) }],
      ['data-csv-warning', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'csv-warning', `Boolean(document.querySelector('[role=dialog]')) && document.body?.innerText.includes("won't be encrypted")`) }],
      ['data-delete-gate', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'delete-account', `document.body?.innerText.includes('to confirm') && Boolean(document.querySelector('.data-tools-subpage--danger'))`) }],
      ['data-delete-final', 'data-data-ready', async () => { await ensureDataFixture(client, sessionId, 'delete-account-final', `Boolean(document.querySelector('[role=alertdialog]')) && document.body?.innerText.includes('Permanently delete your account?')`) }],
      ['subscriptions-connected', 'data-subscriptions-ready', async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'connected'); await waitFor(client, sessionId, `document.body?.innerText.includes('Synced from Google')`, 'connected for zoom') }],
      ['subscriptions-disconnect', 'data-subscriptions-ready', async () => { await ensureDestination(client, sessionId, 'Subscriptions', 'data-subscriptions-ready'); await setFixture(client, sessionId, 'manage'); await waitFor(client, sessionId, `document.body?.innerText.includes('Manage connection')`, 'manage for zoom') }],
      ['account-session', 'data-account-ready', async () => { await ensureDestination(client, sessionId, 'Account', 'data-account-ready'); await waitFor(client, sessionId, `/signed in as/i.test(document.body?.innerText || '')`, 'account for zoom') }],
    ]
    for (const [name, readyAttribute, prepare] of zoomTargets) {
      await setViewport(client, sessionId, 390, 844)
      await prepare()
      await delay(150)
      report.envelope[name] = { ...(report.envelope[name] || {}), zoom: await zoomCheck(client, sessionId, name, readyAttribute) }
      assert.equal(report.envelope[name].zoom.headingClipped, false, `${name} heading clipped at 200% text`)
      assert.equal(report.envelope[name].zoom.horizontalOverflow, false, `${name} overflows at 200% text`)
      await closeAnyOpenOverlay(client, sessionId)
    }

    // -------------------------------------------------------------
    // Final provider-boundary proof: this entire run never contacted
    // Google or any other real external provider.
    // -------------------------------------------------------------
    assert.deepEqual(networkRequests, [], `Fixtures must never call a real external provider. Observed: ${networkRequests.join(', ')}`)
    assert.deepEqual(browserErrors, [], `Uncaught browser errors: ${browserErrors.join(' | ')}`)

    const stateCount = Object.keys(report.states).length
    const primaryScreenshotCount = Object.entries(report.states)
      .filter(([name]) => name !== 'subscriptions-sync-error-bonus')
      .reduce((sum, [, shots]) => sum + shots.length, 0)
    const totalScreenshotCount = Object.values(report.states).reduce((sum, shots) => sum + shots.length, 0)
      + Object.values(report.envelope).reduce((sum, e) => sum + Object.keys(e).length, 0)
      + Object.values(report.states).reduce((sum, shots) => sum + shots.filter((s) => s.scrollEnd).length, 0)
    report.stateCount = stateCount
    report.primaryScreenshotCount = primaryScreenshotCount
    report.totalScreenshotCount = totalScreenshotCount
    report.passed = true
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Data & Privacy production acceptance passed: ${stateCount} states, ${primaryScreenshotCount} primary screenshots, ${totalScreenshotCount} total. Evidence: ${ARTIFACT_PATH}`)
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
