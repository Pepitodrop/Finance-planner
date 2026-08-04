import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const APP_URL = new URL(process.env.LIVE_APP_URL || 'https://finance.luisbenedikt.de')
const OUTPUT_PATH = resolve(process.env.LIVE_SMOKE_ARTIFACT || 'artifacts/live-deployment-smoke.json')
const TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.LIVE_SMOKE_TIMEOUT_MS || 15_000)))

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  target: APP_URL.origin,
  checks: {},
  failures: [],
  warnings: [],
  providerDependent: {},
}

function record(name, passed, details = {}) {
  report.checks[name] = { passed, ...details }
  if (!passed) report.failures.push(name)
}

function warning(message) {
  report.warnings.push(message)
}

async function request(pathOrUrl, options = {}) {
  const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, APP_URL)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      redirect: options.redirect || 'manual',
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Finance-Planner-Live-Smoke/1.0',
        Accept: options.accept || '*/*',
        ...(options.headers || {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function responseBody(response) {
  const text = await response.text()
  try { return { text, json: text ? JSON.parse(text) : {} } } catch { return { text, json: null } }
}

function sameOriginReferences(html, attribute) {
  const values = []
  const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, 'gi')
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1], APP_URL)
      if (url.origin === APP_URL.origin) values.push(url)
    } catch {}
  }
  return [...new Map(values.map((url) => [url.href, url])).values()]
}

async function main() {
  try {
    const httpUrl = new URL(APP_URL)
    httpUrl.protocol = 'http:'
    const httpResponse = await request(httpUrl)
    const location = httpResponse.headers.get('location')
    const redirectTarget = location ? new URL(location, httpUrl) : null
    record('httpRedirectsToHttps', [301, 302, 307, 308].includes(httpResponse.status) && redirectTarget?.protocol === 'https:', {
      status: httpResponse.status,
      location,
    })
  } catch (error) {
    record('httpRedirectsToHttps', false, { error: String(error?.message || error) })
  }

  const rootResponse = await request(APP_URL)
  const root = await responseBody(rootResponse)
  const rootHeaders = Object.fromEntries(rootResponse.headers.entries())
  record('httpsFrontendLoads', rootResponse.status === 200 && /text\/html/i.test(rootHeaders['content-type'] || '') && /<html/i.test(root.text), {
    status: rootResponse.status,
    contentType: rootHeaders['content-type'],
  })

  const requiredHeaders = {
    'strict-transport-security': /max-age=\d+/i,
    'content-security-policy': /default-src/i,
    'x-content-type-options': /^nosniff$/i,
    'x-frame-options': /^(DENY|SAMEORIGIN)$/i,
    'referrer-policy': /no-referrer|strict-origin/i,
    'permissions-policy': /camera=/i,
  }
  const missingHeaders = Object.entries(requiredHeaders)
    .filter(([name, pattern]) => !pattern.test(rootHeaders[name] || ''))
    .map(([name]) => name)
  record('securityHeaders', missingHeaders.length === 0, { missing: missingHeaders })

  const cacheControl = rootHeaders['cache-control'] || ''
  record('entryDocumentRevalidates', /no-cache|no-store|max-age=0/i.test(cacheControl), { cacheControl })

  const manifestLinks = sameOriginReferences(root.text, 'href').filter((url) => /manifest/i.test(url.pathname))
  const scriptLinks = sameOriginReferences(root.text, 'src').filter((url) => /\.(?:js|mjs)(?:$|\?)/i.test(url.pathname))
  record('manifestLinked', manifestLinks.length === 1, { links: manifestLinks.map((url) => url.href) })
  record('applicationScriptsLinked', scriptLinks.length > 0, { count: scriptLinks.length })

  const assetResults = []
  for (const url of scriptLinks.slice(0, 12)) {
    const response = await request(url)
    assetResults.push({ url: url.pathname, status: response.status, cacheControl: response.headers.get('cache-control') })
  }
  record('applicationScriptsReachable', assetResults.length > 0 && assetResults.every((asset) => asset.status === 200), { assets: assetResults })

  const healthResponse = await request('/healthz', { accept: 'application/json' })
  const health = await responseBody(healthResponse)
  record('webHealth', healthResponse.status === 200 && health.json?.status === 'ok', { status: healthResponse.status, payload: health.json })

  const readyResponse = await request('/health/ready', { accept: 'application/json' })
  const ready = await responseBody(readyResponse)
  const readinessValid = readyResponse.status === 200
    && ready.json?.status === 'ready'
    && ready.json?.persistence === 'postgres'
    && ready.json?.distributedRateLimiting === true
    && ready.json?.version
    && ready.json?.commit
    && ready.json.commit !== 'unknown'
  record('connectorReadiness', readinessValid, {
    status: readyResponse.status,
    payload: ready.json,
  })

  const manifestUrl = manifestLinks[0] || new URL('/manifest.webmanifest', APP_URL)
  const manifestResponse = await request(manifestUrl, { accept: 'application/manifest+json,application/json' })
  const manifest = await responseBody(manifestResponse)
  const icons = Array.isArray(manifest.json?.icons) ? manifest.json.icons : []
  record('manifestValid', manifestResponse.status === 200
    && typeof manifest.json?.name === 'string'
    && typeof manifest.json?.start_url === 'string'
    && ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.json?.display)
    && icons.length > 0, {
    status: manifestResponse.status,
    display: manifest.json?.display,
    iconCount: icons.length,
  })

  const iconResults = []
  for (const icon of icons.slice(0, 8)) {
    try {
      const url = new URL(icon.src, manifestUrl)
      if (url.origin !== APP_URL.origin) continue
      const response = await request(url)
      iconResults.push({ url: url.pathname, status: response.status, contentType: response.headers.get('content-type') })
    } catch {}
  }
  record('manifestIconsReachable', iconResults.length > 0 && iconResults.every((icon) => icon.status === 200 && /^image\//i.test(icon.contentType || '')), { icons: iconResults })

  const workerResponse = await request('/sw.js', { accept: 'application/javascript,text/javascript' })
  const worker = await responseBody(workerResponse)
  const workerCache = workerResponse.headers.get('cache-control') || ''
  record('serviceWorkerReachable', workerResponse.status === 200 && worker.text.length > 100, {
    status: workerResponse.status,
    contentType: workerResponse.headers.get('content-type'),
  })
  record('serviceWorkerRevalidates', /no-cache|no-store|max-age=0/i.test(workerCache), { cacheControl: workerCache })

  const sessionResponse = await request('/api/auth/session', { accept: 'application/json' })
  const session = await responseBody(sessionResponse)
  record('anonymousSessionBoundary', sessionResponse.status === 200 && session.json?.authenticated === false && session.json?.user === null, {
    status: sessionResponse.status,
    payload: session.json,
  })

  const localSessionResponse = await request('/api/session/local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    accept: 'application/json',
  })
  const localSession = await responseBody(localSessionResponse)
  record('localAuthDisabled', localSessionResponse.status === 404, { status: localSessionResponse.status, payload: localSession.json })

  const protectedResponse = await request('/api/connectors/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    accept: 'application/json',
  })
  const protectedBody = await responseBody(protectedResponse)
  record('connectorRequiresAuthentication', protectedResponse.status === 401, { status: protectedResponse.status, payload: protectedBody.json })

  const googleResponse = await request('/api/auth/google/start')
  const googleLocation = googleResponse.headers.get('location')
  const googleRedirect = googleLocation ? new URL(googleLocation, APP_URL) : null
  report.providerDependent.googleLogin = {
    status: googleResponse.status,
    redirectHost: googleRedirect?.hostname,
    configuredRedirectVerified: googleResponse.status === 302 && googleRedirect?.protocol === 'https:' && googleRedirect.hostname === 'accounts.google.com',
    note: googleResponse.status === 302 ? 'Authorization start is configured; the real login flow was not completed.' : 'Authorization start is disabled or failed; credentials and callback configuration remain unverified.',
  }
  if (googleResponse.status === 302 && googleRedirect?.hostname !== 'accounts.google.com') warning('Google authorization redirected to an unexpected host.')

  const mixedContent = [...root.text.matchAll(/(?:src|href)=["'](http:\/\/[^"']+)/gi)].map((match) => match[1])
  record('noMixedContentReferences', mixedContent.length === 0, { references: mixedContent })
}

try {
  await main()
} catch (error) {
  report.failures.push('unhandledSmokeFailure')
  report.checks.unhandledSmokeFailure = { passed: false, error: String(error?.stack || error) }
} finally {
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}

console.log(JSON.stringify({ target: report.target, passed: report.failures.length === 0, failures: report.failures, warnings: report.warnings }))
if (report.failures.length) process.exitCode = 1
