import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

 test('database reset demo seed can be validated without a database', () => {
  const result = spawnSync(process.execPath, ['scripts/reset-and-seed-demo.mjs', '--dry-run'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, DEMO_USER_EMAIL: 'qa@example.test', DEMO_USER_NAME: 'QA Demo' },
  })

  assert.equal(result.status, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.dryRun, true)
  assert.equal(summary.email, 'qa@example.test')
  assert.equal(summary.accounts, 6)
  assert.ok(summary.transactions >= 300)
  assert.equal(summary.goals, 5)
})
