import { createTestEnrollment } from '../src/test-enrollment.js'

const email = String(process.argv[2] || process.env.TEST_ACCOUNT_EMAIL || '').trim()
const name = String(process.env.TEST_ACCOUNT_NAME || 'Finance Planner Test').trim()
const ttlMinutes = Number(process.env.TEST_ENROLLMENT_TTL_MINUTES || 15)
const origin = String(process.env.APP_ORIGIN || 'http://localhost:8080').replace(/\/$/, '')

const result = await createTestEnrollment({ email, name, ttlMinutes })
const url = `${origin}/test-enrollment?token=${encodeURIComponent(result.token)}`

console.log(JSON.stringify({
  email: result.email,
  userId: result.userId,
  expiresAt: new Date(result.expiresAt).toISOString(),
  enrollmentUrl: url,
}, null, 2))
