import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const outputPath = process.env.PROVIDER_CANARY_OUTPUT || 'artifacts/provider-runtime-canary.json'
const requireAll = process.env.PROVIDER_CANARY_REQUIRE_ALL === 'true'
const timeoutMs = Math.max(3_000, Math.min(30_000, Number(process.env.PROVIDER_CANARY_TIMEOUT_MS || 10_000)))

async function requestJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = performance.now()
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let payload = {}
    try { payload = text ? JSON.parse(text) : {} } catch { payload = {} }
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`)
    return { payload, latencyMs: Math.round(performance.now() - startedAt) }
  } finally {
    clearTimeout(timeout)
  }
}

async function goCardlessCanary() {
  if (!process.env.GOCARDLESS_SECRET_ID || !process.env.GOCARDLESS_SECRET_KEY) return { configured: false, status: 'skipped' }
  const token = await requestJson('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: process.env.GOCARDLESS_SECRET_ID, secret_key: process.env.GOCARDLESS_SECRET_KEY }),
  })
  assert.equal(typeof token.payload.access, 'string')
  const institutions = await requestJson('https://bankaccountdata.gocardless.com/api/v2/institutions/?country=DE', {
    headers: { Authorization: `Bearer ${token.payload.access}` },
  })
  assert.ok(Array.isArray(institutions.payload) && institutions.payload.length > 0)
  return {
    configured: true,
    status: 'passed',
    tokenLatencyMs: token.latencyMs,
    institutionsLatencyMs: institutions.latencyMs,
    institutionCount: institutions.payload.length,
  }
}

async function paypalCanary() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return { configured: false, status: 'skipped' }
  const base = process.env.PAYPAL_ENVIRONMENT === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  const authorization = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const token = await requestJson(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  assert.equal(typeof token.payload.access_token, 'string')
  assert.ok(Number(token.payload.expires_in) > 0)
  return { configured: true, status: 'passed', environment: process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox', latencyMs: token.latencyMs }
}

const report = {
  schemaVersion: 1,
  validatedAt: new Date().toISOString(),
  privacy: {
    financialRecordsRead: false,
    accountConsentCreated: false,
    credentialsPersisted: false,
    responseBodiesPersisted: false,
  },
  providers: {},
}

for (const [name, canary] of [['gocardless', goCardlessCanary], ['paypal', paypalCanary]]) {
  try {
    report.providers[name] = await canary()
  } catch (error) {
    report.providers[name] = { configured: true, status: 'failed', error: String(error?.message || error).slice(0, 200) }
  }
}

await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })

const failed = Object.entries(report.providers).filter(([, provider]) => provider.status === 'failed')
const skipped = Object.entries(report.providers).filter(([, provider]) => provider.status === 'skipped')
assert.equal(failed.length, 0, `Provider canary failures: ${failed.map(([name]) => name).join(', ')}`)
if (requireAll) assert.equal(skipped.length, 0, `Required provider secrets are missing: ${skipped.map(([name]) => name).join(', ')}`)
console.log(`Provider runtime canaries completed: ${JSON.stringify(Object.fromEntries(Object.entries(report.providers).map(([name, value]) => [name, value.status])))}`)
