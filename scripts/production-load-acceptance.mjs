import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'

const webUrl = new URL(process.env.LOAD_WEB_URL || 'http://127.0.0.1:4173/')
const connectorUrl = new URL(process.env.LOAD_CONNECTOR_URL || 'http://127.0.0.1:8788/health/live')
const artifactPath = process.env.LOAD_ARTIFACT_PATH || 'artifacts/production-load-acceptance.json'
const durationMs = Number(process.env.LOAD_DURATION_MS || 12_000)
const concurrency = Number(process.env.LOAD_CONCURRENCY || 20)
const connectorIntervalMs = Number(process.env.LOAD_CONNECTOR_INTERVAL_MS || 750)
const maximumErrorRate = Number(process.env.LOAD_MAX_ERROR_RATE || 0.01)
const maximumP95Ms = Number(process.env.LOAD_MAX_P95_MS || 500)
const minimumWebRequestsPerSecond = Number(process.env.LOAD_MIN_WEB_RPS || 40)

if (!Number.isFinite(durationMs) || durationMs < 1_000) throw new Error('LOAD_DURATION_MS must be at least 1000.')
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) throw new Error('LOAD_CONCURRENCY must be between 1 and 200.')

const samples = { web: [], connector: [] }

async function measuredFetch(target, bucket, options = {}) {
  const started = performance.now()
  let status = 0
  let error = null
  try {
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(5_000), ...options })
    status = response.status
    await response.arrayBuffer()
    if (!response.ok) error = `HTTP ${response.status}`
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  bucket.push({ durationMs: performance.now() - started, status, error })
}

async function webWorker(deadline) {
  while (performance.now() < deadline) await measuredFetch(webUrl, samples.web, { headers: { Accept: 'text/html' } })
}

async function connectorWorker(deadline) {
  while (performance.now() < deadline) {
    await measuredFetch(connectorUrl, samples.connector, { headers: { Accept: 'application/json' } })
    await new Promise((resolve) => setTimeout(resolve, connectorIntervalMs))
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function summarize(entries, elapsedMs) {
  const failures = entries.filter((entry) => entry.error)
  const durations = entries.map((entry) => entry.durationMs)
  return {
    requests: entries.length,
    failures: failures.length,
    errorRate: entries.length ? failures.length / entries.length : 1,
    requestsPerSecond: entries.length / (elapsedMs / 1_000),
    latencyMs: {
      min: durations.length ? Math.min(...durations) : 0,
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations.length ? Math.max(...durations) : 0,
    },
    statusCounts: Object.fromEntries([...new Set(entries.map((entry) => entry.status))].sort().map((status) => [status, entries.filter((entry) => entry.status === status).length])),
    sampleErrors: failures.slice(0, 5).map((entry) => entry.error),
  }
}

const startedAt = new Date().toISOString()
const started = performance.now()
const deadline = started + durationMs
await Promise.all([
  ...Array.from({ length: concurrency }, () => webWorker(deadline)),
  connectorWorker(deadline),
])
const elapsedMs = performance.now() - started

const report = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  configuration: { durationMs, concurrency, connectorIntervalMs, maximumErrorRate, maximumP95Ms, minimumWebRequestsPerSecond },
  targets: { web: webUrl.toString(), connector: connectorUrl.toString() },
  results: {
    web: summarize(samples.web, elapsedMs),
    connector: summarize(samples.connector, elapsedMs),
  },
}

report.passed = report.results.web.errorRate <= maximumErrorRate
  && report.results.connector.errorRate <= maximumErrorRate
  && report.results.web.latencyMs.p95 <= maximumP95Ms
  && report.results.connector.latencyMs.p95 <= maximumP95Ms
  && report.results.web.requestsPerSecond >= minimumWebRequestsPerSecond

await mkdir(dirname(artifactPath), { recursive: true })
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
