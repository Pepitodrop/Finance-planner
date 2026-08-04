import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const ARTIFACT_PATH = resolve(process.env.ACCEPTANCE_ARTIFACT_PATH || 'artifacts/browser-production-acceptance.json')
const ARTIFACT_DIR = dirname(ARTIFACT_PATH)
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

async function captureDashboardEvidence(client, sessionId, width, height) {
  const mobile = width <= 768
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  }, sessionId)
  await evaluate(client, sessionId, `(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    document.querySelector('main#main-content')?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  })()`)
  await waitFor(client, sessionId, `(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const chartSignature = () => [...document.querySelectorAll('[data-dashboard-ready=true] svg path')].map((path) => path.getAttribute('d') || '').join('|')
    const before = chartSignature()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return innerWidth === ${width} && innerHeight === ${height} && Boolean(document.querySelector('[data-dashboard-ready=true]')) && before.length > 0 && before === chartSignature()
  })()`, `settled ${width}x${height} Dashboard`)

  const assertions = await evaluate(client, sessionId, `(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const visibleCurrent = [...document.querySelectorAll('nav [aria-current="page"]')].filter(visible)
    const visibleButton = (name) => [...document.querySelectorAll('button')].some((button) => button.textContent?.trim().includes(name) && visible(button))
    const visibleHeading = (name) => [...document.querySelectorAll('h2')].some((heading) => heading.textContent?.trim() === name && visible(heading))
    const dashboard = document.querySelector('[data-dashboard-ready="true"]')
    const addTransaction = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().includes('Add transaction') && visible(button))
    const mobileNavigation = [...document.querySelectorAll('nav')].find((navigation) => navigation.classList.contains('app-mobile-navigation') && visible(navigation))
    const unobscured = (element) => {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(topmost && (topmost === element || element.contains(topmost)))
    }
    return {
      dashboardExists: Boolean(dashboard),
      dashboardLanguage: dashboard?.getAttribute('lang'),
      currentNavigationItems: visibleCurrent.length,
      currentDestination: visibleCurrent[0]?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      modalOpen: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
      criticalConnectivityWarning: Boolean(document.querySelector('.mobile-connectivity-status')),
      optionalPrompt: Boolean(document.querySelector('.mobile-install-card, .passkey-enrolment, .platform-action-bar')),
      backgroundAnalysis: Boolean(document.querySelector('.automatic-analysis')),
      viewport: { width: innerWidth, height: innerHeight },
      addTransactionVisible: visibleButton('Add transaction') && unobscured(addTransaction),
      mobileNavigationUnobscured: !${mobile} || unobscured(mobileNavigation),
      projectionExists: visibleHeading('Balance projection'),
      accountsExists: visibleHeading('Accounts'),
      goalsExists: visibleHeading('Goals'),
      recentTransactionsExists: visibleHeading('Recent transactions'),
    }
  })()`)
  assert.equal(assertions.dashboardExists, true)
  assert.equal(assertions.dashboardLanguage, 'en')
  assert.equal(assertions.currentNavigationItems, 1)
  assert.match(assertions.currentDestination || '', /Dashboard/)
  assert.equal(assertions.horizontalOverflow, false)
  assert.equal(assertions.modalOpen, false)
  assert.equal(assertions.criticalConnectivityWarning, false)
  assert.equal(assertions.optionalPrompt, false)
  assert.equal(assertions.backgroundAnalysis, false)
  assert.deepEqual(assertions.viewport, { width, height })
  assert.equal(assertions.addTransactionVisible, true)
  assert.equal(assertions.mobileNavigationUnobscured, true)
  assert.equal(assertions.projectionExists, true)
  assert.equal(assertions.accountsExists, true)
  assert.equal(assertions.goalsExists, true)
  assert.equal(assertions.recentTransactionsExists, true)

  await mkdir(ARTIFACT_DIR, { recursive: true })
  const path = join(ARTIFACT_DIR, `dashboard-${width}x${height}.png`)
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  return { path, ...assertions }
}

async function captureTransactionsEvidence(client, sessionId, width, height) {
  const mobile = width <= 768
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height }, sessionId)
  await clickButton(client, sessionId, 'Transactions')
  await evaluate(client, sessionId, `(() => {
    const dateScope = document.querySelector('#transactions-desktop-filters select')
    if (!(dateScope instanceof HTMLSelectElement) || dateScope.value === 'all') return
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(dateScope, 'all')
    dateScope.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor(client, sessionId, `(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return innerWidth === ${width} && innerHeight === ${height} && Boolean(document.querySelector('[data-transactions-ready=true]')) && Boolean(document.querySelector('.transactions-desktop-table tbody tr, .transactions-mobile-list li'))
  })()`, `settled ${width}x${height} Transactions`)
  await evaluate(client, sessionId, `(() => { window.scrollTo(0, 0); document.querySelector('main#main-content')?.scrollTo(0, 0) })()`)

  const assertions = await evaluate(client, sessionId, `(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const unobscured = (element) => {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const point = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)))
      return Boolean(point && (point === element || element.contains(point)))
    }
    const root = document.querySelector('[data-transactions-ready=true]')
    const current = [...document.querySelectorAll('nav [aria-current="page"]')].filter(visible)
    const add = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Add transaction') && visible(button))
    const search = document.querySelector('input[aria-label="Search transactions"], .transactions-search input')
    const filters = [...document.querySelectorAll('.transactions-filter-trigger')].find(visible)
    const navigation = document.querySelector('.app-mobile-navigation')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: Boolean(root), language: root?.getAttribute('lang'), currentCount: current.length,
      currentDestination: current[0]?.textContent?.trim(), horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      modalOpen: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
      optionalPrompt: Boolean(document.querySelector('.mobile-install-card, .passkey-enrolment, .platform-action-bar, .automatic-analysis')),
      addVisible: visible(add) && unobscured(add), searchVisible: visible(search), filtersVisible: visible(filters),
      tableVisible: visible(document.querySelector('.transactions-desktop-table table')),
      listVisible: visible(document.querySelector('.transactions-mobile-list')),
      transactionRows: document.querySelectorAll('.transactions-desktop-table tbody tr').length,
      compactHeaderSingleLine: ${mobile} || innerWidth >= 1200 || [...document.querySelectorAll('.transactions-desktop-table th')].every((cell) => cell.getBoundingClientRect().height <= 46),
      compactMetadataVisible: ${mobile} || innerWidth >= 1200 || [...document.querySelectorAll('.transactions-desktop-table .transactions-compact-category')].some(visible),
      amountCellsWithinViewport: ${mobile} || [...document.querySelectorAll('.transactions-desktop-table .transactions-amount')].every((cell) => {
        const rect = cell.getBoundingClientRect()
        return visible(cell) && rect.left >= 0 && rect.right <= innerWidth
      }),
      desktopActionsWithinViewport: ${mobile} || [...document.querySelectorAll('.transactions-desktop-table .transactions-row-actions button')].every((button) => {
        const rect = button.getBoundingClientRect()
        return visible(button) && rect.left >= 0 && rect.right <= innerWidth
      }),
      mobileRowsConsistent: !${mobile} || [...document.querySelectorAll('.transactions-mobile-list li')].every((row) => {
        const trailing = row.querySelector('.transactions-mobile-trailing')
        const amount = trailing?.querySelector('.transactions-amount')
        const action = trailing?.querySelector('.transactions-row-actions button')
        const rowRect = row.getBoundingClientRect()
        const trailingRect = trailing?.getBoundingClientRect()
        return visible(trailing) && visible(amount) && visible(action) && trailingRect.left >= rowRect.left && trailingRect.right <= rowRect.right + 1
      }),
      searchPlaceholder: search?.getAttribute('placeholder'),
      searchControlFits: Boolean(search && search.getBoundingClientRect().right <= innerWidth && search.getBoundingClientRect().left >= 0),
      navigationOpaque: !${mobile} || (() => {
        const color = getComputedStyle(navigation).backgroundColor
        const alpha = color.match(/rgba?\\([^)]*?(?:,|\\s\\/)\\s*([0-9.]+)\\s*\\)$/)?.[1]
        return alpha === undefined || Number(alpha) >= 0.99
      })(),
      summaryVisible: visible(document.querySelector('.transactions-summary')),
      mobileNavigationVisible: !${mobile} || visible(navigation),
    }
  })()`)
  assert.deepEqual(assertions.viewport, { width, height })
  assert.equal(assertions.root, true)
  assert.equal(assertions.language, 'en')
  assert.equal(assertions.currentCount, 1)
  assert.match(assertions.currentDestination || '', /Transactions/)
  assert.equal(assertions.horizontalOverflow, false)
  assert.equal(assertions.modalOpen, false)
  assert.equal(assertions.optionalPrompt, false)
  assert.equal(assertions.addVisible, true)
  assert.equal(assertions.searchVisible, true)
  assert.equal(assertions.filtersVisible, true)
  assert.equal(assertions.summaryVisible, true)
  assert.equal(assertions.tableVisible, !mobile && width >= 1024)
  assert.equal(assertions.listVisible, mobile || width < 1024)
  assert.ok(assertions.transactionRows > 0)
  assert.equal(assertions.compactHeaderSingleLine, true)
  assert.equal(assertions.compactMetadataVisible, true)
  assert.equal(assertions.amountCellsWithinViewport, true)
  assert.equal(assertions.desktopActionsWithinViewport, true)
  assert.equal(assertions.mobileRowsConsistent, true)
  assert.equal(assertions.searchPlaceholder, 'Search')
  assert.equal(assertions.searchControlFits, true)
  assert.equal(assertions.navigationOpaque, true)
  assert.equal(assertions.mobileNavigationVisible, true)

  await mkdir(ARTIFACT_DIR, { recursive: true })
  const path = join(ARTIFACT_DIR, `transactions-${width}x${height}.png`)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  return { path, ...assertions }
}

async function setAccountsViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768, screenWidth: width, screenHeight: height }, sessionId)
  await waitFor(client,sessionId,`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return innerWidth===${width}&&innerHeight===${height}})()`,'settled Accounts navigation viewport')
  const navigated=await evaluate(client,sessionId,`(()=>{if(document.querySelector('[data-accounts-ready=true]'))return true;const visible=element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0};const target=[...document.querySelectorAll('nav button[aria-label="Accounts"]')].find(visible);if(!target)return false;target.click();return true})()`)
  assert.equal(navigated,true,'Visible Accounts navigation control not found')
  await waitFor(client, sessionId, `(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return innerWidth===${width}&&innerHeight===${height}&&Boolean(document.querySelector('[data-accounts-ready=true]'))})()`, `Accounts ${width}x${height}`)
}

async function accountsAssertions(client, sessionId, expectedMode = 'overview') {
  return evaluate(client, sessionId, `(() => {
    const visible=(element)=>{if(!(element instanceof Element))return false;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0}
    const root=document.querySelector('[data-accounts-ready=true]')
    const nav=[...document.querySelectorAll('nav [aria-current=page]')].filter(visible)
    const summary=document.querySelector('.accounts-summary')
    const values=summary?[...summary.querySelectorAll('strong')].map(item=>Number(item.textContent.replace(/[^0-9,-]/g,'').replaceAll('.','').replace(',','.'))):[]
    return {viewport:{width:innerWidth,height:innerHeight},root:Boolean(root),language:root?.getAttribute('lang'),current:nav.length,currentText:nav[0]?.textContent?.trim(),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,modal:Boolean(document.querySelector('[role=dialog][aria-modal=true]')),accountRows:document.querySelectorAll('.accounts-list li').length,summaryReconciles:values.length===3&&Math.abs((values[0]-values[1])-values[2])<0.001,detail:root?.getAttribute('data-account-detail')||'overview',empty:Boolean(document.querySelector('.accounts-empty')),bottomNav:visible(document.querySelector('.app-mobile-navigation'))||innerWidth>768}
  })()`)
}

async function captureAccountsEvidence(client, sessionId, width, height) {
  await setAccountsViewport(client, sessionId, width, height)
  const fixtureActivated=await evaluate(client,sessionId,`(()=>{if(document.querySelectorAll('.accounts-list li').length>=6)return false;if(typeof window.__financePlannerAcceptanceState!=='function')return null;window.__financePlannerAcceptanceState('accounts');return true})()`)
  assert.notEqual(fixtureActivated,null,'Accounts acceptance fixture hook unavailable')
  await waitFor(client,sessionId,`document.querySelectorAll('.accounts-list li').length>=6`,'Accounts fixture rows')
  const assertions=await accountsAssertions(client,sessionId)
  assert.deepEqual(assertions.viewport,{width,height});assert.equal(assertions.root,true);assert.equal(assertions.language,'en');assert.equal(assertions.current,1);assert.match(assertions.currentText||'',/Accounts/);assert.equal(assertions.overflow,false);assert.equal(assertions.modal,false);assert.ok(assertions.accountRows>=6);assert.equal(assertions.summaryReconciles,true);assert.equal(assertions.empty,false);assert.equal(assertions.bottomNav,true)
  const path=join(ARTIFACT_DIR,`accounts-${width}x${height}.png`);const screenshot=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},sessionId);await writeFile(path,screenshot.data,'base64');return{path,...assertions}
}

async function captureAccountDetailEvidence(client,sessionId,credit=false){
  await setAccountsViewport(client,sessionId,390,844)
  const selector=credit?'.accounts-section--liabilities .accounts-list button':'.accounts-section:not(.accounts-section--liabilities) .accounts-list button'
  await evaluate(client,sessionId,`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`)
  await waitFor(client,sessionId,`(()=>{const target=document.querySelector(${JSON.stringify(selector)}),rect=target?.getBoundingClientRect();return Boolean(rect&&rect.top>=0&&rect.bottom<=innerHeight)})()`,'visible account detail action')
  const focused=await evaluate(client,sessionId,`(()=>{const target=document.querySelector(${JSON.stringify(selector)});target.focus();return document.activeElement===target})()`)
  assert.equal(focused,true,'Account detail action could not receive focus')
  await client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13},sessionId)
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13},sessionId)
  await waitFor(client,sessionId,`document.querySelector('[data-account-detail="${credit?'credit-card':'checking'}"]')`,credit?'credit detail':'account detail')
  const assertions=await accountsAssertions(client,sessionId,credit?'credit-card':'checking')
  assert.equal(assertions.overflow,false);assert.equal(assertions.detail,credit?'credit-card':'checking');assert.equal(assertions.current,1)
  const optional=await evaluate(client,sessionId,`({owed:Boolean(document.body.innerText.includes('Amount owed')),available:Boolean(document.body.innerText.includes('Available credit')),transactions:Boolean(document.querySelector('.accounts-transactions'))})`)
  assert.equal(optional.transactions,true);if(credit){assert.equal(optional.owed,true);assert.equal(optional.available,true)}
  const path=join(ARTIFACT_DIR,credit?'credit-card-details-390x844.png':'account-details-390x844.png');const screenshot=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},sessionId);await writeFile(path,screenshot.data,'base64')
  await evaluate(client,sessionId,`document.querySelector('.accounts-back')?.click()`)
  await waitFor(client,sessionId,`Boolean(document.querySelector('.accounts-summary'))`,'Accounts overview restored after detail capture')
  return{path,...assertions,...optional}
}

async function captureAccountsEmptyEvidence(client,sessionId){
  await evaluate(client,sessionId,`window.__financePlannerAcceptanceState?.('empty')`);await setAccountsViewport(client,sessionId,390,844);await waitFor(client,sessionId,`Boolean(document.querySelector('.accounts-empty'))`,'Accounts empty state')
  const assertions=await accountsAssertions(client,sessionId);assert.equal(assertions.empty,true);assert.equal(assertions.accountRows,0);assert.equal(assertions.overflow,false)
  const path=join(ARTIFACT_DIR,'accounts-empty-390x844.png');const screenshot=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},sessionId);await writeFile(path,screenshot.data,'base64');await evaluate(client,sessionId,`window.__financePlannerAcceptanceState?.('accounts')`);return{path,...assertions}
}

async function captureAccountsFinalRowEvidence(client,sessionId){
  await setAccountsViewport(client,sessionId,390,844);await waitFor(client,sessionId,`document.querySelectorAll('.accounts-list li').length>=6`,'restored Accounts fixtures');await evaluate(client,sessionId,`window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);await waitFor(client,sessionId,`(()=>{const row=document.querySelector('.accounts-section--liabilities .accounts-list li:last-child')?.getBoundingClientRect(),nav=document.querySelector('.app-mobile-navigation')?.getBoundingClientRect();return Boolean(row&&nav&&row.bottom<=nav.top)})()`,'last account above navigation')
  const assertions=await evaluate(client,sessionId,`(()=>{const row=document.querySelector('.accounts-section--liabilities .accounts-list li:last-child'),button=row?.querySelector('button'),nav=document.querySelector('.app-mobile-navigation'),r=row?.getBoundingClientRect(),b=button?.getBoundingClientRect(),n=nav?.getBoundingClientRect();return{rowClear:Boolean(r&&n&&r.bottom<=n.top),actionClear:Boolean(b&&n&&b.bottom<=n.top),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);assert.equal(assertions.rowClear,true);assert.equal(assertions.actionClear,true);assert.equal(assertions.overflow,false)
  const path=join(ARTIFACT_DIR,'accounts-final-row-390x844.png');const screenshot=await client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},sessionId);await writeFile(path,screenshot.data,'base64');return{path,...assertions}
}

async function captureTransactionFinalRowEvidence(client, sessionId) {
  const width = 390
  const height = 844
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height }, sessionId)
  await clickButton(client, sessionId, 'Transactions')
  await waitFor(client, sessionId, `Boolean(document.querySelector('[data-transactions-ready=true] .transactions-mobile-list li:last-child'))`, 'final mobile transaction')
  await evaluate(client, sessionId, `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`)
  await waitFor(client, sessionId, `(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const row = document.querySelector('.transactions-mobile-list li:last-child')?.getBoundingClientRect()
    const nav = document.querySelector('.app-mobile-navigation')?.getBoundingClientRect()
    return Boolean(row && nav && row.bottom <= nav.top)
  })()`, 'final transaction above mobile navigation')
  const assertions = await evaluate(client, sessionId, `(() => {
    const row = document.querySelector('.transactions-mobile-list li:last-child')
    const action = row?.querySelector('.transactions-row-actions button')
    const pagination = document.querySelector('.transactions-pagination')
    const navigation = document.querySelector('.app-mobile-navigation')
    const rowRect = row?.getBoundingClientRect()
    const actionRect = action?.getBoundingClientRect()
    const navRect = navigation?.getBoundingClientRect()
    return {
      viewport: { width: innerWidth, height: innerHeight },
      finalRowAboveNavigation: Boolean(rowRect && navRect && rowRect.bottom <= navRect.top),
      finalActionVisible: Boolean(actionRect && navRect && actionRect.top >= 0 && actionRect.bottom <= navRect.top),
      paginationReachable: Boolean(pagination && pagination.getBoundingClientRect().bottom <= document.documentElement.scrollHeight),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })()`)
  assert.deepEqual(assertions.viewport, { width, height })
  assert.equal(assertions.finalRowAboveNavigation, true)
  assert.equal(assertions.finalActionVisible, true)
  assert.equal(assertions.paginationReachable, true)
  assert.equal(assertions.horizontalOverflow, false)
  const path = join(ARTIFACT_DIR, `transactions-final-row-${width}x${height}.png`)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  return { path, ...assertions }
}

async function captureTransactionFiltersEvidence(client, sessionId) {
  const width = 390
  const height = 844
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height }, sessionId)
  await clickButton(client, sessionId, 'Transactions')
  const triggerFocusedAfterClose = await evaluate(client, sessionId, `(async () => {
    const visible = (element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 }
    const trigger = [...document.querySelectorAll('.transactions-filter-trigger')].find(visible)
    trigger.click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const close = document.querySelector('button[aria-label="Close filters"]')
    close?.click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return document.activeElement === trigger
  })()`)
  assert.equal(triggerFocusedAfterClose, true)
  await clickButton(client, sessionId, 'Filters')
  await waitFor(client, sessionId, `Boolean(document.querySelector('.transactions-filter-sheet[role="dialog"][aria-modal="true"]'))`, 'mobile transaction filter sheet')
  const assertions = await evaluate(client, sessionId, `(() => {
    const sheet = document.querySelector('.transactions-filter-sheet')
    const rect = sheet?.getBoundingClientRect()
    return {
      viewport: { width: innerWidth, height: innerHeight }, dialog: sheet?.getAttribute('role'), modal: sheet?.getAttribute('aria-modal'),
      frameInert: document.querySelector('.app-shell__frame')?.hasAttribute('inert'), navigationInert: document.querySelector('.app-mobile-navigation')?.hasAttribute('inert'),
      withinViewport: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })()`)
  assert.deepEqual(assertions.viewport, { width, height })
  assert.equal(assertions.dialog, 'dialog')
  assert.equal(assertions.modal, 'true')
  assert.equal(assertions.frameInert, true)
  assert.equal(assertions.navigationInert, true)
  assert.equal(assertions.withinViewport, true)
  assert.equal(assertions.horizontalOverflow, false)
  const path = join(ARTIFACT_DIR, `transactions-filters-${width}x${height}.png`)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  await evaluate(client, sessionId, `document.querySelector('button[aria-label="Close filters"]')?.click()`)
  return { path, focusRestoredOnSeparateClose: triggerFocusedAfterClose, ...assertions }
}

async function captureRuntimeSurfaceStressEvidence(client, sessionId) {
  const width = 390
  const height = 844
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
  }, sessionId)
  await client.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: 'none',
  }, sessionId)
  await evaluate(client, sessionId, `window.dispatchEvent(new Event('offline'))`)
  await waitFor(client, sessionId, `document.body?.innerText.includes('Offline-Modus')`, 'offline runtime surface')
  await waitFor(client, sessionId, `(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return innerWidth === ${width} && innerHeight === ${height}
  })()`, 'settled runtime-surface stress viewport')

  const assertions = await evaluate(client, sessionId, `(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const navigation = [...document.querySelectorAll('nav')].find((item) => item.classList.contains('app-mobile-navigation') && visible(item))
    const surface = [...document.querySelectorAll('.mobile-runtime__banner')].find((item) => item.textContent?.includes('Offline-Modus') && visible(item))
    const dashboard = document.querySelector('[data-dashboard-ready="true"]')
    const navigationRect = navigation?.getBoundingClientRect()
    const surfaceRect = surface?.getBoundingClientRect()
    const topmost = navigationRect ? document.elementFromPoint(navigationRect.left + navigationRect.width / 2, navigationRect.top + navigationRect.height / 2) : null
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dashboardExists: Boolean(dashboard),
      offlineSurfaceVisible: Boolean(surface),
      surfaceClearsNavigation: Boolean(surfaceRect && navigationRect && surfaceRect.bottom <= navigationRect.top),
      mobileNavigationUnobscured: Boolean(navigation && topmost && (topmost === navigation || navigation.contains(topmost))),
      optionalPrompt: Boolean(document.querySelector('.mobile-install-card, .passkey-enrolment, .platform-action-bar')),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })()`)
  assert.deepEqual(assertions.viewport, { width, height })
  assert.equal(assertions.dashboardExists, true)
  assert.equal(assertions.offlineSurfaceVisible, true)
  assert.equal(assertions.surfaceClearsNavigation, true)
  assert.equal(assertions.mobileNavigationUnobscured, true)
  assert.equal(assertions.optionalPrompt, false)
  assert.equal(assertions.horizontalOverflow, false)

  const path = join(ARTIFACT_DIR, `runtime-surfaces-${width}x${height}.png`)
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId)
  await writeFile(path, screenshot.data, 'base64')
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'wifi',
  }, sessionId)
  await evaluate(client, sessionId, `window.dispatchEvent(new Event('online'))`)
  await waitFor(client, sessionId, `!document.body?.innerText.includes('Offline-Modus')`, 'online recovery after runtime-surface stress')
  return { path, ...assertions }
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
    await evaluate(client, sessionId, `(() => {
      localStorage.setItem('finance-planner-passkey-prompt-dismissed-v1', 'true')
      localStorage.setItem('finance-planner-install-dismissed-until', String(Date.now() + 24 * 60 * 60 * 1000))
    })()`)
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

    report.checks.backendHealth = await evaluate(client, sessionId, `(async () => {
      const response = await fetch('/health/live', { cache: 'no-store', credentials: 'same-origin' })
      const payload = await response.json().catch(() => null)
      return { ok: response.ok, status: response.status, serviceStatus: payload?.status }
    })()`)
    assert.deepEqual(report.checks.backendHealth, { ok: true, status: 200, serviceStatus: 'ok' })
    await waitFor(client, sessionId, 'Boolean(document.querySelector(".automatic-analysis"))', 'automatic analysis completion status')
    await waitFor(client, sessionId, '!document.querySelector(".automatic-analysis")', 'automatic analysis status dismissal')
    await waitFor(client, sessionId, '!document.querySelector(".mobile-connectivity-status, .mobile-install-card, .passkey-enrolment, .platform-action-bar")', 'clean Dashboard runtime state')

    report.checks.dashboardScreenshots = []
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [360, 800]]) {
      report.checks.dashboardScreenshots.push(await captureDashboardEvidence(client, sessionId, width, height))
    }
    report.checks.runtimeSurfaceStress = await captureRuntimeSurfaceStressEvidence(client, sessionId)
    report.checks.accountsScreenshots = []
    for (const [width,height] of [[1440,900],[1024,768],[390,844],[360,800]]) report.checks.accountsScreenshots.push(await captureAccountsEvidence(client,sessionId,width,height))
    report.checks.accountDetail = await captureAccountDetailEvidence(client,sessionId,false)
    report.checks.creditCardDetail = await captureAccountDetailEvidence(client,sessionId,true)
    report.checks.accountsEmpty = await captureAccountsEmptyEvidence(client,sessionId)
    report.checks.accountsFinalRow = await captureAccountsFinalRowEvidence(client,sessionId)
    report.checks.transactionsScreenshots = []
    for (const [width, height] of [[1440, 900], [1024, 768], [430, 932], [390, 844], [360, 800]]) {
      report.checks.transactionsScreenshots.push(await captureTransactionsEvidence(client, sessionId, width, height))
    }
    report.checks.transactionsFilterSheet = await captureTransactionFiltersEvidence(client, sessionId)
    report.checks.transactionsFinalRow = await captureTransactionFinalRowEvidence(client, sessionId)
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 900,
    }, sessionId)

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
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Browser production acceptance passed. Evidence: ${ARTIFACT_PATH}`)
  } catch (error) {
    report.passed = false
    report.failure = error instanceof Error ? error.stack || error.message : String(error)
    await mkdir(ARTIFACT_DIR, { recursive: true })
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
