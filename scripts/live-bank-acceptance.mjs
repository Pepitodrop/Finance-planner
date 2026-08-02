import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const baseUrl = process.env.ACCEPTANCE_CONNECTOR_URL
const token = process.env.ACCEPTANCE_BEARER_TOKEN
const connectionId = process.env.ACCEPTANCE_CONNECTION_ID
const output = process.env.BANK_ACCEPTANCE_OUTPUT || 'artifacts/live-bank-acceptance.json'
const requireLive = process.env.REQUIRE_LIVE_BANK_ACCEPTANCE === 'true'

async function request(path, options = {}) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: response.status, body, latencyMs: Math.round(performance.now() - started) }
}

const report = {
  schemaVersion: 1,
  executedAt: new Date().toISOString(),
  mode: requireLive ? 'required-live' : 'optional-live',
  privacy: { rawTransactionsPersisted: false, credentialsPersisted: false },
  checks: {},
}

if (!baseUrl || !token || !connectionId) {
  report.status = 'skipped'
  report.reason = 'ACCEPTANCE_CONNECTOR_URL, ACCEPTANCE_BEARER_TOKEN and ACCEPTANCE_CONNECTION_ID are required'
  await mkdir('artifacts', { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  if (requireLive) throw new Error(report.reason)
  console.log(report.reason)
  process.exit(0)
}

const health = await request('/health/ready')
assert.equal(health.status, 200, 'connector readiness failed')
report.checks.readiness = { status: 'passed', latencyMs: health.latencyMs }

const before = await request(`/api/connections/${encodeURIComponent(connectionId)}`)
assert.equal(before.status, 200, 'connection lookup failed')
report.checks.connection = {
  status: 'passed',
  provider: before.body?.provider || 'unknown',
  consentStatus: before.body?.consentStatus || before.body?.status || 'unknown',
}

const sync = await request(`/api/connections/${encodeURIComponent(connectionId)}/sync`, { method: 'POST' })
assert.ok([200, 202].includes(sync.status), `sync failed with HTTP ${sync.status}`)
report.checks.sync = {
  status: 'passed',
  latencyMs: sync.latencyMs,
  imported: Number(sync.body?.imported || sync.body?.transactionCount || 0),
  duplicatesSkipped: Number(sync.body?.duplicatesSkipped || 0),
}

const after = await request(`/api/connections/${encodeURIComponent(connectionId)}`)
assert.equal(after.status, 200, 'post-sync connection lookup failed')
report.checks.postSync = {
  status: 'passed',
  lastSuccessfulSyncAt: after.body?.lastSuccessfulSyncAt || after.body?.lastSyncAt || null,
  nextSyncAt: after.body?.nextSyncAt || null,
  error: after.body?.lastError ? 'present' : null,
}
assert.equal(report.checks.postSync.error, null, 'connection reports a post-sync error')

report.status = 'passed'
await mkdir('artifacts', { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
console.log(`Live bank acceptance passed for connection ${connectionId}`)
