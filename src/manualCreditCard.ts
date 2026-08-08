export interface ManualCreditCardInput {
  providerBalanceCents: number
  creditLimitCents?: number
  pendingAmountCents?: number
}

export interface NormalizedManualCreditCard {
  amountOwedCents: number
  ledgerBalanceCents: number
  availableCreditCents?: number
  pendingAmountCents: number
  calculationEngine: 'cobol'
}

function safeNonNegativeCents(value: number | undefined, field: string): number {
  const normalized = value ?? 0
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`${field} must be given as a non-negative cent amount.`)
  return normalized
}

function validateResult(value: unknown, creditLimitCents: number): NormalizedManualCreditCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The credit-card calculation did not return a valid result.')
  const result = value as Partial<NormalizedManualCreditCard>
  const required = [result.amountOwedCents, result.ledgerBalanceCents, result.pendingAmountCents]
  if (required.some((entry) => !Number.isSafeInteger(entry))) throw new Error('The credit-card calculation returned unsafe monetary amounts.')
  if (result.calculationEngine !== 'cobol') throw new Error('The credit-card calculation was not confirmed by the authoritative COBOL core.')
  if (Number(result.amountOwedCents) < 0 || Number(result.ledgerBalanceCents) > 0 || Number(result.pendingAmountCents) < 0) {
    throw new Error('The credit-card calculation violates the expected balance rules.')
  }
  if (Number(result.ledgerBalanceCents) !== -Number(result.amountOwedCents)) {
    throw new Error('The amount owed and the ledger balance do not match.')
  }
  if (creditLimitCents > 0) {
    if (!Number.isSafeInteger(result.availableCreditCents) || Number(result.availableCreditCents) < 0) {
      throw new Error('The available credit is invalid.')
    }
  } else if (result.availableCreditCents !== undefined) {
    throw new Error('Available credit cannot be reported without a credit limit.')
  }
  return {
    amountOwedCents: Number(result.amountOwedCents),
    ledgerBalanceCents: Number(result.ledgerBalanceCents),
    ...(result.availableCreditCents === undefined ? {} : { availableCreditCents: Number(result.availableCreditCents) }),
    pendingAmountCents: Number(result.pendingAmountCents),
    calculationEngine: 'cobol',
  }
}

export async function normalizeManualCreditCard(input: ManualCreditCardInput): Promise<NormalizedManualCreditCard> {
  const providerBalanceCents = safeNonNegativeCents(input.providerBalanceCents, 'The amount owed')
  const creditLimitCents = safeNonNegativeCents(input.creditLimitCents, 'The credit limit')
  const pendingAmountCents = safeNonNegativeCents(input.pendingAmountCents, 'The pending amount')
  const response = await fetch('/api/finance/normalize-credit-card', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ providerBalanceCents, creditLimitCents, pendingAmountCents }),
  })
  const payload = await response.json().catch(() => ({})) as unknown & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload?.error?.message || `Credit-card calculation failed (${response.status}).`)
  return validateResult(payload, creditLimitCents)
}
