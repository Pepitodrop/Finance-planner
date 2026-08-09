import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const FORMAT = 'scrypt-v1'

export function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (value.length < 3 || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Enter a valid email address.')
  }
  return value
}

export function normalizeDisplayName(name, email) {
  const value = String(name || '').trim().replace(/\s+/g, ' ')
  if (value.length > 100) throw new Error('Name must contain at most 100 characters.')
  return value || normalizeEmail(email).split('@')[0]
}

export function validatePassword(password) {
  const value = String(password || '')
  if (value.length < 12 || value.length > 200) throw new Error('Password must contain between 12 and 200 characters.')
  return value
}

export function hashPassword(password, salt = randomBytes(16)) {
  const value = validatePassword(password)
  const derived = scryptSync(value, salt, KEY_LENGTH, SCRYPT_OPTIONS)
  return `${FORMAT}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export function verifyPassword(password, encodedHash) {
  try {
    const [format, saltText, expectedText, extra] = String(encodedHash || '').split('$')
    if (format !== FORMAT || !saltText || !expectedText || extra !== undefined) return false
    const salt = Buffer.from(saltText, 'base64url')
    const expected = Buffer.from(expectedText, 'base64url')
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false
    const actual = scryptSync(String(password || ''), salt, expected.length, SCRYPT_OPTIONS)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
