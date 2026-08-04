import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const INTEGER = /^-?\d{1,16}$/
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

export function normalizeProviderAccountTypeFallback(value) {
  const key = String(value || '').trim().toUpperCase()
  if (['SVGS', 'SAVINGS', 'DEPOSIT'].includes(key)) return 'savings'
  if (key === 'CASH') return 'cash'
  if (['CARD', 'CREDITCARD', 'CREDIT-CARD'].includes(key)) return 'credit-card'
  if (['INVE', 'INVESTMENT', 'BROKERAGE', 'TRAS'].includes(key)) return 'investment'
  return 'checking'
}

export function normalizeProviderAmountFallback(value) {
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) throw new CobolBankingCoreError('Provider returned an invalid monetary amount.', 'invalid_provider_amount')
  const [, sign, units, fraction = ''] = match
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, '0'))
  const signed = sign ? -cents : cents
  return safeInteger(signed, 'providerAmountCents')
}

export function validateProviderConsentFallback(provider, status) {
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  const normalizedStatus = String(status || '').trim().toUpperCase()
  if (normalizedProvider === 'gocardless') {
    if (normalizedStatus === 'LN') return 'ready'
    if (['EX', 'RJ', 'SU'].includes(normalizedStatus)) return 'expired'
    return 'pending'
  }
  if (['ACTIVE', 'AUTHORIZED', 'READY'].includes(normalizedStatus)) return 'ready'
  if (['EXPIRED', 'REVOKED', 'REJECTED'].includes(normalizedStatus)) return 'expired'
  return 'pending'
}

export function validateReadOnlyScopeFallback(scope) {
  const normalized = String(scope || '').trim().toLowerCase()
  if (/(payment|payout|transfer|order|mandate|debit)/.test(normalized)) {
    throw new CobolBankingCoreError('Money-movement provider scopes are forbidden.', 'money_movement_scope_forbidden')
  }
  if (!/(balance|detail|transaction|report)/.test(normalized)) {
    throw new CobolBankingCoreError('At least one read-only provider scope is required.', 'read_only_scope_required')
  }
  return true
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
      throw new CobolBankingCoreError(
        `COBOL banking operation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        'cobol_execution_failed',
        { cause: error },
      )
    }
  }

  async normalizeAccountType(value) {
    const result = await this.execute(['normalize-account-type', String(value)])
    const normalized = result?.[0] || normalizeAccountTypeFallback(value)
    if (!ACCOUNT_TYPES.has(normalized)) throw new CobolBankingCoreError('Malformed account type returned by COBOL.', 'malformed_cobol_output')
    return normalized
  }

  async normalizeProviderAccountType(value) {
    const result = await this.execute(['normalize-provider-account-type', String(value || '')])
    const normalized = result?.[0] || normalizeProviderAccountTypeFallback(value)
    if (!ACCOUNT_TYPES.has(normalized)) throw new CobolBankingCoreError('Malformed provider account type returned by COBOL.', 'malformed_cobol_output')
    return normalized
  }

  async normalizeProviderAmount(value) {
    const result = await this.execute(['normalize-provider-amount', String(value)])
    if (!result) return normalizeProviderAmountFallback(value)
    if (result.length !== 1 || !INTEGER.test(result[0])) throw new CobolBankingCoreError('Malformed provider amount returned by COBOL.', 'malformed_cobol_output')
    return safeInteger(Number(result[0]), 'providerAmountCents')
  }

  async validateProviderConsent(provider, status) {
    const result = await this.execute(['validate-provider-consent', String(provider), String(status || '')])
    const consent = result?.[0] || validateProviderConsentFallback(provider, status)
    if (!CONSENT_STATES.has(consent)) throw new CobolBankingCoreError('Malformed provider consent state returned by COBOL.', 'malformed_cobol_output')
    return consent
  }

  async validateReadOnlyScope(scope) {
    const result = await this.execute(['validate-read-only-scope', String(scope)])
    if (!result) return validateReadOnlyScopeFallback(scope)
    if (result.length !== 1 || result[0] !== 'read-only') throw new CobolBankingCoreError('Malformed read-only scope result returned by COBOL.', 'malformed_cobol_output')
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
    if (result.length !== 4 || result.some((value) => !INTEGER.test(value))) throw new CobolBankingCoreError('Malformed credit-card result returned by COBOL.', 'malformed_cobol_output')
    const [amountOwedCents, ledgerBalanceCents, availableCreditCents, pendingAmountCents] = result.map(Number)
    for (const [field, value] of Object.entries({ amountOwedCents, ledgerBalanceCents, availableCreditCents, pendingAmountCents })) safeInteger(value, field)
    if (amountOwedCents < 0 || ledgerBalanceCents > 0 || availableCreditCents < 0 || pendingAmountCents < 0) throw new CobolBankingCoreError('Invalid credit-card invariants returned by COBOL.', 'malformed_cobol_output')
    return { amountOwedCents, ledgerBalanceCents, availableCreditCents: input.creditLimitCents > 0 ? availableCreditCents : undefined, pendingAmountCents }
  }
}
