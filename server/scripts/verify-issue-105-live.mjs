import assert from 'node:assert/strict'

const origin = String(process.env.VERIFY_APP_ORIGIN || '').replace(/\/$/, '')
const cookie = String(process.env.VERIFY_SESSION_COOKIE || '')
if (!origin.startsWith('https://')) throw new Error('VERIFY_APP_ORIGIN must be an HTTPS deployment origin.')
if (!cookie) throw new Error('VERIFY_SESSION_COOKIE is required for authenticated live verification.')

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { Accept: 'application/json', Cookie: cookie, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const text = await response.text()
  let payload = {}
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = { raw: text.slice(0, 300) } }
  }
  return { response, payload }
}

const ready = await request('/health/ready')
assert.equal(ready.response.status, 200, `Readiness failed: ${JSON.stringify(ready.payload)}`)

const bank = await request('/health/bank')
assert.ok([200, 503].includes(bank.response.status))
assert.ok(bank.payload && typeof bank.payload === 'object')

for (const provider of ['paypal', 'gocardless']) {
  if (process.env[`VERIFY_${provider.toUpperCase()}`] !== 'true') continue
  const started = await request(`/api/connectors/${provider}/start`, {
    method: 'POST',
    body: JSON.stringify({ redirectUri: `${origin}/connections?provider=${provider}` }),
  })
  assert.equal(started.response.status, 200, `${provider} start failed: ${JSON.stringify(started.payload)}`)
  assert.match(String(started.payload.redirectUrl || ''), /^https:\/\//)
  const redirect = new URL(started.payload.redirectUrl)
  assert.notEqual(redirect.origin, origin, `${provider} must use a provider-hosted authorization redirect.`)
  console.log(JSON.stringify({ provider, stage: 'authorization-start', redirectOrigin: redirect.origin, verified: true }))
}

if (process.env.VERIFY_GOOGLE_SUBSCRIPTIONS === 'true') {
  const started = await request('/api/subscriptions/google/start', {
    method: 'POST',
    body: JSON.stringify({ redirectUri: `${origin}/api/subscriptions/google/callback` }),
  })
  assert.equal(started.response.status, 200, `Google subscription start failed: ${JSON.stringify(started.payload)}`)
  assert.equal(new URL(started.payload.redirectUrl).origin, 'https://accounts.google.com')
  console.log(JSON.stringify({ provider: 'google-subscriptions', stage: 'authorization-start', verified: true }))
}

console.log(JSON.stringify({ issue: 105, origin, liveVerification: 'authorization-start-only', result: 'passed' }))
