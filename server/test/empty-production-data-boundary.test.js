import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const repoFile = (path) => new URL(`../../${path}`, import.meta.url)

test('production data module contains no bundled legacy account/transaction/goal records', async () => {
  const source = await readFile(repoFile('src/data.ts'), 'utf8')
  assert.match(source, /accounts:\s*\[\]/)
  assert.match(source, /transactions:\s*\[\]/)
  assert.match(source, /goals:\s*\[\]/)
  for (const oldValue of ['Girokonto', 'Tagesgeld', 'Bargeld', 'Warmmiete', 'Werkstudentenjob', 'Notgroschen']) {
    assert.equal(source.includes(oldValue), false, `src/data.ts must not contain legacy starter value ${oldValue}`)
  }
})

test('test-account provisioning cannot seed a file implicitly', async () => {
  const source = await readFile(repoFile('server/scripts/create-test-account.mjs'), 'utf8')
  assert.equal(source.includes('TEST_ACCOUNT_SEED_FILE'), false)
  assert.equal(source.includes('user_finance_state'), false)
})

test('private deployment helper scripts are not repository files', async () => {
  const marker = await readFile(repoFile('docs/PRIVATE_DEPLOYMENT_HELPERS.md'), 'utf8')
  assert.match(marker, /deliberately kept outside this repository/)
})
