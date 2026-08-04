import { createHash } from 'node:crypto'

export function normalizeTestAccountEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid TEST_ACCOUNT_EMAIL is required.')
  }
  return email
}

export function requireTestAccountName(value) {
  const name = String(value || '').trim()
  if (name.length < 1 || name.length > 120) {
    throw new Error('TEST_ACCOUNT_NAME is required and must contain at most 120 characters.')
  }
  return name
}

export function testAccountUserId(email) {
  return `test:${createHash('sha256').update(normalizeTestAccountEmail(email)).digest('hex').slice(0, 24)}`
}

export async function provisionTestAccount({ store, email, name, now = new Date() }) {
  const normalizedEmail = normalizeTestAccountEmail(email)
  const normalizedName = requireTestAccountName(name)
  const userId = testAccountUserId(normalizedEmail)
  const timestamp = now.toISOString()
  let created = false

  await store.mutate((data) => {
    const byId = data.users[userId]
    const byEmail = store.findByEmail(normalizedEmail)
    if (byEmail && byEmail.id !== userId) {
      throw new Error('A non-test account already uses TEST_ACCOUNT_EMAIL.')
    }

    const user = byId || {
      id: userId,
      email: normalizedEmail,
      name: normalizedName,
      passkeys: [],
      createdAt: timestamp,
    }

    created = !byId
    user.email = normalizedEmail
    user.name = normalizedName
    user.passkeys ||= []
    user.updatedAt = timestamp
    data.users[userId] = user
  })

  return { created, userId, email: normalizedEmail }
}

export async function verifyProvisionedTestAccount({ store, email, expectedUserId }) {
  await store.load()
  const user = store.findByEmail(normalizeTestAccountEmail(email))
  if (!user || user.id !== expectedUserId) {
    throw new Error('Test account persistence verification failed.')
  }
  return user
}
