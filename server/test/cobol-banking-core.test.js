import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  CobolBankingCore,
  CobolBankingCoreError,
  normalizeAccountTypeFallback,
  normalizeCreditCardFallback,
} from '../src/cobol-banking-core.js'

test('normalizes manual German account type aliases', () => {
  assert.equal(normalizeAccountTypeFallback('Girokonto'), 'checking')
  assert.equal(normalizeAccountTypeFallback('Kreditkarte'), 'credit-card')
  assert.equal(normalizeAccountTypeFallback('brokerage'), 'investment')
})

test('normalizes a positive provider card debt to a negative ledger liability', () => {
  assert.deepEqual(normalizeCreditCardFallback({ providerBalanceCents: 125_50, creditLimitCents: 500_00, pendingAmountCents: 20_00 }), {
    amountOwedCents: 125_50,
    ledgerBalanceCents: -125_50,
    availableCreditCents: 354_50,
    pendingAmountCents: 20_00,
  })
})

test('normalizes a negative provider card balance without double-negating debt', () => {
  assert.deepEqual(normalizeCreditCardFallback({ providerBalanceCents: -125_50 }), {
    amountOwedCents: 125_50,
    ledgerBalanceCents: -125_50,
    availableCreditCents: undefined,
    pendingAmountCents: 0,
  })
})

test('manual calculations may fall back when COBOL is unavailable outside production', async () => {
  const core = new CobolBankingCore({ binary: '/definitely/not/installed/banking-core', required: false })
  assert.equal(await core.normalizeAccountType('Sparkonto'), 'savings')
  assert.equal((await core.normalizeCreditCard({ providerBalanceCents: 90_00, creditLimitCents: 100_00 })).availableCreditCents, 10_00)
})

test('provider banking operations never fall back to JavaScript', async () => {
  const core = new CobolBankingCore({ binary: '/definitely/not/installed/banking-core', required: false })
  for (const operation of [
    () => core.normalizeProviderAccountType('SVGS'),
    () => core.normalizeProviderAmount('-12.34'),
    () => core.validateProviderConsent('gocardless', 'LN'),
    () => core.validateReadOnlyScope('reporting,transactions'),
  ]) {
    await assert.rejects(
      operation(),
      (error) => error instanceof CobolBankingCoreError && error.code === 'cobol_unavailable',
    )
  }
})

test('an available but failing banking executable is never hidden by fallback logic', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'finance-planner-cobol-failure-'))
  const binary = path.join(directory, 'broken-banking-core')
  try {
    await writeFile(binary, '#!/bin/sh\necho "ERROR|BROKEN_CORE"\nexit 3\n')
    await chmod(binary, 0o755)
    const core = new CobolBankingCore({ binary, required: false })
    await assert.rejects(
      core.normalizeAccountType('Girokonto'),
      (error) => error instanceof CobolBankingCoreError && error.code === 'cobol_execution_failed',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const compiledBinary = process.env.COBOL_BANKING_BINARY

test('compiled GnuCOBOL banking core owns provider normalization and read-only policy', { skip: !compiledBinary }, async () => {
  const core = new CobolBankingCore({ binary: compiledBinary, required: true })
  assert.equal(await core.normalizeAccountType('Girokonto'), 'checking')
  assert.equal(await core.normalizeProviderAccountType('CARD'), 'credit-card')
  assert.equal(await core.normalizeProviderAmount('-125.50'), -12550)
  assert.equal(await core.validateProviderConsent('gocardless', 'LN'), 'ready')
  assert.equal(await core.validateProviderConsent('gocardless', 'EX'), 'expired')
  assert.equal(await core.validateReadOnlyScope('balances,details,transactions'), true)
  await assert.rejects(core.validateReadOnlyScope('transactions,payment-initiation'))
  assert.deepEqual(await core.normalizeCreditCard({
    providerBalanceCents: -125_50,
    creditLimitCents: 500_00,
    pendingAmountCents: -20_00,
  }), {
    amountOwedCents: 125_50,
    ledgerBalanceCents: -125_50,
    availableCreditCents: 354_50,
    pendingAmountCents: 20_00,
  })
})
