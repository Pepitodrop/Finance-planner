import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function keyFromSecret(secret) {
  if (!secret || secret.length < 32) throw new Error('CONNECTOR_MASTER_KEY must contain at least 32 characters.')
  return createHash('sha256').update(secret, 'utf8').digest()
}

function nonceKey(nonce) {
  return createHash('sha256').update(nonce, 'utf8').digest('base64url')
}

function eventKey(provider, eventId) {
  return `${provider}:${eventId}`
}

export class EncryptedStore {
  constructor(path, secret) {
    this.path = path
    this.key = keyFromSecret(secret)
    this.data = { connections: {}, oauthNonces: {}, webhookEvents: {} }
    this.writeQueue = Promise.resolve()
  }

  normalize() {
    this.data.connections ??= {}
    this.data.oauthNonces ??= {}
    this.data.webhookEvents ??= {}
  }

  async load() {
    try {
      const envelope = JSON.parse(await readFile(this.path, 'utf8'))
      const iv = Buffer.from(envelope.iv, 'base64')
      const tag = Buffer.from(envelope.tag, 'base64')
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ])
      this.data = JSON.parse(plaintext.toString('utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('Encrypted connector store could not be opened.', { cause: error })
    }
    this.normalize()
    return this.data
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()])
    const envelope = JSON.stringify({
      format: 'finance-planner-connectors', version: 2, algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    })
    const temp = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(temp, envelope, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.path)
  }

  async mutate(operation) {
    const run = this.writeQueue.then(async () => {
      const result = await operation()
      await this.save()
      return result
    })
    this.writeQueue = run.catch(() => {})
    return run
  }

  get(userId, provider) { return this.data.connections?.[userId]?.[provider] ?? null }

  async set(userId, provider, value) {
    return this.mutate(() => {
      this.data.connections[userId] ??= {}
      this.data.connections[userId][provider] = value
    })
  }

  async remove(userId, provider) {
    return this.mutate(() => {
      if (this.data.connections?.[userId]) delete this.data.connections[userId][provider]
    })
  }

  async registerOAuthNonce(input) {
    return this.mutate(() => {
      const key = nonceKey(input.nonce)
      this.data.oauthNonces[key] = {
        consentId: input.consentId,
        userId: input.userId,
        provider: input.provider,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
      }
    })
  }

  async consumeOAuthNonce(input) {
    return this.mutate(() => {
      const key = nonceKey(input.nonce)
      const stored = this.data.oauthNonces[key]
      if (!stored) return false
      delete this.data.oauthNonces[key]
      if (
        stored.consentId !== input.consentId ||
        stored.userId !== input.userId ||
        stored.provider !== input.provider ||
        stored.redirectUri !== input.redirectUri ||
        stored.expiresAt <= input.now
      ) return false
      return true
    })
  }

  async claimWebhookEvent(input) {
    return this.mutate(() => {
      const key = eventKey(input.provider, input.eventId)
      const now = Date.parse(input.now)
      const existing = this.data.webhookEvents[key]
      if (existing?.completedAt) return undefined
      if (existing?.leaseUntil && Date.parse(existing.leaseUntil) > now) return undefined
      const leaseToken = randomBytes(24).toString('base64url')
      this.data.webhookEvents[key] = {
        occurredAt: input.occurredAt,
        leaseToken,
        leaseUntil: input.leaseUntil,
        completedAt: null,
      }
      return leaseToken
    })
  }

  async completeWebhookEvent(input) {
    return this.mutate(() => {
      const key = eventKey(input.provider, input.eventId)
      const existing = this.data.webhookEvents[key]
      if (!existing || existing.completedAt || existing.leaseToken !== input.leaseToken) return false
      existing.completedAt = input.completedAt
      existing.leaseUntil = null
      return true
    })
  }

  async releaseWebhookEvent(input) {
    return this.mutate(() => {
      const key = eventKey(input.provider, input.eventId)
      const existing = this.data.webhookEvents[key]
      if (!existing || existing.completedAt || existing.leaseToken !== input.leaseToken) return false
      delete this.data.webhookEvents[key]
      return true
    })
  }
}
