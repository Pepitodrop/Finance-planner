import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const COBOL_INTEGER = /^[+-]?\d{1,16}$/
const ACCOUNT_TYPES = new Set(['checking', 'savings', 'cash', 'investment', 'credit-card'])
const CONSENT_STATES = new Set(['ready', 'pending', 'expired'])

export class CobolBankingCoreError extends Error {
  constructor(message, code = 'cobol_banking_error', options = undefined) {
    super(message, options)
    this.name = 'CobolBankingCoreError'
    this.code = code
  }
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value)) throw new CobolBankingCoreError(`${field} must be a safe integer.`, 'invalid_money')
  return value
}

function safeCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999) {
    throw new CobolBankingCoreError(`${field} must be a bounded non-negative integer.`, 'invalid_reconciliation')
  }
  return value
}

function parseCobolInteger(value, field) {
  // Edited COBOL numeric pictures may contain display padding between a sign
  // and the digits. Removing display-only whitespace does not alter the value.
  const normalized = String(value).replace(/\s+/g, '')
  if (!COBOL_INTEGER.test(normalized)) {
    throw new CobolBankingCoreError(`Malformed ${field} returned by COBOL.`, 'malformed_cobol_output')
  }
  return safeInteger(Number(normalized), field)
}

export function normalizeCreditCardFallback({ providerBalanceCents, creditLimitCents = 0, pendingAmountCents = 0 }) {
  const raw = safeInteger(providerBalanceCents, 'providerBalanceCents')
  const limit = Math.max(0, safeInteger(creditLimitCents, 'creditLimitCents'))
  const pending = Math.abs(safeInteger(pendingAmountCents, 'pendingAmountCents'))
  const amountOwedCents = Math.abs(raw)
  return {
    amountOwedCents,
    ledgerBalanceCents: -amountOwedCents,
    availableCreditCents: limit > 0 ? Math.max(0, limit - amountOwedCents - pending) : undefined,
    pendingAmountCents: pending,
  }
}

export function normalizeAccountTypeFallback(value) {
  const key = String(value || '').trim().toLowerCase()
  const aliases = new Map([
    ['girokonto', 'checking'], ['current', 'checking'], ['checking', 'checking'],
    ['sparkonto', 'savings'], ['savings', 'savings'], ['deposit', 'savings'],
    ['cash', 'cash'], ['bargeld', 'cash'],
    ['depot', 'investment'], ['investment', 'investment'], ['brokerage', 'investment'],
    ['credit-card', 'credit-card'], ['creditcard', 'credit-card'], ['kreditkarte', 'credit-card'], ['card', 'credit-card'],
  ])
  const normalized = aliases.get(key)
  if (!normalized) throw new CobolBankingCoreError('Unsupported account type.', 'unsupported_account_type')
  return normalized
}

function parseResult(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).at(-1) || ''
  const parts = line.split('|').map((part) => part.trim())
  if (parts[0] !== 'OK') throw new CobolBankingCoreError(parts[1] || 'COBOL core rejected the operation.', 'cobol_rejected_operation')
  return parts.slice(1)
}

export class CobolBankingCore {
  constructor({ binary = process.env.COBOL_BANKING_BINARY || '/app/cobol/banking-core', required = process.env.COBOL_BANKING_REQUIRED === 'true' } = {}) {
    this.binary = binary
    this.required = required
    this.available = null
  }

  async isAvailable() {
    if (this.available !== null) return this.available
    try { await access(this.binary); this.available = true } catch { this.available = false }
    return this.available
  }

  async execute(args) {
    if (!await this.isAvailable()) {
      if (this.required) throw new CobolBankingCoreError('Compiled COBOL banking core is unavailable.', 'cobol_unavailable')
      return null
    }

    try {
      const { stdout } = await execFileAsync(this.binary, args, { timeout: 2_000, maxBuffer: 16_384, windowsHide: true })
      return parseResult(stdout)
    } catch (error) {
      if (error instanceof CobolBankingCoreError) throw error
      // execFile error messages contain the command and arguments. Provider
      // arguments can include financial values, so they must never cross the
      // process boundary in a client-visible or operational error message.
      throw new CobolBankingCoreError(
        'COBOL banking operation failed.',
        'cobol_execution_failed',
        { cause: error },
      )
    }
  }

  async executeProviderOperation(args) {
    const result = await this.execute(args)
    if (!result) {
      throw new CobolBankingCoreError(
        'Compiled COBOL banking core is required for provider banking operations.',
        'cobol_unavailable',
      )
    }
    return result
  }

  async normalizeAccountType(value) {
    const result = await this.execute(['normalize-account-type', String(value)])
    const normalized = result?.[0] || normalizeAccountTypeFallback(value)
    if (!ACCOUNT_TYPES.has(normalized)) throw new CobolBankingCoreError('Malformed account type returned by COBOL.', 'malformed_cobol_output')
    return normalized
  }

  async normalizeProviderAccountType(value) {
    const result = await this.executeProviderOperation(['normalize-provider-account-type', String(value || '')])
    const normalized = result[0]
    if (!ACCOUNT_TYPES.has(normalized)) throw new CobolBankingCoreError('Malformed provider account type returned by COBOL.', 'malformed_cobol_output')
    return normalized
  }

  async normalizeProviderAmount(value) {
    const result = await this.executeProviderOperation(['normalize-provider-amount', String(value)])
    if (result.length !== 1) throw new CobolBankingCoreError('Malformed provider amount returned by COBOL.', 'malformed_cobol_output')
    return parseCobolInteger(result[0], 'provider amount')
  }

  async validateProviderConsent(provider, status) {
    const result = await this.executeProviderOperation(['validate-provider-consent', String(provider), String(status || '')])
    const consent = result[0]
    if (!CONSENT_STATES.has(consent)) throw new CobolBankingCoreError('Malformed provider consent state returned by COBOL.', 'malformed_cobol_output')
    return consent
  }

  async validateReadOnlyScope(scope) {
    const result = await this.executeProviderOperation(['validate-read-only-scope', String(scope)])
    if (result.length !== 1 || result[0] !== 'read-only') throw new CobolBankingCoreError('Malformed read-only scope result returned by COBOL.', 'malformed_cobol_output')
    return true
  }

  async validateProviderReconciliation({ accountCount, reconciledAccountCount, transactionCount, uniqueTransactionCount, dateFrom, dateTo }) {
    const result = await this.executeProviderOperation([
      'validate-provider-reconciliation',
      String(safeCount(accountCount, 'accountCount')),
      String(safeCount(reconciledAccountCount, 'reconciledAccountCount')),
      String(safeCount(transactionCount, 'transactionCount')),
      String(safeCount(uniqueTransactionCount, 'uniqueTransactionCount')),
      String(dateFrom || ''),
      String(dateTo || ''),
    ])
    if (result.length !== 1 || result[0] !== 'reconciled') {
      throw new CobolBankingCoreError('Malformed reconciliation result returned by COBOL.', 'malformed_cobol_output')
    }
    return true
  }

  async normalizeCreditCard(input) {
    const fallback = normalizeCreditCardFallback(input)
    const result = await this.execute([
      'normalize-credit-card',
      String(input.providerBalanceCents),
      String(input.creditLimitCents || 0),
      String(input.pendingAmountCents || 0),
    ])
    if (!result) return fallback
    if (result.length !== 4) throw new CobolBankingCoreError('Malformed credit-card result returned by COBOL.', 'malformed_cobol_output')
    const [amountOwedCents, ledgerBalanceCents, availableCreditCents, pendingAmountCents] = result.map((value, index) => parseCobolInteger(value, ['amount owed', 'ledger balance', 'available credit', 'pending amount'][index]))
    for (const [field, value] of Object.entries({ amountOwedCents, ledgerBalanceCents, availableCreditCents, pendingAmountCents })) safeInteger(value, field)
    if (amountOwedCents < 0 || ledgerBalanceCents > 0 || availableCreditCents < 0 || pendingAmountCents < 0) throw new CobolBankingCoreError('Invalid credit-card invariants returned by COBOL.', 'malformed_cobol_output')
    return { amountOwedCents, ledgerBalanceCents, availableCreditCents: input.creditLimitCents > 0 ? availableCreditCents : undefined, pendingAmountCents }
  }
}
