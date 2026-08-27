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
  // its single-use nonce until consumePendingConnectionSetup() + completeCallback()
  // + finalizeConnection() verify the provider callback and promote it. A
  // currently-working connection (reconnect case) stays untouched if the
  // user abandons or the callback never arrives.
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

  // CLAIMS (does not delete) the pending credential guarded by this nonce,
  // exactly once -- fixes a concurrent-duplicate-callback race found live
  // (2026-08-25, Mock ASPSP run against PR #154): the previous
  // consumePendingConnectionSetup() DELETEd the row here, before
  // completeCallback() (a network call to the provider) and
  // finalizeConnection() ever ran, so a second delivery of the same signed
  // callback arriving in that window saw the nonce as already gone, found no
  // finalized connection yet either, and was rejected as invalid_state --
  // even though the first delivery went on to finalize successfully moments
  // later. Marking the row claimed IN PLACE instead lets a concurrent
  // duplicate see, from shared Postgres state, that this exact verified
  // attempt is already being completed (status: 'in_progress') and wait for
  // its outcome, rather than being told the attempt never existed.
  //
  // Returns exactly one of:
  //   { status: 'claimed', claimToken, connection } -- this call is the
  //     exactly-once winner; proceed to providerAdapter.completeCallback()
  //     and finalizeConnection(), then call releasePendingConnectionSetup().
  //   { status: 'in_progress' } -- a matching row exists but is already
  //     claimed by an earlier delivery of the SAME verified attempt (same
  //     nonce_hash + consent_id + user_id + provider + redirect_uri) that
  //     has not yet resolved. Never returned for an unrelated/expired/
  //     mismatched nonce -- see waitForPendingConnectionCompletion().
  //   { status: 'not_found' } -- no matching, unexpired row exists (never
  //     registered, wrong consent/user/provider/redirectUri, expired, or
  //     already resolved and released by its claimer). The caller's existing
  //     completedConnectionMatchesState() replay check is what distinguishes
  //     "this is a genuine unrelated/expired callback" from "this is a
  //     delayed duplicate of an attempt that already finished."
  //
  // The claim itself stays a single local transaction (no network I/O), so
  // it remains atomic and exactly-once under real concurrent Postgres
  // clients -- the row-level lock taken by the UPDATE is what actually
  // enforces "at most one winner," not application-level logic. This is
  // therefore correct across multiple connector processes/instances sharing
  // one Postgres database, not just within one process.
  async claimPendingConnectionSetup(input) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const claimToken = randomBytes(24).toString('base64url')
      const claimed = await client.query(
        `UPDATE oauth_nonces SET claim_token=$7
         WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5
           AND expires_at > to_timestamp($6/1000.0) AND claim_token IS NULL
         RETURNING pending_payload`,
        [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now, claimToken],
      )
      if (claimed.rowCount === 1) {
        // Validated BEFORE commit, matching the old consumePendingConnectionSetup()
        // and EncryptedStore.claimPendingConnectionSetup() -- committing the
        // claim first and only then discovering a payload mismatch would
        // leave claim_token set on a row nobody holds the token for, so it
        // could never be released and would sit "claimed" until the
        // retention sweep's natural expiry (found by review, 2026-08-25).
        if (!claimed.rows[0].pending_payload) { await client.query('ROLLBACK'); return { status: 'not_found' } }
        const connection = this.decode(claimed.rows[0].pending_payload)
        if (connection.consentId !== input.consentId || connection.redirectUri !== input.redirectUri) { await client.query('ROLLBACK'); return { status: 'not_found' } }
        await client.query('COMMIT')
        return { status: 'claimed', claimToken, connection }
      }
      // Not claimed by us -- find out whether that's because it's already
      // claimed by someone else (wait for them) or genuinely doesn't exist
      // (unrelated/expired/mismatched nonce, handled by the caller's
      // existing replay-check path).
      const existing = await client.query(
        `SELECT 1 FROM oauth_nonces
         WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5 AND expires_at > to_timestamp($6/1000.0)`,
        [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now],
      )
      await client.query('COMMIT')
      return { status: existing.rowCount ? 'in_progress' : 'not_found' }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  // Read-only: used by waitForPendingConnectionCompletion() to poll whether
  // a claimed attempt has resolved yet, without attempting (or being able)
  // to claim it itself. Never mutates anything.
  async pendingConnectionSetupExists(input) {
    const result = await this.pool.query(
      `SELECT 1 FROM oauth_nonces WHERE nonce_hash=$1 AND consent_id=$2 AND user_id=$3 AND provider=$4 AND redirect_uri=$5 AND expires_at > to_timestamp($6/1000.0)`,
      [nonceKey(input.nonce), input.consentId, input.userId, input.provider, input.redirectUri, input.now],
    )
    return result.rowCount > 0
  }

  // Releases a resolved claim -- called after EITHER a successful
  // finalizeConnection() OR a failed completeCallback()/finalizeConnection(),
  // in both cases only once the outcome is final. Matched by claimToken, so
  // only the actual claimer (never a waiting duplicate, which never receives
  // a claimToken) can release it. Deleting the row here (rather than earlier,
  // before the network call) is the whole point of this fix -- a concurrent
  // duplicate's claimPendingConnectionSetup() call sees 'in_progress' right
  // up until this runs, then 'not_found' afterward, at which point its
  // existing completedConnectionMatchesState() check against the
  // now-finalized (or, on failure, still-absent) connector_connections row
  // is what actually determines its own success/failure -- this method
  // itself makes no success/failure claim, it only ends the claim's
  // exclusivity window.
  async releasePendingConnectionSetup(input) {
    const result = await this.pool.query(
      'DELETE FROM oauth_nonces WHERE nonce_hash=$1 AND claim_token=$2 RETURNING 1',
      [nonceKey(input.nonce), input.claimToken],
    )
    return result.rowCount === 1
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
