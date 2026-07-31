import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getActiveDatabasePool } from './database.js'

const b64 = (value) => Buffer.from(value).toString('base64url')

function keyFromSecret(secret) {
  if (String(secret).length < 32) throw new Error('AUTH_MASTER_KEY must contain at least 32 characters.')
  return createHash('sha256').update(String(secret), 'utf8').digest()
}

function defaultData() {
  return { users: {}, challenges: {} }
}

function normalizeData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultData()
  return {
    users: value.users && typeof value.users === 'object' && !Array.isArray(value.users) ? value.users : {},
    challenges: value.challenges && typeof value.challenges === 'object' && !Array.isArray(value.challenges) ? value.challenges : {},
  }
}

export class AuthStore {
  constructor(path, secret, pool = getActiveDatabasePool()) {
    this.path = path
    this.key = keyFromSecret(secret)
    this.pool = pool
    this.data = defaultData()
    this.queue = Promise.resolve()
  }

  decode(envelope) {
    if (!envelope || typeof envelope !== 'object') throw new Error('Invalid encrypted auth store envelope.')
    const iv = Buffer.from(String(envelope.iv || ''), 'base64url')
    const tag = Buffer.from(String(envelope.tag || ''), 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || typeof envelope.ciphertext !== 'string') throw new Error('Invalid encrypted auth store envelope.')
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return normalizeData(JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')))
  }

  encode() {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()])
    return {
      format: 'finance-planner-auth-store',
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: b64(iv),
      tag: b64(cipher.getAuthTag()),
      ciphertext: b64(ciphertext),
    }
  }

  async load() {
    if (this.pool) {
      const result = await this.pool.query('SELECT encrypted_payload FROM auth_store WHERE id=1')
      if (result.rowCount) {
        this.data = this.decode(result.rows[0].encrypted_payload)
        return this.data
      }
      try {
        this.data = this.decode(JSON.parse(await readFile(this.path, 'utf8')))
        await this.persist()
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      return this.data
    }

    try {
      this.data = this.decode(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return this.data
  }

  async persist() {
    const envelope = this.encode()
    if (this.pool) {
      await this.pool.query(
        'INSERT INTO auth_store (id, encrypted_payload, updated_at) VALUES (1,$1,now()) ON CONFLICT (id) DO UPDATE SET encrypted_payload=EXCLUDED.encrypted_payload, updated_at=now()',
        [envelope],
      )
      return
    }

    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600 })
    await rename(temporary, this.path)
  }

  async mutate(operation) {
    const run = this.queue.then(async () => {
      const previous = structuredClone(this.data)
      try {
        const result = operation(this.data)
        await this.persist()
        return result
      } catch (error) {
        this.data = previous
        throw error
      }
    })
    this.queue = run.catch(() => {})
    return run
  }

  findByEmail(email) {
    return Object.values(this.data.users).find((user) => user.email === String(email).toLowerCase())
  }

  findByCredential(id) {
    return Object.values(this.data.users).find((user) => user.passkeys?.some((credential) => credential.id === id))
  }
}
