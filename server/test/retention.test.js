import assert from 'node:assert/strict'
import test from 'node:test'
import { RetentionManager } from '../src/retention.js'

test('cleans expired operational records with explicit retention windows', async () => {
  const calls = []
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values })
      return { rowCount: calls.length }
    },
  }
  const metrics = { entries: [], increment(name, labels, amount = 1) { this.entries.push({ name, labels, amount }) } }
  const manager = new RetentionManager({
    pool,
    sessionRevocations: { prune: async (options) => { calls.push({ sql: 'session-prune', values: [options] }); return 5 } },
    metrics,
    env: {
      RETENTION_INTERVAL_MS: '60000',
      WEBHOOK_RETENTION_DAYS: '30',
      ABANDONED_WEBHOOK_RETENTION_DAYS: '3',
      SESSION_REVOCATION_RETENTION_DAYS: '365',
    },
    now: () => new Date('2026-08-01T12:00:00.000Z'),
  })

  const result = await manager.run()
  assert.equal(result.persistence, 'postgres')
  assert.deepEqual(result.deleted, {
    oauthNonces: 1,
    completedWebhooks: 2,
    abandonedWebhooks: 3,
    rateLimits: 4,
    sessionRevocations: 5,
  })
  assert.match(calls[0].sql, /oauth_nonces/)
  assert.equal(calls[1].values[1], 30)
  assert.equal(calls[2].values[1], 3)
  assert.equal(calls.at(-1).values[0].retentionDays, 365)
  assert.equal(manager.status().healthy, true)
  assert.equal(metrics.entries.some((entry) => entry.name === 'finance_planner_retention_runs_total' && entry.labels.outcome === 'success'), true)
})

test('records failed cleanup without hiding the error', async () => {
  const manager = new RetentionManager({
    pool: { query: async () => { throw new Error('retention database failed') } },
    metrics: { increment() {} },
    now: () => new Date('2026-08-01T12:00:00.000Z'),
  })
  await assert.rejects(() => manager.run(), /retention database failed/)
  assert.equal(manager.status().healthy, false)
  assert.match(manager.status().lastError, /retention database failed/)
})

test('reports file-backed development mode without pretending to delete database rows', async () => {
  const manager = new RetentionManager({ pool: null, now: () => new Date('2026-08-01T12:00:00.000Z') })
  assert.deepEqual(await manager.run(), { persistence: 'file', deleted: {} })
  assert.equal(manager.status().enabled, false)
})
