import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptCloudPayload, encryptCloudPayload, validateCloudPayload } from './user-state-store.js'

const secret = 'state-store-test-secret-that-is-long-enough-123456'
const userId = 'google:test-user'
const payload = {
  state: {
    accounts: [{ id: 'account-1', name: 'Girokonto', type: 'checking', balanceCents: 123400, currency: 'EUR' }],
    transactions: [{ id: 'transaction-1', accountId: 'account-1', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 4299, date: '2026-07-31', recurring: false }],
    goals: [{ id: 'goal-1', name: 'Notgroschen', targetCents: 500000, currentCents: 125000, targetDate: '2027-01-01' }],
  },
  secureData: {
    'behavior-graph-v1': [{ merchant: 'rewe', category: 'Lebensmittel', weight: 0.8 }],
    'assistant-memory-v1': [{ question: 'Wie spare ich?', answer: 'Regelmäßig.', mode: 'question', createdAt: '2026-07-31T09:00:00.000Z' }],
  },
}

test('cloud payload is validated and encrypted without plaintext financial records', () => {
  const normalized = validateCloudPayload(payload)
  const encrypted = encryptCloudPayload(normalized, secret, userId)
  assert.equal(encrypted.format, 'finance-planner-user-state')
  assert.equal(JSON.stringify(encrypted).includes('REWE'), false)
  assert.deepEqual(decryptCloudPayload(encrypted, secret, userId), normalized)
  assert.throws(() => decryptCloudPayload(encrypted, secret, 'google:other-user'))
})

test('cloud payload accepts the credit-card account type used by the account liability UI', () => {
  const normalized = validateCloudPayload({
    ...payload,
    state: {
      ...payload.state,
      accounts: [
        ...payload.state.accounts,
        { id: 'card-1', name: 'Test Kreditkarte', type: 'credit-card', balanceCents: -84530, currency: 'EUR' },
      ],
    },
  })
  assert.equal(normalized.state.accounts.at(-1).type, 'credit-card')
  assert.equal(normalized.state.accounts.at(-1).balanceCents, -84530)
})

test('cloud payload rejects unknown fields and broken account references', () => {
  assert.throws(() => validateCloudPayload({ ...payload, unexpected: true }), /Unexpected payload field/)
  assert.throws(() => validateCloudPayload({
    ...payload,
    state: { ...payload.state, transactions: [{ ...payload.state.transactions[0], accountId: 'missing' }] },
  }), /existing account/)
})

test('cloud payload rejects malformed secure values', () => {
  assert.throws(() => validateCloudPayload({ ...payload, secureData: { invalid: Number.NaN } }), /non-finite/)
})

// Found live 2026-08-26 (PR #154, sixth Mock ASPSP pass): the very first
// provider-imported account Finance Planner ever actually synced and tried
// to persist to cloud state was rejected with "Unexpected accounts[0]
// field: externalId", forcing the app into LOCAL MODE immediately after a
// successful bank sync -- validateAccount()'s allow-list had gone stale
// relative to the real Account domain type (src/domain/finance/types.ts)
// the moment institutionId/externalId/lastSyncedAt/creditCard were added
// for connector-imported accounts. This fixture is the EXACT shape
// buildSyncPreview() (src/connectors.ts) constructs for a real connector
// account, not a hand-simplified approximation of it.
function connectorImportedAccount(overrides = {}) {
  return {
    id: 'connector:enablebanking:acct-1',
    externalId: 'acct-1',
    institutionId: 'DE:ING-DiBa',
    name: 'Girokonto',
    type: 'checking',
    balanceCents: 695950,
    currency: 'EUR',
    lastSyncedAt: '2026-08-26T14:19:00.000Z',
    ...overrides,
  }
}

test('cloud payload accepts a real connector-imported account (the exact shape buildSyncPreview() creates)', () => {
  const normalized = validateCloudPayload({
    ...payload,
    state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount()] },
  })
  const imported = normalized.state.accounts.find((account) => account.id === 'connector:enablebanking:acct-1')
  assert.deepEqual(imported, connectorImportedAccount())
})

test('save/encrypt/decrypt/load preserves connector metadata exactly', () => {
  const normalized = validateCloudPayload({
    ...payload,
    state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount()] },
  })
  const encrypted = encryptCloudPayload(normalized, secret, userId)
  const decrypted = decryptCloudPayload(encrypted, secret, userId)
  assert.deepEqual(decrypted, normalized)
  const imported = decrypted.state.accounts.find((account) => account.id === 'connector:enablebanking:acct-1')
  assert.equal(imported.institutionId, 'DE:ING-DiBa')
  assert.equal(imported.externalId, 'acct-1')
  assert.equal(imported.lastSyncedAt, '2026-08-26T14:19:00.000Z')
})

test('an account with any OTHER unknown field is still rejected -- the fix is a specific allow-list, not a general loosening', () => {
  assert.throws(
    () => validateCloudPayload({
      ...payload,
      state: { ...payload.state, accounts: [...payload.state.accounts, { ...connectorImportedAccount(), providerAccessToken: 'should-never-be-here' }] },
    }),
    /Unexpected accounts\[1\] field: providerAccessToken/,
  )
})

test('oversized externalId/institutionId are rejected', () => {
  assert.throws(
    () => validateCloudPayload({
      ...payload,
      state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount({ externalId: 'x'.repeat(257) })] },
    }),
    /accounts\[1\]\.externalId is invalid/,
  )
  assert.throws(
    () => validateCloudPayload({
      ...payload,
      state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount({ institutionId: 'x'.repeat(257) })] },
    }),
    /accounts\[1\]\.institutionId is invalid/,
  )
})

test('an empty externalId is rejected -- optional means "absent or valid", never "present but blank"', () => {
  assert.throws(
    () => validateCloudPayload({
      ...payload,
      state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount({ externalId: '' })] },
    }),
    /accounts\[1\]\.externalId is invalid/,
  )
})

test('malformed lastSyncedAt is rejected', () => {
  assert.throws(
    () => validateCloudPayload({
      ...payload,
      state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount({ lastSyncedAt: 'not-a-real-date' })] },
    }),
    /accounts\[1\]\.lastSyncedAt must be a valid timestamp/,
  )
  assert.throws(
    () => validateCloudPayload({
      ...payload,
      state: { ...payload.state, accounts: [...payload.state.accounts, connectorImportedAccount({ lastSyncedAt: 'x'.repeat(41) })] },
    }),
    /accounts\[1\]\.lastSyncedAt must be a valid timestamp/,
  )
})

test('valid creditCard metadata round-trips exactly', () => {
  const creditCardAccount = connectorImportedAccount({
    id: 'connector:enablebanking:card-1',
    externalId: 'card-1',
    type: 'credit-card',
    balanceCents: -84530,
    creditCard: {
      amountOwedCents: 84530,
      availableCreditCents: 415470,
      creditLimitCents: 500000,
      statementBalanceCents: 84530,
      pendingAmountCents: 1299,
      minimumPaymentCents: 5000,
      statementDate: '2026-08-01',
      paymentDueDate: '2026-08-20',
    },
  })
  const normalized = validateCloudPayload({
    ...payload,
    state: { ...payload.state, accounts: [...payload.state.accounts, creditCardAccount] },
  })
  const imported = normalized.state.accounts.find((account) => account.id === 'connector:enablebanking:card-1')
  assert.deepEqual(imported.creditCard, creditCardAccount.creditCard)
  const roundTripped = decryptCloudPayload(encryptCloudPayload(normalized, secret, userId), secret, userId)
  assert.deepEqual(roundTripped.state.accounts.find((account) => account.id === 'connector:enablebanking:card-1').creditCard, creditCardAccount.creditCard)
})

test('malformed/unknown creditCard fields fail closed', () => {
  const base = connectorImportedAccount({ id: 'connector:enablebanking:card-2', externalId: 'card-2', type: 'credit-card' })
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, accounts: [...payload.state.accounts, { ...base, creditCard: { amountOwedCents: 100, providerRawBalance: 100 } }] } }),
    /Unexpected accounts\[1\]\.creditCard field: providerRawBalance/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, accounts: [...payload.state.accounts, { ...base, creditCard: { amountOwedCents: -100 } }] } }),
    /accounts\[1\]\.creditCard\.amountOwedCents must be a safe integer/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, accounts: [...payload.state.accounts, { ...base, creditCard: { amountOwedCents: 100, availableCreditCents: -1 } }] } }),
    /accounts\[1\]\.creditCard\.availableCreditCents must be a safe integer/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, accounts: [...payload.state.accounts, { ...base, creditCard: { amountOwedCents: 100, statementDate: 'not-a-date' } }] } }),
    /accounts\[1\]\.creditCard\.statementDate must be a valid timestamp/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, accounts: [...payload.state.accounts, { ...base, creditCard: 'not-an-object' }] } }),
    /accounts\[1\]\.creditCard must be an object/,
  )
})

test('ordinary manual accounts (no connector fields at all) remain unchanged', () => {
  const normalized = validateCloudPayload(payload)
  assert.deepEqual(normalized.state.accounts, payload.state.accounts)
  assert.equal('externalId' in normalized.state.accounts[0], false)
  assert.equal('institutionId' in normalized.state.accounts[0], false)
  assert.equal('lastSyncedAt' in normalized.state.accounts[0], false)
  assert.equal('creditCard' in normalized.state.accounts[0], false)
})

test('no provider token/session/authorization credential is introduced into cloud state -- the allow-list is exhaustive, not "anything goes"', () => {
  for (const field of ['accessToken', 'refreshToken', 'sessionId', 'providerToken', 'authorizationCode', 'consentId', 'redirectUri']) {
    assert.throws(
      () => validateCloudPayload({
        ...payload,
        state: { ...payload.state, accounts: [...payload.state.accounts, { ...connectorImportedAccount(), [field]: 'should-never-persist' }] },
      }),
      new RegExp(`Unexpected accounts\\[1\\] field: ${field}`),
      `${field} must be rejected, not silently persisted`,
    )
  }
})

// Integration-shaped: buildSyncPreview() output -> VaultPayload -> the exact
// validator /api/finance/state calls. Does not mock away the validator that
// failed live.
test('integration: a successful buildSyncPreview()-shaped sync payload survives the full VaultPayload -> validateCloudPayload() path', () => {
  const vaultPayload = {
    state: {
      accounts: [connectorImportedAccount()],
      transactions: [
        { id: 'connector:enablebanking:tx-1', accountId: 'connector:enablebanking:acct-1', description: 'REWE', category: 'Groceries', type: 'expense', amountCents: 2599, date: '2026-08-25' },
      ],
      goals: [],
    },
    secureData: {},
  }
  const normalized = validateCloudPayload(vaultPayload)
  assert.equal(normalized.state.accounts.length, 1)
  assert.equal(normalized.state.accounts[0].externalId, 'acct-1')
  assert.equal(normalized.state.transactions.length, 1)
  const encrypted = encryptCloudPayload(normalized, secret, userId)
  assert.deepEqual(decryptCloudPayload(encrypted, secret, userId), normalized)
})

// subscriptions: found alongside the same live gap (2026-08-26) --
// google-subscription-data.js's removeGoogleSubscriptionsFromPayload()
// already reads/writes payload.state.subscriptions on Google Subscriptions
// disconnect, but validateCloudPayload() never allowed that key at all, so
// no state carrying subscriptions could ever actually be saved in the first
// place. See user-state-store.js's validateSubscription() doc comment.
const subscription = {
  id: 'google:sub-1',
  provider: 'google-subscriptions',
  product: 'YouTube Premium',
  amountCents: 1299,
  currency: 'EUR',
  billingInterval: 'monthly',
  status: 'active',
  source: 'google',
  externalId: 'google:play:sub-1',
  lastSyncedAt: '2026-08-26T14:19:00.000Z',
}

test('cloud payload accepts a subscriptions array and round-trips it exactly', () => {
  const normalized = validateCloudPayload({ ...payload, state: { ...payload.state, subscriptions: [subscription] } })
  assert.deepEqual(normalized.state.subscriptions, [subscription])
  const roundTripped = decryptCloudPayload(encryptCloudPayload(normalized, secret, userId), secret, userId)
  assert.deepEqual(roundTripped.state.subscriptions, [subscription])
})

test('a state with no subscriptions key at all (every payload saved before this fix) still validates, defaulting to an empty array', () => {
  const normalized = validateCloudPayload(payload)
  assert.deepEqual(normalized.state.subscriptions, [])
})

test('subscriptions reject unknown fields, invalid enums, and duplicate IDs', () => {
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, subscriptions: [{ ...subscription, providerToken: 'x' }] } }),
    /Unexpected subscriptions\[0\] field: providerToken/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, subscriptions: [{ ...subscription, status: 'not-a-real-status' }] } }),
    /subscriptions\[0\]\.status is invalid/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, subscriptions: [{ ...subscription, billingInterval: 'daily' }] } }),
    /subscriptions\[0\]\.billingInterval is invalid/,
  )
  assert.throws(
    () => validateCloudPayload({ ...payload, state: { ...payload.state, subscriptions: [subscription, subscription] } }),
    /Subscription IDs must be unique/,
  )
})
