import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function keyFromSecret(secret) {
  if (!secret || secret.length < 32) throw new Error('CONNECTOR_MASTER_KEY must contain at least 32 characters.')
  return createHash('sha256').update(secret, 'utf8').digest()
}

function nonceKey(nonce) {
  return createHash('sha256').update(nonce, 'utf8').digest('base64url')
}

export class PostgresStore {
  constructor(pool, secret) {
    this.pool = pool
    this.key = keyFromSecret(secret)
  }

  async load() {
    await this.pool.query('SELECT 1')
  }

  encode(value) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return {
      format: 'finance-planner-connector-record',
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  }

  decode(envelope) {
    if (
      envelope?.format !== 'finance-planner-connector-record' ||
      envelope?.version !== 1 ||
      envelope?.algorithm !== 'AES-256-GCM' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      typeof envelope.ciphertext !== 'string'
    ) throw new Error('Unsupported encrypted connector database record.')
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted connector database record.')
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'))
  }

  async get(userId, provider) {
    const result = await this.pool.query('SELECT encrypted_payload FROM connector_connections WHERE user_id=$1 AND provider=$2', [userId, provider])
    return result.rowCount ? this.decode(result.rows[0].encrypted_payload) : null
  }

  async set(userId, provider, value) {
    await this.pool.query(`INSERT INTO connector_connections (user_id, provider, encrypted_payload) VALUES ($1,$2,$3)
      ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_payload=EXCLUDED.encrypted_payload, updated_at=now()`, [userId, provider, this.encode(value)])
  }

  async remove(userId, provider) {
    await this.pool.query('DELETE FROM connector_connections WHERE user_id=$1 AND provider=$2', [userId, provider])
  }

  async createConnectionSetup(input) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO connector_connections (user_id, provider, encrypted_payload) VALUES ($1,$2,$3)
        ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_payload=EXCLUDED.encrypted_payload, updated_at=now()`, [input.userId, input.provider, this.encode(input.connection)])
      await client.query(`INSERT INTO oauth_nonces (nonce_hash, consent_id, user_id, provider, redirect_uri, expires_at)
        VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) ON CONFLICT (nonce_hash) DO UPDATE SET consent_id=EXCLUDED.consent_id,user_id=EXCLUDED.user_id,provider=EXCLUDED.provider,redirect_uri=EXCLUDED.redirect_uri,expires_at=EXCLUDED.expires_at`, [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.expiresAt])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  // Unlike createConnectionSetup (still used by Google Subscriptions, which
  // has no separate activation step), this never touches
  // connector_connections -- the pending credential lives only alongside
  // its single-use nonce until activateConnection() verifies the provider
  // callback. A currently-working connection (reconnect case) stays
  // untouched if the user abandons or the callback never arrives.
  async createPendingConnectionSetup(input) {
    await this.pool.query(`INSERT INTO oauth_nonces (nonce_hash, consent_id, user_id, provider, redirect_uri, expires_at, pending_payload)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),$7)
      ON CONFLICT (nonce_hash) DO UPDATE SET consent_id=EXCLUDED.consent_id,user_id=EXCLUDED.user_id,provider=EXCLUDED.provider,redirect_uri=EXCLUDED.redirect_uri,expires_at=EXCLUDED.expires_at,pending_payload=EXCLUDED.pending_payload`,
      [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.expiresAt, this.encode(input.connection)])
  }

  async registerOAuthNonce(input) {
    await this.pool.query(`INSERT INTO oauth_nonces (nonce_hash, consent_id, user_id, provider, redirect_uri, expires_at)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) ON CONFLICT (nonce_hash) DO UPDATE SET consent_id=EXCLUDED.consent_id,user_id=EXCLUDED.user_id,provider=EXCLUDED.provider,redirect_uri=EXCLUDED.redirect_uri,expires_at=EXCLUDED.expires_at`, [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.expiresAt])
  }

  async consumeOAuthNonce(input) {
    const result = await this.pool.query('DELETE FROM oauth_nonces WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5 AND expires_at > to_timestamp($6/1000.0) RETURNING 1', [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now])
    return result.rowCount === 1
  }

  // Consumes the single-use nonce and returns the pending credential it
  // guarded, without yet promoting it into connector_connections -- some
  // providers (Enable Banking) still need to complete a server-side exchange
  // (an authorization code -> session call) before the connection is safe to
  // activate, and that exchange is a network call that must never happen
  // inside an open DB transaction. Stays a single local transaction (no
  // network I/O) so nonce consumption itself remains atomic and replay-proof
  // -- unchanged in substance from the single-step activateConnection() this
  // replaces. See finalizeConnection() for the second, provider-independent
  // step, and server.js's callback route for how the two are sequenced
  // around providerAdapter(provider).completeCallback().
  async consumePendingConnectionSetup(input) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const nonce = await client.query('DELETE FROM oauth_nonces WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5 AND expires_at > to_timestamp($6/1000.0) RETURNING pending_payload', [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now])
      if (!nonce.rowCount || !nonce.rows[0].pending_payload) { await client.query('ROLLBACK'); return null }
      const connection = this.decode(nonce.rows[0].pending_payload)
      if (connection.consentId !== input.consentId || connection.redirectUri !== input.redirectUri) { await client.query('ROLLBACK'); return null }
      await client.query('COMMIT')
      return connection
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  // Provider-independent: promotes an already-verified connection (the
  // pending credential, patched with whatever completeCallback() returned)
  // into connector_connections. Never called until the nonce has been
  // consumed AND the provider callback has completed successfully -- by that
  // point a transient failure here is a worse outcome than one step earlier
  // (for a provider like Enable Banking, the provider-side session already
  // exists with zero local trace of it), so this gets a small bounded retry
  // for a local DB write rather than giving up on the first error.
  async finalizeConnection(input) {
    const write = () => this.pool.query(`INSERT INTO connector_connections (user_id, provider, encrypted_payload) VALUES ($1,$2,$3)
      ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_payload=EXCLUDED.encrypted_payload, updated_at=now()`,
      [input.userId, input.provider, this.encode({ ...input.connection, connectedAt: input.connectedAt })])
    const attempts = 3
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await write()
        return
      } catch (error) {
        if (attempt === attempts) throw error
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
      }
    }
  }

  async claimWebhookEvent(input) {
    const leaseToken = randomBytes(24).toString('base64url')
    const result = await this.pool.query(`INSERT INTO webhook_events (provider,event_id,occurred_at,lease_token,lease_until) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (provider,event_id) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,updated_at=now()
      WHERE webhook_events.completed_at IS NULL AND (webhook_events.lease_until IS NULL OR webhook_events.lease_until <= $6)
      RETURNING lease_token`, [input.provider, input.eventId, input.occurredAt, leaseToken, input.leaseUntil, input.now])
    return result.rows[0]?.lease_token
  }

  async completeWebhookEvent(input) {
    const result = await this.pool.query('UPDATE webhook_events SET completed_at=$4, lease_until=NULL, updated_at=now() WHERE provider=$1 AND event_id=$2 AND lease_token=$3 AND completed_at IS NULL RETURNING 1', [input.provider, input.eventId, input.leaseToken, input.completedAt])
    return result.rowCount === 1
  }

  async releaseWebhookEvent(input) {
    const result = await this.pool.query('DELETE FROM webhook_events WHERE provider=$1 AND event_id=$2 AND lease_token=$3 AND completed_at IS NULL RETURNING 1', [input.provider, input.eventId, input.leaseToken])
    return result.rowCount === 1
  }
}
