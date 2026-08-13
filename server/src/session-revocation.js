import { createHmac } from 'node:crypto'

function sessionKey(userId, secret) {
  if (String(secret || '').length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')
  return createHmac('sha256', secret)
    .update(`finance-planner-session-revocation:${String(userId || '')}`, 'utf8')
    .digest('base64url')
}

export class SessionRevocationRegistry {
  constructor({ pool = null, secret, refreshMs = 30_000, now = () => Date.now() } = {}) {
    this.pool = pool
    this.secret = secret
    this.refreshMs = Math.max(5_000, Number(refreshMs) || 30_000)
    this.now = now
    this.revokedBefore = new Map()
    this.timer = null
  }

  async load() {
    if (!this.pool) return
    const result = await this.pool.query('SELECT session_key, revoked_before FROM user_session_revocations')
    const next = new Map()
    for (const row of result.rows) {
      const timestamp = new Date(row.revoked_before).getTime()
      if (Number.isFinite(timestamp)) next.set(String(row.session_key), timestamp)
    }
    this.revokedBefore = next
  }

  start() {
    if (!this.pool || this.timer) return
    this.timer = setInterval(() => {
      void this.load().catch((error) => {
        console.error(JSON.stringify({ level: 'error', event: 'session_revocation_refresh_failed', error: error instanceof Error ? error.message : String(error) }))
      })
    }, this.refreshMs)
    this.timer.unref?.()
  }

  verify(claims) {
    const revokedAt = this.revokedBefore.get(sessionKey(claims.sub, this.secret))
    if (revokedAt === undefined) return claims.sub
    const claimedIssuedAtMs = Number(claims.iatMs)
    const issuedAtMs = Number.isSafeInteger(claimedIssuedAtMs)
      ? claimedIssuedAtMs
      : Number(claims.iat || 0) * 1_000
    if (issuedAtMs <= revokedAt) throw new Error('Session revoked.')
    return claims.sub
  }

  async revoke(userId, at = new Date(this.now())) {
    const timestamp = new Date(at)
    if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid session revocation time.')
    const key = sessionKey(userId, this.secret)
    if (this.pool) {
      await this.pool.query(`INSERT INTO user_session_revocations (session_key, revoked_before, updated_at)
        VALUES ($1,$2,now())
        ON CONFLICT (session_key) DO UPDATE SET revoked_before=GREATEST(user_session_revocations.revoked_before, EXCLUDED.revoked_before), updated_at=now()`, [key, timestamp])
    }
    const current = this.revokedBefore.get(key) || 0
    this.revokedBefore.set(key, Math.max(current, timestamp.getTime()))
    return timestamp.toISOString()
  }

  async prune({ retentionDays = 400, now = new Date(this.now()) } = {}) {
    if (!this.pool) return 0
    const cutoff = new Date(now.getTime() - Math.max(1, retentionDays) * 86_400_000)
    const result = await this.pool.query('DELETE FROM user_session_revocations WHERE revoked_before < $1', [cutoff])
    await this.load()
    return result.rowCount || 0
  }

  close() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
