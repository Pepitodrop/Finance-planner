import assert from 'node:assert/strict'
import test from 'node:test'
import { PostgresSlidingWindowRateLimiter, createRateLimiters } from './distributed-rate-limiter.js'

test('postgres limiter returns shared window counters', async () => {
  let count = 0
  const pool = {
    async query(sql) {
      if (sql.startsWith('DELETE')) return { rows: [] }
      count += 1
      return { rows: [{ request_count: count }] }
    },
  }
  const limiter = new PostgresSlidingWindowRateLimiter(pool, { limit: 2, windowMs: 60_000, namespace: 'test' })
  const first = await limiter.consume('client', 120_000)
  const second = await limiter.consume('client', 120_001)
  const third = await limiter.consume('client', 120_002)
  assert.equal(first.allowed, true)
  assert.equal(second.remaining, 0)
  assert.equal(third.allowed, false)
  assert.equal(third.retryAfter, 60)
})

test('public production requires a distributed store', () => {
  assert.throws(
    () => createRateLimiters({ persistence: { pool: null }, requireDistributed: true }),
    /require CONNECTOR_STORE_DRIVER=postgres/,
  )
})

// Regression coverage for a live production defect (2026-08-21): the
// institution-logo proxy shared the same "sensitive" namespace/bucket as
// POST /start, sync and disconnect, so ordinary logo traffic could exhaust
// it and starve those genuinely security-sensitive operations. `assets`
// must be a fully independent namespace (same underlying table, no schema
// change -- `namespace` is a free-text partition key).
test('createRateLimiters provisions an independent assets limiter alongside general/sensitive, in its own namespace', async () => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, namespace: params?.[0] })
      if (sql.startsWith('DELETE')) return { rows: [] }
      return { rows: [{ request_count: 1 }] }
    },
  }
  const limiters = createRateLimiters({ persistence: { pool }, generalLimit: 120, sensitiveLimit: 20, assetLimit: 240 })
  assert.ok(limiters.assets, 'an assets limiter must be provisioned')
  assert.equal(limiters.assets.namespace, 'assets')
  assert.equal(limiters.assets.limit, 240)
  assert.notEqual(limiters.assets, limiters.sensitive)
  assert.notEqual(limiters.assets, limiters.general)

  await limiters.assets.consume('client-a')
  await limiters.sensitive.consume('client-a')
  assert.deepEqual(queries.map((query) => query.namespace).filter((namespace) => namespace !== undefined), ['assets', 'sensitive'])
})

test('an assets limiter defaults to the documented 240/min limit when not explicitly configured', () => {
  const pool = { async query() { return { rows: [{ request_count: 1 }] } } }
  const limiters = createRateLimiters({ persistence: { pool } })
  assert.equal(limiters.assets.limit, 240)
})
