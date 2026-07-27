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

test('oauth nonce consumption rejects consent mismatches', async () => {
  const { directory, store } = await fixture()
  try {
    const input = {
      nonce: 'nonce-2', consentId: 'consent-1', userId: 'user-1', provider: 'paypal',
      redirectUri: 'https://app.test/callback', expiresAt: Date.now() + 60_000,
    }
    await store.registerOAuthNonce(input)
    assert.equal(await store.consumeOAuthNonce({ ...input, consentId: 'consent-2', now: Date.now() }), false)
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
