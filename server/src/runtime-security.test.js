import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpError, SlidingWindowRateLimiter, classifyError, requestId, validateProductionConfig } from './runtime-security.js'

test('requestId accepts safe values and replaces unsafe input', () => {
  assert.equal(requestId({ 'x-request-id': 'request-1234' }), 'request-1234')
  assert.match(requestId({ 'x-request-id': '<script>' }), /^[0-9a-f-]{36}$/)
})

test('rate limiter blocks requests over the configured window limit', () => {
  const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000 })
  assert.equal(limiter.consume('client', 0).allowed, true)
  assert.equal(limiter.consume('client', 1).allowed, true)
  assert.equal(limiter.consume('client', 2).allowed, false)
  assert.equal(limiter.consume('client', 1001).allowed, true)
})

test('classifyError returns stable public error responses', () => {
  assert.deepEqual(classifyError(new HttpError(415, 'unsupported_media_type', 'JSON required.')), {
    status: 415,
    code: 'unsupported_media_type',
    message: 'JSON required.',
  })
  assert.equal(classifyError(new Error('Invalid session.')).status, 401)
  assert.equal(classifyError(new Error('Request body too large.')).status, 413)
})

test('classifyError hides unexpected exception details behind a 500 response', () => {
  assert.deepEqual(classifyError(new Error('provider secret leaked in stack message')), {
    status: 500,
    code: 'internal_error',
    message: 'Internal server error.',
  })
  assert.deepEqual(classifyError('raw upstream failure'), {
    status: 500,
    code: 'internal_error',
    message: 'Internal server error.',
  })
})

test('public production configuration rejects local auth and insecure origins', () => {
  const publicProduction = { NODE_ENV: 'production', PUBLIC_DEPLOYMENT: 'true' }
  assert.throws(() => validateProductionConfig({ ...publicProduction, AUTH_MODE: 'local' }, 'https://app.example'), /AUTH_MODE/)
  assert.throws(() => validateProductionConfig(publicProduction, 'http://app.example'), /HTTPS/)
  assert.doesNotThrow(() => validateProductionConfig(publicProduction, 'https://app.example'))
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'production', AUTH_MODE: 'local' }, 'http://localhost:8080'))
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'development', PUBLIC_DEPLOYMENT: 'true', AUTH_MODE: 'local' }, 'http://localhost:5173'))
})
