import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EncryptedStore } from '../src/crypto-store.js'

const secret = '0123456789abcdef0123456789abcdef'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-'))
  const path = join(directory, 'connectors.enc.json')
  const store = new EncryptedStore(path, secret)
  await store.load()
  return { directory, path, store }
}

function setupInput(overrides = {}) {
  return {
    nonce: 'nonce-atomic',
    consentId: 'consent-atomic',
    userId: 'user-atomic',
    provider: 'gocardless',
    redirectUri: 'https://app.test/callback',
    expiresAt: Date.now() + 60_000,
    connection: { requisitionId: 'req-atomic', consentId: 'consent-atomic', redirectUri: 'https://app.test/callback' },
    ...overrides,
  }
}

test('credential store persists encrypted data and reloads it', async () => {
  const { directory, path, store } = await fixture()
  try {
    await store.set('user-1', 'paypal', { accessToken: 'secret-token', lastSyncAt: '2026-07-26T00:00:00.000Z' })
    const raw = await readFile(path, 'utf8')
    assert.equal(raw.includes('secret-token'), false)
    const reopened = new EncryptedStore(path, secret)
    await reopened.load()
    assert.equal(reopened.get('user-1', 'paypal').accessToken, 'secret-token')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('wrong master key cannot decrypt the store', async () => {
  const { directory, path, store } = await fixture()
  try {
    await store.set('user-1', 'gocardless', { requisitionId: 'req-1' })
    const wrong = new EncryptedStore(path, 'abcdef0123456789abcdef0123456789')
    await assert.rejects(() => wrong.load())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('oauth nonces survive restart and can only be consumed once', async () => {
  const { directory, path, store } = await fixture()
  try {
    const input = {
      nonce: 'nonce-1', consentId: 'consent-1', userId: 'user-1', provider: 'gocardless',
      redirectUri: 'https://app.test/callback', expiresAt: Date.now() + 60_000,
    }
    await store.registerOAuthNonce(input)
    const restarted = new EncryptedStore(path, secret)
    await restarted.load()
    assert.equal(await restarted.consumeOAuthNonce({ ...input, now: Date.now() }), true)
    assert.equal(await restarted.consumeOAuthNonce({ ...input, now: Date.now() }), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('oauth nonce consumption rejects consent mismatches without consuming the valid nonce', async () => {
  const { directory, store } = await fixture()
  try {
    const input = {
      nonce: 'nonce-2', consentId: 'consent-1', userId: 'user-1', provider: 'paypal',
      redirectUri: 'https://app.test/callback', expiresAt: Date.now() + 60_000,
    }
    await store.registerOAuthNonce(input)
    assert.equal(await store.consumeOAuthNonce({ ...input, consentId: 'consent-2', now: Date.now() }), false)
    assert.equal(await store.consumeOAuthNonce({ ...input, now: Date.now() }), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('pending connection setup and nonce registration persist as one transition; claimPendingConnectionSetup + finalizeConnection replace a currently-working connection only once both steps succeed', async () => {
  const { directory, path, store } = await fixture()
  try {
    const input = setupInput()
    // A previously-working connection for this same user/provider (the
    // reconnect case) must survive an in-flight, not-yet-activated setup.
    await store.set(input.userId, input.provider, { requisitionId: 'req-previously-working', connectedAt: '2026-07-01T00:00:00.000Z' })
    await store.createPendingConnectionSetup(input)
    const restarted = new EncryptedStore(path, secret)
    await restarted.load()
    assert.equal(restarted.get(input.userId, input.provider).requisitionId, 'req-previously-working', 'the working connection must not be overwritten before consumption')

    const claim = await restarted.claimPendingConnectionSetup({ ...input, now: Date.now() })
    assert.equal(claim.status, 'claimed')
    assert.equal(claim.connection?.requisitionId, 'req-atomic')
    assert.equal(restarted.get(input.userId, input.provider).requisitionId, 'req-previously-working', 'claiming the nonce alone must not yet touch the working connection -- that is finalizeConnection\'s job, standing in for a provider completeCallback() step that has not run yet')

    // The nonce is claimed, not deleted -- a second claim attempt while
    // unresolved must see it as in progress, never as available to re-claim.
    assert.equal((await restarted.claimPendingConnectionSetup({ ...input, now: Date.now() })).status, 'in_progress')

    await restarted.finalizeConnection({ userId: input.userId, provider: input.provider, connection: claim.connection, connectedAt: '2026-07-27T12:00:00.000Z' })
    assert.equal(restarted.get(input.userId, input.provider).requisitionId, 'req-atomic', 'finalization replaces the working connection with the newly-verified one')

    // Only after the claimer releases it (here, simulating the success path)
    // does the nonce genuinely disappear -- matching the original single-use
    // guarantee, just moved to after finalization instead of before the
    // provider network call.
    assert.equal(await restarted.releasePendingConnectionSetup({ nonce: input.nonce, claimToken: claim.claimToken }), true)
    assert.equal((await restarted.claimPendingConnectionSetup({ ...input, now: Date.now() })).status, 'not_found')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed pending setup persistence rolls back both the pending credential and nonce', async () => {
  const { directory, store } = await fixture()
  try {
    const input = setupInput()
    const originalSave = store.save.bind(store)
    store.save = async () => { throw new Error('disk unavailable') }
    await assert.rejects(() => store.createPendingConnectionSetup(input), /disk unavailable/)
    store.save = originalSave
    assert.equal(store.get(input.userId, input.provider), null)
    assert.equal((await store.claimPendingConnectionSetup({ ...input, now: Date.now() })).status, 'not_found')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('finalizeConnection retries a transient write failure internally and still succeeds', async () => {
  const { directory, path, store } = await fixture()
  try {
    const input = setupInput()
    await store.createPendingConnectionSetup(input)
    const claim = await store.claimPendingConnectionSetup({ ...input, now: Date.now() })
    assert.equal(claim.status, 'claimed')

    let attempts = 0
    const originalSave = store.save.bind(store)
    store.save = async (...args) => {
      attempts += 1
      if (attempts < 2) throw new Error('disk unavailable')
      return originalSave(...args)
    }
    await store.finalizeConnection({ userId: input.userId, provider: input.provider, connection: claim.connection, connectedAt: '2026-07-27T12:00:00.000Z' })
    store.save = originalSave

    assert.ok(attempts >= 2, 'finalizeConnection should retry a transient failure before succeeding')
    const restarted = new EncryptedStore(path, secret)
    await restarted.load()
    assert.equal(restarted.get(input.userId, input.provider).connectedAt, '2026-07-27T12:00:00.000Z')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a persistent finalizeConnection failure never touches a previously-working connection, and the already-claimed nonce cannot be reused for a silent retry', async () => {
  const { directory, store } = await fixture()
  try {
    const input = setupInput()
    await store.set(input.userId, input.provider, { requisitionId: 'req-previously-working', connectedAt: '2026-07-01T00:00:00.000Z' })
    await store.createPendingConnectionSetup(input)
    const claim = await store.claimPendingConnectionSetup({ ...input, now: Date.now() })
    assert.equal(claim.status, 'claimed')

    const originalSave = store.save.bind(store)
    store.save = async () => { throw new Error('disk unavailable') }
    await assert.rejects(
      () => store.finalizeConnection({ userId: input.userId, provider: input.provider, connection: claim.connection, connectedAt: '2026-07-27T12:00:00.000Z' }),
      /disk unavailable/,
    )
    assert.equal(store.get(input.userId, input.provider).requisitionId, 'req-previously-working', 'a failed finalization must not have touched the still-working connection')

    // mutate() persists unconditionally on every call, including a no-op
    // lookup -- restore save() first so this checks the real question
    // (is the nonce still exclusively claimed) rather than re-hitting the
    // same still-broken disk.
    store.save = originalSave
    assert.equal(
      (await store.claimPendingConnectionSetup({ ...input, now: Date.now() })).status,
      'in_progress',
      'the nonce is still claimed by the first (ultimately-failed, not-yet-released) attempt and cannot be re-claimed for a silent retry',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('webhook leases fence stale workers and survive restart', async () => {
  const { directory, path, store } = await fixture()
  try {
    const now = new Date('2026-07-27T12:00:00.000Z')
    const first = await store.claimWebhookEvent({
      provider: 'gocardless', eventId: 'event-1', occurredAt: now.toISOString(), now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 1000).toISOString(),
    })
    assert.ok(first)
    const restarted = new EncryptedStore(path, secret)
    await restarted.load()
    assert.equal(await restarted.claimWebhookEvent({
      provider: 'gocardless', eventId: 'event-1', occurredAt: now.toISOString(),
      now: new Date(now.getTime() + 500).toISOString(), leaseUntil: new Date(now.getTime() + 1500).toISOString(),
    }), undefined)
    const second = await restarted.claimWebhookEvent({
      provider: 'gocardless', eventId: 'event-1', occurredAt: now.toISOString(),
      now: new Date(now.getTime() + 1100).toISOString(), leaseUntil: new Date(now.getTime() + 2100).toISOString(),
    })
    assert.ok(second)
    assert.notEqual(second, first)
    assert.equal(await restarted.completeWebhookEvent({
      provider: 'gocardless', eventId: 'event-1', leaseToken: first, completedAt: now.toISOString(),
    }), false)
    assert.equal(await restarted.completeWebhookEvent({
      provider: 'gocardless', eventId: 'event-1', leaseToken: second, completedAt: now.toISOString(),
    }), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed webhook work can release its owned lease for retry', async () => {
  const { directory, store } = await fixture()
  try {
    const now = new Date('2026-07-27T12:00:00.000Z')
    const token = await store.claimWebhookEvent({
      provider: 'paypal', eventId: 'event-2', occurredAt: now.toISOString(), now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
    })
    assert.ok(token)
    assert.equal(await store.releaseWebhookEvent({ provider: 'paypal', eventId: 'event-2', leaseToken: token }), true)
    assert.ok(await store.claimWebhookEvent({
      provider: 'paypal', eventId: 'event-2', occurredAt: now.toISOString(), now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
    }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
