import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.ACCEPTANCE_CONNECTOR_URL || 'http://127.0.0.1:8788'
const artifact = process.env.BACKEND_RESILIENCE_ARTIFACT || 'artifacts/backend-resilience.json'
const startedAt = Date.now()
const results = []

async function probe(name, path, init = {}, expected = [200]) {
  const start = performance.now()
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) })
  const latencyMs = Math.round(performance.now() - start)
  const body = await response.text()
  if (!expected.includes(response.status)) throw new Error(`${name}: expected ${expected.join('/')} but received ${response.status}: ${body.slice(0, 300)}`)
  if (response.headers.get('x-content-type-options') !== 'nosniff') throw new Error(`${name}: missing nosniff header`)
  if (!response.headers.get('x-request-id')) throw new Error(`${name}: missing request id`)
  results.push({ name, status: response.status, latencyMs })
  return response
}

await probe('readiness', '/health/ready')
const session = await probe('local-session', '/api/session/local', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
})
const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
if (!cookie) throw new Error('Local acceptance session did not return a session cookie.')
const authenticatedHeaders = { cookie }

await probe('invalid-json', '/api/finance/project-savings', {
  method: 'POST',
  headers: { ...authenticatedHeaders, 'content-type': 'application/json' },
  body: '{',
}, [400])
await probe('unsupported-media', '/api/finance/project-savings', {
  method: 'POST',
  headers: { ...authenticatedHeaders, 'content-type': 'text/plain' },
  body: 'x',
}, [415])
await probe('oversized-payload', '/api/finance/project-savings', {
  method: 'POST',
  headers: { ...authenticatedHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ value: 'x'.repeat(1_010_000) }),
}, [413])

const concurrent = await Promise.all(Array.from({ length: 40 }, (_, index) => probe(`concurrent-${index}`, '/health/live')))
if (concurrent.some((response) => response.status !== 200)) throw new Error('Concurrent liveness probes were not all successful.')
const p95 = [...results].map((item) => item.latencyMs).sort((a, b) => a - b)[Math.floor(results.length * 0.95)] || 0
if (p95 > 1500) throw new Error(`Backend resilience p95 ${p95}ms exceeded 1500ms.`)

const report = { generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, requestCount: results.length, p95LatencyMs: p95, checks: results }
await mkdir(artifact.slice(0, artifact.lastIndexOf('/')), { recursive: true })
await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report))
