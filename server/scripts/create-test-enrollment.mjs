import { writeFile } from 'node:fs/promises'
import { createTestEnrollment } from '../src/test-enrollment.js'

const email = String(process.argv[2] || process.env.TEST_ACCOUNT_EMAIL || '').trim()
const name = String(process.env.TEST_ACCOUNT_NAME || 'Finance Planner Test').trim()
const ttlMinutes = Number(process.env.TEST_ENROLLMENT_TTL_MINUTES || 15)
const origin = String(process.env.APP_ORIGIN || 'http://localhost:8080').replace(/\/$/, '')
const outputPath = String(process.env.TEST_ENROLLMENT_OUTPUT || '/tmp/finance-planner-test-enrollment.txt')

const result = await createTestEnrollment({ email, name, ttlMinutes })
const enrollmentUrl = `${origin}/test-enrollment?token=${encodeURIComponent(result.token)}`
await writeFile(outputPath, `${enrollmentUrl}\n`, { mode: 0o600 })

console.log(JSON.stringify({
  email: result.email,
  userId: result.userId,
  expiresAt: new Date(result.expiresAt).toISOString(),
  enrollmentUrlFile: outputPath,
  note: 'Read the URL file from the server terminal and delete it after enrollment.',
}, null, 2))
