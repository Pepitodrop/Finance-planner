import { CobolBankingCore } from './cobol-banking-core.js'

function requireSafeInteger(value, field) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer.`)
  return value
}

export function createBankingSyncNormalizer({ core = new CobolBankingCore() } = {}) {
  return async function normalizeBankingSync(syncResult) {
    if (!syncResult || !Array.isArray(syncResult.accounts)) throw new Error('Provider synchronization result is invalid.')

    const accounts = []
    for (const account of syncResult.accounts) {
      const type = await core.normalizeAccountType(account.type)
      if (type !== 'credit-card') {
        accounts.push({ ...account, type, balanceCents: requireSafeInteger(account.balanceCents, 'balanceCents') })
        continue
      }

      const normalized = await core.normalizeCreditCard({
        providerBalanceCents: requireSafeInteger(account.balanceCents, 'balanceCents'),
        creditLimitCents: account.creditLimitCents === undefined ? 0 : requireSafeInteger(account.creditLimitCents, 'creditLimitCents'),
        pendingAmountCents: account.pendingAmountCents === undefined ? 0 : requireSafeInteger(account.pendingAmountCents, 'pendingAmountCents'),
      })
      accounts.push({
        ...account,
        type,
        balanceCents: normalized.ledgerBalanceCents,
        amountOwedCents: normalized.amountOwedCents,
        availableCreditCents: normalized.availableCreditCents,
        pendingAmountCents: normalized.pendingAmountCents,
      })
    }

    return { ...syncResult, accounts }
  }
}
