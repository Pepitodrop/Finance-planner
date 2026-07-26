import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function keyFromSecret(secret) {
  if (!secret || secret.length < 32) throw new Error('CONNECTOR_MASTER_KEY must contain at least 32 characters.')
  return createHash('sha256').update(secret, 'utf8').digest()
}

export class EncryptedStore {
  constructor(path, secret) {
    this.path = path
    this.key = keyFromSecret(secret)
    this.data = { connections: {} }
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
    return this.data
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()])
    const envelope = JSON.stringify({
      format: 'finance-planner-connectors', version: 1, algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    })
    const temp = `${this.path}.tmp`
    await writeFile(temp, envelope, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.path)
  }

  get(userId, provider) { return this.data.connections?.[userId]?.[provider] ?? null }
  async set(userId, provider, value) {
    this.data.connections[userId] ??= {}
    this.data.connections[userId][provider] = value
    await this.save()
  }
  async remove(userId, provider) {
    if (this.data.connections?.[userId]) delete this.data.connections[userId][provider]
    await this.save()
  }
}
