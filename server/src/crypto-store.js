import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
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

function clone(value) {
  return structuredClone(value)
}

async function syncFile(path) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path) {
  const handle = await open(dirname(path), 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export class EncryptedStore {
  constructor(path, secret) {
    this.path = path
    this.backupPath = `${path}.bak`
    this.key = keyFromSecret(secret)
    this.data = { connections: {}, oauthNonces: {}, webhookEvents: {} }
    this.writeQueue = Promise.resolve()
  }

  normalize() {
    this.data.connections ??= {}
    this.data.oauthNonces ??= {}
    this.data.webhookEvents ??= {}
  }

  decode(contents) {
    const envelope = JSON.parse(contents)
    if (
      envelope?.format !== 'finance-planner-connectors' ||
      envelope?.version !== 2 ||
      envelope?.algorithm !== 'AES-256-GCM' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      typeof envelope.ciphertext !== 'string'
    ) throw new Error('Unsupported encrypted connector store format.')
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted connector store envelope.')
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8'))
  }

  async load() {
    let primaryError
    try {
      this.data = this.decode(await readFile(this.path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        try {
          this.data = this.decode(await readFile(this.backupPath, 'utf8'))
          await this.save({ preserveBackup: true })
        } catch (backupError) {
          if (backupError?.code !== 'ENOENT') throw new Error('Encrypted connector store could not be recovered.', { cause: backupError })
        }
      } else {
        primaryError = error
        try {
          this.data = this.decode(await readFile(this.backupPath, 'utf8'))
          await this.save({ preserveBackup: true })
        } catch (backupError) {
          throw new Error('Encrypted connector store could not be opened or recovered.', { cause: new AggregateError([primaryError, backupError]) })
        }
      }
    }
    this.normalize()
    return this.data
  }

  async save({ preserveBackup = false } = {}) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()])
    const envelope = JSON.stringify({
      format: 'finance-planner-connectors', version: 2, algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    })
    const suffix = `${process.pid}.${randomBytes(6).toString('hex')}`
    const temp = `${this.path}.${suffix}.tmp`
    const backupTemp = `${this.backupPath}.${suffix}.tmp`
    try {
      await writeFileDurable(temp, envelope)
      if (!preserveBackup) {
        try {
          await copyFile(this.path, backupTemp)
          await syncFile(backupTemp)
          await rename(backupTemp, this.backupPath)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
      await rename(temp, this.path)
      await syncDirectory(this.path)
    } finally {
      await unlink(temp).catch(() => {})
      await unlink(backupTemp).catch(() => {})
    }
  }

  async mutate(operation) {
    const run = this.writeQueue.then(async () => {
      const previous = clone(this.data)
      try {
        const result = await operation()
        await this.save()
        return result
      } catch (error) {
        this.data = previous
        throw error
      }
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

  async removeUser(userId) {
    return this.mutate(() => {
      const connectorConnections = Object.keys(this.data.connections?.[userId] || {}).length
      delete this.data.connections[userId]
      let oauthNonces = 0
      for (const [key, nonce] of Object.entries(this.data.oauthNonces)) {
        if (nonce?.userId === userId) {
          delete this.data.oauthNonces[key]
          oauthNonces += 1
        }
      }
      return { connectorConnections, oauthNonces }
    })
  }

  async createConnectionSetup(input) {
    return this.mutate(() => {
      this.data.connections[input.userId] ??= {}
      this.data.connections[input.userId][input.provider] = input.connection
      this.data.oauthNonces[nonceKey(input.nonce)] = {
        consentId: input.consentId,
        userId: input.userId,
        provider: input.provider,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
      }
    })
  }

  async registerOAuthNonce(input) {
    return this.mutate(() => {
      this.data.oauthNonces[nonceKey(input.nonce)] = {
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
      if (stored.expiresAt <= input.now) {
        delete this.data.oauthNonces[key]
        return false
      }
      if (
        stored.consentId !== input.consentId ||
        stored.userId !== input.userId ||
        stored.provider !== input.provider ||
        stored.redirectUri !== input.redirectUri
      ) return false
      delete this.data.oauthNonces[key]
      return true
    })
  }

  async activateConnection(input) {
    return this.mutate(() => {
      const connection = this.data.connections?.[input.userId]?.[input.provider]
      const key = nonceKey(input.nonce)
      const stored = this.data.oauthNonces[key]
      if (!connection || !stored) return false
      if (stored.expiresAt <= input.now) {
        delete this.data.oauthNonces[key]
        return false
      }
      if (
        connection.consentId !== input.consentId ||
        connection.redirectUri !== input.redirectUri ||
        stored.consentId !== input.consentId ||
        stored.userId !== input.userId ||
        stored.provider !== input.provider ||
        stored.redirectUri !== input.redirectUri
      ) return false
      delete this.data.oauthNonces[key]
      this.data.connections[input.userId][input.provider] = {
        ...connection,
        connectedAt: input.connectedAt,
      }
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

async function writeFileDurable(path, contents) {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}
