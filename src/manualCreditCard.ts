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
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`${field} muss als nicht negativer Cent-Betrag angegeben werden.`)
  return normalized
}

function validateResult(value: unknown, creditLimitCents: number): NormalizedManualCreditCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Kreditkartenberechnung lieferte kein gültiges Ergebnis.')
  const result = value as Partial<NormalizedManualCreditCard>
  const required = [result.amountOwedCents, result.ledgerBalanceCents, result.pendingAmountCents]
  if (required.some((entry) => !Number.isSafeInteger(entry))) throw new Error('Die Kreditkartenberechnung lieferte unsichere Geldbeträge.')
  if (result.calculationEngine !== 'cobol') throw new Error('Die Kreditkartenberechnung wurde nicht vom autoritativen COBOL-Kern bestätigt.')
  if (Number(result.amountOwedCents) < 0 || Number(result.ledgerBalanceCents) > 0 || Number(result.pendingAmountCents) < 0) {
    throw new Error('Die Kreditkartenberechnung verletzt die erwarteten Saldenregeln.')
  }
  if (Number(result.ledgerBalanceCents) !== -Number(result.amountOwedCents)) {
    throw new Error('Offener Betrag und Verbindlichkeit stimmen nicht überein.')
  }
  if (creditLimitCents > 0) {
    if (!Number.isSafeInteger(result.availableCreditCents) || Number(result.availableCreditCents) < 0) {
      throw new Error('Der verfügbare Kreditrahmen ist ungültig.')
    }
  } else if (result.availableCreditCents !== undefined) {
    throw new Error('Ohne Kreditlimit darf kein verfügbarer Kreditrahmen ausgewiesen werden.')
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
  const providerBalanceCents = safeNonNegativeCents(input.providerBalanceCents, 'Der offene Betrag')
  const creditLimitCents = safeNonNegativeCents(input.creditLimitCents, 'Das Kreditlimit')
  const pendingAmountCents = safeNonNegativeCents(input.pendingAmountCents, 'Der vorgemerkte Betrag')
  const response = await fetch('/api/finance/normalize-credit-card', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ providerBalanceCents, creditLimitCents, pendingAmountCents }),
  })
  const payload = await response.json().catch(() => ({})) as unknown & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload?.error?.message || `Kreditkartenberechnung fehlgeschlagen (${response.status}).`)
  return validateResult(payload, creditLimitCents)
}
