export class PostgresSlidingWindowRateLimiter {
  constructor(pool, { limit = 120, windowMs = 60_000, namespace = 'general' } = {}) {
    if (!pool) throw new Error('A PostgreSQL pool is required for distributed rate limiting.')
    this.pool = pool
    this.limit = limit
    this.windowMs = windowMs
    this.namespace = namespace
  }

  async consume(key, now = Date.now()) {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs
    const resetAt = windowStart + this.windowMs
    const result = await this.pool.query(
      `INSERT INTO request_rate_limits (namespace, client_key, window_start, request_count, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), 1, to_timestamp($4 / 1000.0))
       ON CONFLICT (namespace, client_key, window_start)
       DO UPDATE SET request_count = request_rate_limits.request_count + 1,
                     expires_at = EXCLUDED.expires_at
       RETURNING request_count`,
      [this.namespace, key, windowStart, resetAt],
    )
    const count = Number(result.rows[0].request_count)
    if (Math.random() < 0.01) {
      void this.pool.query('DELETE FROM request_rate_limits WHERE expires_at < now()').catch(() => {})
    }
    return {
      allowed: count <= this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    }
  }
}

export function createRateLimiters({ persistence, generalLimit = 120, sensitiveLimit = 20, assetLimit = 240, windowMs = 60_000, requireDistributed = false }) {
  if (persistence.pool) {
    return {
      general: new PostgresSlidingWindowRateLimiter(persistence.pool, { limit: generalLimit, windowMs, namespace: 'general' }),
      sensitive: new PostgresSlidingWindowRateLimiter(persistence.pool, { limit: sensitiveLimit, windowMs, namespace: 'sensitive' }),
      // Own namespace/bucket, same table (no schema change -- `namespace` is
      // a free-text partition key, not a constrained enum) -- decorative
      // asset traffic (the institution-logo proxy) must never be able to
      // consume the sensitive quota that POST /start, sync and disconnect
      // depend on. See server.js's rateLimitTier().
      assets: new PostgresSlidingWindowRateLimiter(persistence.pool, { limit: assetLimit, windowMs, namespace: 'assets' }),
      distributed: true,
    }
  }
  if (requireDistributed) throw new Error('Public production deployments require CONNECTOR_STORE_DRIVER=postgres for distributed rate limiting.')
  return null
}
