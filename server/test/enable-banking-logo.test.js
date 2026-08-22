import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createOpenBankingProviderRegistry, fetchBoundedImage } from '../src/providers.js'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

function fakeBankingCore() {
  return { async validateReadOnlyScope() { return true } }
}

function eligibleEnv(overrides = {}) {
  return { ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey, ...overrides }
}

function withRestoredFetch(run) {
  const originalFetch = globalThis.fetch
  return run().finally(() => { globalThis.fetch = originalFetch })
}

function enableBankingAdapter(env = eligibleEnv()) {
  return createOpenBankingProviderRegistry(env, fakeBankingCore()).get('enablebanking')
}

function pngBytes(size = 10) {
  return new Uint8Array(size).fill(1)
}

// --- institutionLogoUrl(): URL resolution + validation, no network fetch ---

test('institutionLogoUrl() prefers the exact ASPSP logo when it is a valid, allowed URL', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) {
      return new Response(JSON.stringify({
        aspsps: [{ name: 'Volksbank Köln Bonn', country: 'DE', logo: 'https://enablebanking.com/brands/DE/Volksbank%20Koeln%20Bonn/', group: { name: 'Volksbanken Raiffeisenbanken', logo: 'https://enablebanking.com/brands/DE/Volksbanken%20Raiffeisenbanken/' } }],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  const url = await adapter.institutionLogoUrl('DE:Volksbank Köln Bonn')
  assert.equal(url, 'https://enablebanking.com/brands/DE/Volksbank%20Koeln%20Bonn/')
}))

test('institutionLogoUrl() falls back to the cooperative-group logo when the bank has no logo of its own', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) {
      return new Response(JSON.stringify({
        aspsps: [{ name: 'Semper Bank AG', country: 'DE', group: { name: 'Volksbanken Raiffeisenbanken', logo: 'https://enablebanking.com/brands/DE/Volksbanken%20Raiffeisenbanken/' } }],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  const url = await adapter.institutionLogoUrl('DE:Semper Bank AG')
  assert.equal(url, 'https://enablebanking.com/brands/DE/Volksbanken%20Raiffeisenbanken/')
}))

test('institutionLogoUrl() falls back to the group logo when the ASPSP\'s own logo is malformed/off-allowlist, rather than failing outright', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) {
      return new Response(JSON.stringify({
        aspsps: [{ name: 'Semper Bank AG', country: 'DE', logo: 'https://evil.example/steal.png', group: { name: 'Volksbanken Raiffeisenbanken', logo: 'https://enablebanking.com/brands/DE/Volksbanken%20Raiffeisenbanken/' } }],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  const url = await adapter.institutionLogoUrl('DE:Semper Bank AG')
  assert.equal(url, 'https://enablebanking.com/brands/DE/Volksbanken%20Raiffeisenbanken/')
}))

test('institutionLogoUrl() returns null (never throws) when neither the bank nor its group has a usable logo', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'Trade Republic Bank', country: 'DE' }] }), { status: 200 })
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.institutionLogoUrl('DE:Trade Republic Bank'), null)
}))

test('institutionLogoUrl() rejects a non-HTTPS logo URL', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'http://enablebanking.com/brands/DE/ING/' }] }), { status: 200 })
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.institutionLogoUrl('DE:ING-DiBa'), null)
}))

test('institutionLogoUrl() rejects a logo URL on an unexpected hostname, never trusting an arbitrary provider-claimed domain', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'https://not-enablebanking.example/brands/DE/ING/' }] }), { status: 200 })
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.institutionLogoUrl('DE:ING-DiBa'), null)
}))

test('institutionLogoUrl() rejects a malformed logo URL string', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'not a url at all' }] }), { status: 200 })
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.institutionLogoUrl('DE:ING-DiBa'), null)
}))

test('institutionLogoUrl() rejects a logo URL carrying embedded userinfo, even on an otherwise-allowed host', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'https://user:pass@enablebanking.com/brands/DE/ING/' }] }), { status: 200 })
    throw new Error(`Unexpected URL: ${input}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.institutionLogoUrl('DE:ING-DiBa'), null)
}))

// The endpoint only ever accepts an institutionId, never a URL -- proving a
// bogus/unmatched institutionId can't be used to reach any URL at all
// (arbitrary or otherwise) is what actually rules out "proxy any URL".
test('institutionLogoUrl() cannot be made to proxy anything for an institutionId that doesn\'t match a real, live ASPSP', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'https://enablebanking.com/brands/DE/ING/' }] }), { status: 200 })
    throw new Error(`Unexpected URL in a request that must never happen: ${input}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.institutionLogoUrl('DE:Not A Real Bank'), null)
  assert.equal(await adapter.institutionLogoUrl('not-encoded'), null)
  assert.equal(await adapter.institutionLogoUrl(''), null)
}))

test('institutionLogoUrl() fails closed (null) when Enable Banking is not configured, never attempting a fetch', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => { throw new Error(`must not be called when unconfigured: ${input}`) }
  const adapter = enableBankingAdapter({})
  assert.equal(await adapter.institutionLogoUrl('DE:ING-DiBa'), null)
}))

// --- fetchBoundedImage(): the bounded-fetch mechanics ---

const ENABLEBANKING_HOSTNAMES = new Set(['enablebanking.com'])

test('fetchBoundedImage() returns the image body and content-type for a valid, allowed, small PNG', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '10' } })
  const image = await fetchBoundedImage('https://enablebanking.com/brands/DE/ING/', { allowedHostnames: ENABLEBANKING_HOSTNAMES })
  assert.equal(image.contentType, 'image/png')
  assert.equal(image.body.length, 10)
}))

test('fetchBoundedImage() rejects a non-image Content-Type', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response('<html>not an image</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() rejects SVG explicitly -- raster formats only, so an <img> that were ever loaded as a top-level navigation could never execute embedded script', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response('<svg onload="alert(1)"></svg>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() rejects a response whose declared Content-Length exceeds the byte cap', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(50_000_000) } })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, maxBytes: 1_000_000 }), null)
}))

test('fetchBoundedImage() rejects an oversized body even when Content-Length under-reports or is absent -- bounded by the actual byte stream', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(pngBytes(2_000), { status: 200, headers: { 'content-type': 'image/png' } })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, maxBytes: 1_000 }), null)
}))

test('fetchBoundedImage() rejects the initial URL outright when its hostname is not on the allowlist', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must never fetch an off-allowlist host') }
  assert.equal(await fetchBoundedImage('https://not-enablebanking.example/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() rejects a non-HTTPS initial URL', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must never fetch a non-https URL') }
  assert.equal(await fetchBoundedImage('http://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() follows a redirect that stays on the allowed hostname', () => withRestoredFetch(async () => {
  let calls = 0
  globalThis.fetch = async (input) => {
    calls += 1
    if (String(input) === 'https://enablebanking.com/x') return new Response(null, { status: 302, headers: { location: 'https://enablebanking.com/y' } })
    if (String(input) === 'https://enablebanking.com/y') return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } })
    throw new Error(`Unexpected URL: ${input}`)
  }
  const image = await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES })
  assert.ok(image)
  assert.equal(calls, 2)
}))

test('fetchBoundedImage() refuses to follow a redirect off the allowed hostname -- an off-allowlist Location header is rejected, never fetched', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://enablebanking.com/x') return new Response(null, { status: 302, headers: { location: 'https://attacker.example/steal' } })
    throw new Error(`must never fetch the redirect target: ${input}`)
  }
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() refuses to follow a redirect from https down to a non-https target', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://enablebanking.com/x') return new Response(null, { status: 302, headers: { location: 'http://enablebanking.com/y' } })
    throw new Error(`must never fetch the redirect target: ${input}`)
  }
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() gives up after exceeding the maximum redirect count, never following forever', () => withRestoredFetch(async () => {
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'https://enablebanking.com/next' } }) }
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, maxRedirects: 2 }), null)
  assert.equal(calls, 3) // initial attempt + 2 redirects, then give up
}))

test('fetchBoundedImage() bounds an entire redirect chain by one overall deadline, not timeoutMs per hop', () => withRestoredFetch(async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    // Each hop resolves quickly on its own; only the running total matters.
    await new Promise((resolve) => setTimeout(resolve, 40))
    return new Response(null, { status: 302, headers: { location: 'https://enablebanking.com/next' } })
  }
  const result = await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, maxRedirects: 10, timeoutMs: 100 })
  assert.equal(result, null)
  // With a 100ms overall deadline and ~40ms per hop, at most 2-3 hops can
  // complete -- proving the budget is shared across the chain, not reset to
  // a fresh 100ms at every redirect (which would let all 10+1 hops finish).
  assert.ok(calls <= 4, `expected the overall deadline to cut the chain short, got ${calls} calls`)
}))

test('fetchBoundedImage() returns null when the response has no body at all', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'content-type': 'image/png' } })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() treats a negative or non-numeric Content-Length as a hint only, never as acceptance -- the real byte stream still decides', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(pngBytes(10), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '-1' } })
  const image = await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, maxBytes: 1_000 })
  assert.equal(image.body.length, 10)

  globalThis.fetch = async () => new Response(pngBytes(2_000), { status: 200, headers: { 'content-type': 'image/png', 'content-length': 'not-a-number' } })
  const oversized = await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, maxBytes: 1_000 })
  assert.equal(oversized, null)
}))

test('fetchBoundedImage() never forwards cookies/credentials upstream', () => withRestoredFetch(async () => {
  let capturedInit
  globalThis.fetch = async (input, init) => { capturedInit = init; return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } }) }
  await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES })
  assert.equal(capturedInit.credentials, 'omit')
}))

test('fetchBoundedImage() returns null on a non-2xx, non-redirect response', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response('not found', { status: 404 })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES }), null)
}))

test('fetchBoundedImage() times out and returns null rather than hanging forever', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
  assert.equal(await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, timeoutMs: 50 }), null)
}))

// Regression: found by an independent security review (2026-08-21) --
// the timeout previously only bounded time-to-headers (the timer was
// cleared as soon as fetch() resolved), leaving the body-read loop below
// completely unbounded. A response that returns valid 200 + headers
// immediately, sends one chunk, then never sends more and never closes
// the stream reproduces the exact hang; this test would time out (the
// test runner's own timeout, not fetchBoundedImage's) before the fix.
test('fetchBoundedImage() times out on a stalled response BODY too, not just a stalled connection before headers arrive', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(pngBytes(4))
        // Deliberately never closes and never enqueues again -- simulates a
        // connection that stalls mid-body after sending valid headers.
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const started = Date.now()
  const result = await fetchBoundedImage('https://enablebanking.com/x', { allowedHostnames: ENABLEBANKING_HOSTNAMES, timeoutMs: 100 })
  assert.equal(result, null)
  assert.ok(Date.now() - started < 5_000, 'must not hang well past the configured timeout')
}))

// --- fetchInstitutionLogo(): the full pipeline, plus caching ---

test('fetchInstitutionLogo() resolves the URL and fetches it end to end', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'https://enablebanking.com/brands/DE/ING/' }] }), { status: 200 })
    if (url === 'https://enablebanking.com/brands/DE/ING/') return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = enableBankingAdapter()
  const image = await adapter.fetchInstitutionLogo('DE:ING-DiBa')
  assert.equal(image.contentType, 'image/png')
}))

test('fetchInstitutionLogo() returns null without any network fetch of the logo when no logo is available', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'Trade Republic Bank', country: 'DE' }] }), { status: 200 })
    throw new Error(`must never fetch a logo when none exists: ${url}`)
  }
  const adapter = enableBankingAdapter()
  assert.equal(await adapter.fetchInstitutionLogo('DE:Trade Republic Bank'), null)
}))

test('fetchInstitutionLogo() caches a successfully fetched logo by URL, never re-fetching it on the next request', () => withRestoredFetch(async () => {
  let logoFetches = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', logo: 'https://enablebanking.com/brands/DE/ING/' }] }), { status: 200 })
    if (url === 'https://enablebanking.com/brands/DE/ING/') { logoFetches += 1; return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } }) }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = enableBankingAdapter()
  await adapter.fetchInstitutionLogo('DE:ING-DiBa')
  await adapter.fetchInstitutionLogo('DE:ING-DiBa')
  assert.equal(logoFetches, 1)
}))

test('fetchLogo() refetches once a cached entry has expired, never serving a stale image forever', () => withRestoredFetch(async () => {
  let logoFetches = 0
  globalThis.fetch = async () => { logoFetches += 1; return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } }) }
  const adapter = enableBankingAdapter()
  const url = 'https://enablebanking.com/brands/DE/ING/'
  await adapter.fetchLogo(url)
  assert.equal(logoFetches, 1)
  // Simulate the cache entry having expired -- fetchLogo()'s own TTL logic
  // is what's under test, not the passage of real time.
  adapter.logoCache.set(url, { ...adapter.logoCache.get(url), expiresAt: Date.now() - 1 })
  await adapter.fetchLogo(url)
  assert.equal(logoFetches, 2)
}))

test('the logo cache stays bounded at LOGO_CACHE_MAX_ENTRIES, evicting the oldest entry rather than growing without limit', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } })
  const adapter = enableBankingAdapter()
  const maxEntries = 500 // LOGO_CACHE_MAX_ENTRIES is not exported; pinned here to the documented value
  for (let index = 0; index < maxEntries + 1; index += 1) {
    await adapter.fetchLogo(`https://enablebanking.com/brands/DE/bank-${index}/`)
  }
  assert.equal(adapter.logoCache.size, maxEntries)
  assert.ok(!adapter.logoCache.has('https://enablebanking.com/brands/DE/bank-0/'), 'the oldest entry should have been evicted')
  assert.ok(adapter.logoCache.has(`https://enablebanking.com/brands/DE/bank-${maxEntries}/`), 'the newest entry should still be cached')
}))
