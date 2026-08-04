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
  normalizeProviderAccountTypeFallback,
  normalizeProviderAmountFallback,
  validateProviderConsentFallback,
  validateReadOnlyScopeFallback,
} from '../src/cobol-banking-core.js'

test('normalizes German and provider account type aliases', () => {
  assert.equal(normalizeAccountTypeFallback('Girokonto'), 'checking')
  assert.equal(normalizeAccountTypeFallback('Kreditkarte'), 'credit-card')
  assert.equal(normalizeAccountTypeFallback('brokerage'), 'investment')
  assert.equal(normalizeProviderAccountTypeFallback('SVGS'), 'savings')
  assert.equal(normalizeProviderAccountTypeFallback('CARD'), 'credit-card')
  assert.equal(normalizeProviderAccountTypeFallback('unknown-provider-value'), 'checking')
})

test('normalizes provider decimal amounts without floating-point arithmetic', () => {
  assert.equal(normalizeProviderAmountFallback('12.34'), 1234)
  assert.equal(normalizeProviderAmountFallback('-0.01'), -1)
  assert.equal(normalizeProviderAmountFallback('1.2'), 120)
  assert.throws(() => normalizeProviderAmountFallback('1.234'))
})

test('classifies provider consent and rejects money movement scopes', () => {
  assert.equal(validateProviderConsentFallback('gocardless', 'LN'), 'ready')
  assert.equal(validateProviderConsentFallback('gocardless', 'EX'), 'expired')
  assert.equal(validateProviderConsentFallback('gocardless', 'CR'), 'pending')
  assert.equal(validateReadOnlyScopeFallback('balances,details,transactions'), true)
  assert.throws(() => validateReadOnlyScopeFallback('transactions,payment-initiation'), /forbidden/i)
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

test('adapter safely falls back only when the COBOL binary is unavailable', async () => {
  const core = new CobolBankingCore({ binary: '/definitely/not/installed/banking-core', required: false })
  assert.equal(await core.normalizeAccountType('Sparkonto'), 'savings')
  assert.equal(await core.normalizeProviderAccountType('SVGS'), 'savings')
  assert.equal(await core.normalizeProviderAmount('-12.34'), -1234)
  assert.equal(await core.validateProviderConsent('gocardless', 'LN'), 'ready')
  assert.equal(await core.validateReadOnlyScope('reporting,transactions'), true)
  assert.equal((await core.normalizeCreditCard({ providerBalanceCents: 90_00, creditLimitCents: 100_00 })).availableCreditCents, 10_00)
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
