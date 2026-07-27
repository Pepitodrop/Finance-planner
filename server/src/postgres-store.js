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
    return { version: 1, algorithm: 'AES-256-GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  }

  decode(envelope) {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'))
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

  async registerOAuthNonce(input) {
    await this.pool.query(`INSERT INTO oauth_nonces (nonce_hash, consent_id, user_id, provider, redirect_uri, expires_at)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) ON CONFLICT (nonce_hash) DO UPDATE SET consent_id=EXCLUDED.consent_id,user_id=EXCLUDED.user_id,provider=EXCLUDED.provider,redirect_uri=EXCLUDED.redirect_uri,expires_at=EXCLUDED.expires_at`, [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.expiresAt])
  }

  async consumeOAuthNonce(input) {
    const result = await this.pool.query(`DELETE FROM oauth_nonces WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5 AND expires_at > to_timestamp($6/1000.0) RETURNING 1`, [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now])
    return result.rowCount === 1
  }

  async activateConnection(input) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const nonce = await client.query(`DELETE FROM oauth_nonces WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5 AND expires_at > to_timestamp($6/1000.0) RETURNING 1`, [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now])
      if (!nonce.rowCount) { await client.query('ROLLBACK'); return false }
      const current = await client.query('SELECT encrypted_payload FROM connector_connections WHERE user_id=$1 AND provider=$2 FOR UPDATE', [input.userId, input.provider])
      if (!current.rowCount) { await client.query('ROLLBACK'); return false }
      const connection = this.decode(current.rows[0].encrypted_payload)
      if (connection.consentId !== input.consentId || connection.redirectUri !== input.redirectUri) { await client.query('ROLLBACK'); return false }
      await client.query('UPDATE connector_connections SET encrypted_payload=$3, updated_at=now() WHERE user_id=$1 AND provider=$2', [input.userId, input.provider, this.encode({ ...connection, connectedAt: input.connectedAt })])
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
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
