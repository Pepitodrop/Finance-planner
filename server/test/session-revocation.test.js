import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionRevocationRegistry } from '../src/session-revocation.js'

const secret = 'session-secret-for-tests-with-more-than-32-characters'

function fakePool() {
  const rows = new Map()
  return {
    rows,
    async query(sql, values = []) {
      if (sql.startsWith('SELECT session_key')) {
        return { rows: [...rows.entries()].map(([session_key, revoked_before]) => ({ session_key, revoked_before })), rowCount: rows.size }
      }
      if (sql.startsWith('INSERT INTO user_session_revocations')) {
        const [key, timestamp] = values
        const current = rows.get(key)
        const next = !current || new Date(timestamp) > new Date(current) ? new Date(timestamp) : new Date(current)
        rows.set(key, next)
        return { rows: [], rowCount: 1 }
      }
      if (sql.startsWith('DELETE FROM user_session_revocations')) {
        const [cutoff] = values
        let deleted = 0
        for (const [key, value] of rows) {
          if (new Date(value) < new Date(cutoff)) { rows.delete(key); deleted += 1 }
        }
        return { rows: [], rowCount: deleted }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
}

test('revokes existing sessions but permits sessions issued afterwards', async () => {
  const pool = fakePool()
  const registry = new SessionRevocationRegistry({ pool, secret, now: () => Date.parse('2026-08-01T12:00:00Z') })
  await registry.load()
  await registry.revoke('user-1')

  assert.throws(() => registry.verify({ sub: 'user-1', iat: Date.parse('2026-08-01T11:59:00Z') / 1_000 }), /revoked/i)
  assert.equal(registry.verify({ sub: 'user-1', iat: Date.parse('2026-08-01T12:00:01Z') / 1_000 }), 'user-1')
  assert.equal(registry.verify({ sub: 'user-2', iat: 0 }), 'user-2')
})

test('loads revocations after a process restart and prunes old entries', async () => {
  const pool = fakePool()
  const first = new SessionRevocationRegistry({ pool, secret, now: () => Date.parse('2024-01-01T00:00:00Z') })
  await first.revoke('old-user')

  const second = new SessionRevocationRegistry({ pool, secret, now: () => Date.parse('2026-08-01T00:00:00Z') })
  await second.load()
  assert.throws(() => second.verify({ sub: 'old-user', iat: 0 }), /revoked/i)
  assert.equal(await second.prune({ retentionDays: 400, now: new Date('2026-08-01T00:00:00Z') }), 1)
  assert.equal(second.verify({ sub: 'old-user', iat: 0 }), 'old-user')
})
