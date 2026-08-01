const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000

function boundedDays(value, fallback, maximum = 3_650) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback
}

export class RetentionManager {
  constructor({ pool = null, sessionRevocations = null, metrics = null, env = process.env, now = () => new Date() } = {}) {
    this.pool = pool
    this.sessionRevocations = sessionRevocations
    this.metrics = metrics
    this.now = now
    this.intervalMs = Math.max(60_000, Number(env.RETENTION_INTERVAL_MS || DEFAULT_INTERVAL_MS))
    this.webhookDays = boundedDays(env.WEBHOOK_RETENTION_DAYS, 90)
    this.abandonedWebhookDays = boundedDays(env.ABANDONED_WEBHOOK_RETENTION_DAYS, 7)
    this.sessionRevocationDays = boundedDays(env.SESSION_REVOCATION_RETENTION_DAYS, 400)
    this.timer = null
    this.lastRunAt = null
    this.lastResult = null
    this.lastError = null
  }

  async run() {
    if (!this.pool) {
      this.lastRunAt = this.now().toISOString()
      this.lastResult = { persistence: 'file', deleted: {} }
      this.lastError = null
      return this.lastResult
    }

    const runAt = this.now()
    const deleted = {}
    const queries = [
      ['oauthNonces', 'DELETE FROM oauth_nonces WHERE expires_at < $1', [runAt]],
      ['completedWebhooks', `DELETE FROM webhook_events
        WHERE completed_at IS NOT NULL
          AND completed_at < $1 - ($2 * interval '1 day')`, [runAt, this.webhookDays]],
      ['abandonedWebhooks', `DELETE FROM webhook_events
        WHERE completed_at IS NULL
          AND (lease_until IS NULL OR lease_until < $1)
          AND updated_at < $1 - ($2 * interval '1 day')`, [runAt, this.abandonedWebhookDays]],
      ['rateLimits', 'DELETE FROM request_rate_limits WHERE expires_at < $1', [runAt]],
    ]

    try {
      for (const [name, sql, values] of queries) {
        const result = await this.pool.query(sql, values)
        deleted[name] = result.rowCount || 0
      }
      deleted.sessionRevocations = this.sessionRevocations
        ? await this.sessionRevocations.prune({ retentionDays: this.sessionRevocationDays, now: runAt })
        : 0
      this.lastRunAt = runAt.toISOString()
      this.lastResult = { persistence: 'postgres', deleted }
      this.lastError = null
      this.metrics?.increment('finance_planner_retention_runs_total', { outcome: 'success' })
      for (const [recordType, count] of Object.entries(deleted)) {
        if (count > 0) this.metrics?.increment('finance_planner_retention_deleted_records_total', { record_type: recordType }, count)
      }
      return this.lastResult
    } catch (error) {
      this.lastRunAt = runAt.toISOString()
      this.lastError = error instanceof Error ? error.message : String(error)
      this.metrics?.increment('finance_planner_retention_runs_total', { outcome: 'failure' })
      throw error
    }
  }

  start() {
    if (!this.pool || this.timer) return
    void this.run().catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'retention_run_failed', error: error instanceof Error ? error.message : String(error) }))
    })
    this.timer = setInterval(() => {
      void this.run().catch((error) => {
        console.error(JSON.stringify({ level: 'error', event: 'retention_run_failed', error: error instanceof Error ? error.message : String(error) }))
      })
    }, this.intervalMs)
    this.timer.unref?.()
  }

  status() {
    return {
      enabled: Boolean(this.pool),
      intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      healthy: !this.lastError,
      lastError: this.lastError,
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
