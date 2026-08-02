import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function keyFromSecret(secret) {
  if (!secret || String(secret).length < 32) throw new Error('CONNECTOR_MASTER_KEY must contain at least 32 characters.')
  return createHash('sha256').update(String(secret), 'utf8').digest()
}

function bindingData(userId) {
  if (typeof userId !== 'string' || !userId || userId.length > 256) throw new Error('A valid authenticated user binding is required.')
  return Buffer.from(`finance-planner-budget-learning:v1:${userId}`, 'utf8')
}

export function encryptBudgetProfile(profile, secret, userId) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  cipher.setAAD(bindingData(userId))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(profile), 'utf8'), cipher.final()])
  return {
    format: 'finance-planner-budget-learning-profile',
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }
}

export function decryptBudgetProfile(envelope, secret, userId) {
  if (!envelope || envelope.format !== 'finance-planner-budget-learning-profile' || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('Unsupported budget-learning profile format.')
  }
  const iv = Buffer.from(String(envelope.iv || ''), 'base64url')
  const tag = Buffer.from(String(envelope.tag || ''), 'base64url')
  if (iv.length !== 12 || tag.length !== 16 || typeof envelope.ciphertext !== 'string') throw new Error('Invalid budget-learning profile envelope.')
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  decipher.setAAD(bindingData(userId))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8'))
}

export class BudgetProfileStore {
  constructor(pool, secret) {
    if (!pool) throw new Error('PostgreSQL is required for persistent budget learning.')
    this.pool = pool
    this.secret = secret
  }

  async get(userId) {
    const result = await this.pool.query('SELECT encrypted_payload, version, updated_at FROM user_budget_learning_profiles WHERE user_id=$1', [userId])
    if (!result.rowCount) return { profile: null, version: 0, updatedAt: null }
    const row = result.rows[0]
    return {
      profile: decryptBudgetProfile(row.encrypted_payload, this.secret, userId),
      version: Number(row.version),
      updatedAt: new Date(row.updated_at).toISOString(),
    }
  }

  async update(userId, updater) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query('SELECT encrypted_payload, version FROM user_budget_learning_profiles WHERE user_id=$1 FOR UPDATE', [userId])
      const currentProfile = current.rowCount ? decryptBudgetProfile(current.rows[0].encrypted_payload, this.secret, userId) : null
      const nextProfile = await updater(currentProfile)
      if (!nextProfile || typeof nextProfile !== 'object' || Array.isArray(nextProfile)) throw new Error('Budget profile updater returned an invalid profile.')
      const nextVersion = current.rowCount ? Number(current.rows[0].version) + 1 : 1
      const encrypted = encryptBudgetProfile(nextProfile, this.secret, userId)
      const result = current.rowCount
        ? await client.query('UPDATE user_budget_learning_profiles SET encrypted_payload=$2, version=$3, updated_at=now() WHERE user_id=$1 RETURNING version, updated_at', [userId, encrypted, nextVersion])
        : await client.query('INSERT INTO user_budget_learning_profiles (user_id, encrypted_payload, version, updated_at) VALUES ($1,$2,$3,now()) RETURNING version, updated_at', [userId, encrypted, nextVersion])
      await client.query('COMMIT')
      return {
        profile: nextProfile,
        version: Number(result.rows[0].version),
        updatedAt: new Date(result.rows[0].updated_at).toISOString(),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async reset(userId) {
    const result = await this.pool.query('DELETE FROM user_budget_learning_profiles WHERE user_id=$1', [userId])
    return result.rowCount === 1
  }
}
