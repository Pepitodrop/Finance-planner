import test from 'node:test'
import assert from 'node:assert/strict'
import { createFinanceRouter } from './finance-router.js'

function fixture(input = { balanceCents: 100000, monthlyContributionCents: 25000, months: 12 }) {
  const sent = []
  let authenticated = false
  let projectedArgs
  const handle = createFinanceRouter({
    env: { NODE_ENV: 'test' },
    body: async () => input,
    userId: () => {
      authenticated = true
      return 'user-1'
    },
    send: (_response, status, payload) => sent.push({ status, payload }),
    projectSavings: async (...args) => {
      projectedArgs = args
      return 400000
    },
  })
  return { handle, sent, wasAuthenticated: () => authenticated, projectedArgs: () => projectedArgs }
}

test('finance route exposes the authenticated COBOL savings projection', async () => {
  const state = fixture()
  const handled = await state.handle(
    { method: 'POST' },
    {},
    new URL('http://localhost/api/finance/project-savings'),
  )

  assert.equal(handled, true)
  assert.equal(state.wasAuthenticated(), true)
  assert.deepEqual(state.projectedArgs().slice(0, 3), [100000, 25000, 12])
  assert.deepEqual(state.sent(), [{
    status: 200,
    payload: {
      balanceCents: 100000,
      monthlyContributionCents: 25000,
      months: 12,
      projectedBalanceCents: 400000,
      calculationEngine: 'cobol',
    },
  }])
})

test('finance route rejects invalid projection input before invoking COBOL', async () => {
  const state = fixture({ balanceCents: 100000, monthlyContributionCents: 25000, months: 1201 })

  await assert.rejects(
    () => state.handle({ method: 'POST' }, {}, new URL('http://localhost/api/finance/project-savings')),
    (error) => error.status === 400 && error.code === 'invalid_projection_input',
  )
  assert.equal(state.projectedArgs(), undefined)
})

test('finance router ignores unrelated requests', async () => {
  const state = fixture()
  assert.equal(await state.handle({ method: 'GET' }, {}, new URL('http://localhost/health')), false)
  assert.equal(state.wasAuthenticated(), false)
})
