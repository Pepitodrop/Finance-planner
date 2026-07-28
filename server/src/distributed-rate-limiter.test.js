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
