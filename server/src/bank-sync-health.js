const DAY_MS = 86_400_000

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function ageDays(value, now) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS))
}

export function assessBankConnectionHealth(input, now = new Date()) {
  const consentDaysRemaining = input?.consentExpiresAt
    ? Math.ceil((Date.parse(input.consentExpiresAt) - now.getTime()) / DAY_MS)
    : null
  const syncAgeDays = ageDays(input?.lastSyncedAt, now)
  const failureCount = Number.isSafeInteger(input?.consecutiveFailures) ? Math.max(0, input.consecutiveFailures) : 0
  const accountCount = Number.isSafeInteger(input?.accountCount) ? Math.max(0, input.accountCount) : 0
  const reconciledAccountCount = Number.isSafeInteger(input?.reconciledAccountCount) ? Math.max(0, input.reconciledAccountCount) : 0
  const transactionCount = Number.isSafeInteger(input?.transactionCount) ? Math.max(0, input.transactionCount) : 0
  const pendingCount = Number.isSafeInteger(input?.pendingTransactionCount) ? Math.max(0, input.pendingTransactionCount) : 0
  const duplicateCount = Number.isSafeInteger(input?.duplicateTransactionCount) ? Math.max(0, input.duplicateTransactionCount) : 0

  const reconciliationCoverage = accountCount === 0 ? 0 : clamp(reconciledAccountCount / accountCount)
  const duplicatePenalty = transactionCount === 0 ? 0 : clamp(duplicateCount / transactionCount)
  const pendingShare = transactionCount === 0 ? 0 : clamp(pendingCount / transactionCount)
  const freshnessScore = syncAgeDays === null ? 0 : syncAgeDays <= 1 ? 1 : syncAgeDays <= 3 ? 0.85 : syncAgeDays <= 7 ? 0.55 : 0.15
  const consentScore = consentDaysRemaining === null ? 0.45 : consentDaysRemaining > 14 ? 1 : consentDaysRemaining > 3 ? 0.65 : consentDaysRemaining > 0 ? 0.3 : 0
  const reliabilityScore = clamp(1 - failureCount * 0.2)
  const qualityScore = clamp(
    freshnessScore * 0.28 +
    consentScore * 0.2 +
    reconciliationCoverage * 0.27 +
    reliabilityScore * 0.2 +
    (1 - duplicatePenalty) * 0.05,
  )

  const reasons = []
  let state = 'healthy'
  let nextAction = 'none'

  if (consentDaysRemaining !== null && consentDaysRemaining <= 0) {
    state = 'reconnect-required'
    nextAction = 'renew-consent'
    reasons.push('consent_expired')
  } else if (failureCount >= 3) {
    state = 'degraded'
    nextAction = 'retry-with-backoff'
    reasons.push('repeated_provider_failures')
  } else if (syncAgeDays === null || syncAgeDays > 7) {
    state = 'stale'
    nextAction = 'synchronize-now'
    reasons.push('synchronization_stale')
  } else if (reconciliationCoverage < 1) {
    state = 'incomplete'
    nextAction = 'reconcile-accounts'
    reasons.push('account_reconciliation_incomplete')
  } else if (duplicateCount > 0) {
    state = 'degraded'
    nextAction = 'deduplicate-before-import'
    reasons.push('duplicate_transactions_detected')
  } else if (consentDaysRemaining !== null && consentDaysRemaining <= 14) {
    state = 'attention'
    nextAction = 'schedule-consent-renewal'
    reasons.push('consent_expiring_soon')
  }

  if (pendingShare > 0.5) reasons.push('high_pending_transaction_share')
  if (accountCount === 0) reasons.push('no_accounts_returned')

  return {
    state,
    nextAction,
    score: Number(qualityScore.toFixed(3)),
    consentDaysRemaining,
    syncAgeDays,
    reconciliationCoverage: Number(reconciliationCoverage.toFixed(3)),
    pendingShare: Number(pendingShare.toFixed(3)),
    failureCount,
    reasons,
    importAllowed: ['healthy', 'attention'].includes(state) && duplicateCount === 0 && reconciliationCoverage === 1,
    userInterventionRequired: ['reconnect-required', 'incomplete'].includes(state),
    policyVersion: 'bank-sync-health-v1',
  }
}

export function chooseBankSyncBackoff(consecutiveFailures, retryAfterMs = null) {
  const failures = Number.isSafeInteger(consecutiveFailures) ? Math.max(0, consecutiveFailures) : 0
  const exponential = Math.min(60 * 60_000, 1_000 * (2 ** Math.min(failures, 12)))
  const providerDelay = Number.isFinite(Number(retryAfterMs)) ? Math.max(0, Number(retryAfterMs)) : 0
  return Math.max(exponential, Math.min(providerDelay, 60 * 60_000))
}
