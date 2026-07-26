export interface BankProductionControls {
  encryptedTokenStorage: boolean
  tokenKeyRotation: boolean
  leastPrivilegeSecrets: boolean
  consentRenewalFlow: boolean
  consentRevocationFlow: boolean
  oauthStateValidation: boolean
  webhookReplayProtection: boolean
  syncCursorPersistence: boolean
  balanceReconciliation: boolean
  structuredAuditLog: boolean
  metricsAndAlerts: boolean
  providerSandboxE2E: boolean
  incidentRunbook: boolean
  dataRetentionPolicy: boolean
}

export interface BankProductionReadiness {
  score: number
  productionReady: boolean
  criticalFailures: string[]
  passed: string[]
  failed: string[]
}

const CHECKS: Array<{ key: keyof BankProductionControls; label: string; weight: number; critical?: boolean }> = [
  { key: 'encryptedTokenStorage', label: 'Provider tokens encrypted at rest', weight: 12, critical: true },
  { key: 'tokenKeyRotation', label: 'Encryption keys rotate without reconnecting accounts', weight: 7, critical: true },
  { key: 'leastPrivilegeSecrets', label: 'Provider secrets use least-privilege access', weight: 6, critical: true },
  { key: 'consentRenewalFlow', label: 'Expiring consents have a renewal flow', weight: 8, critical: true },
  { key: 'consentRevocationFlow', label: 'Revoked consents disable future syncs', weight: 6, critical: true },
  { key: 'oauthStateValidation', label: 'OAuth state and redirect targets are validated', weight: 8, critical: true },
  { key: 'webhookReplayProtection', label: 'Webhook signatures and replay windows are enforced', weight: 8, critical: true },
  { key: 'syncCursorPersistence', label: 'Provider cursors persist transactionally', weight: 8, critical: true },
  { key: 'balanceReconciliation', label: 'Imported movements reconcile to provider balances', weight: 8, critical: true },
  { key: 'structuredAuditLog', label: 'Consent and sync actions are audit logged', weight: 6 },
  { key: 'metricsAndAlerts', label: 'Sync latency, failures and consent expiry are monitored', weight: 7 },
  { key: 'providerSandboxE2E', label: 'Provider sandbox end-to-end tests pass', weight: 6, critical: true },
  { key: 'incidentRunbook', label: 'Banking incident and credential rotation runbooks exist', weight: 5 },
  { key: 'dataRetentionPolicy', label: 'Bank data retention and deletion are enforced', weight: 5 },
]

export function assessBankProductionReadiness(controls: BankProductionControls): BankProductionReadiness {
  const passedChecks = CHECKS.filter((check) => controls[check.key])
  const failedChecks = CHECKS.filter((check) => !controls[check.key])
  const score = passedChecks.reduce((sum, check) => sum + check.weight, 0)
  const criticalFailures = failedChecks.filter((check) => check.critical).map((check) => check.label)
  return {
    score,
    productionReady: score === 100 && criticalFailures.length === 0,
    criticalFailures,
    passed: passedChecks.map((check) => check.label),
    failed: failedChecks.map((check) => check.label),
  }
}

export interface WebhookEnvelope {
  eventId: string
  occurredAt: string
  signatureValid: boolean
}

export function acceptWebhook(
  envelope: WebhookEnvelope,
  processedEventIds: ReadonlySet<string>,
  now = new Date(),
  replayWindowMinutes = 5,
): { accepted: boolean; reason?: 'invalid-signature' | 'invalid-timestamp' | 'outside-replay-window' | 'duplicate-event' } {
  if (!envelope.signatureValid) return { accepted: false, reason: 'invalid-signature' }
  const occurredAt = Date.parse(envelope.occurredAt)
  if (!Number.isFinite(occurredAt)) return { accepted: false, reason: 'invalid-timestamp' }
  const ageMs = now.getTime() - occurredAt
  if (ageMs < 0 || ageMs > replayWindowMinutes * 60_000) return { accepted: false, reason: 'outside-replay-window' }
  if (!envelope.eventId || processedEventIds.has(envelope.eventId)) return { accepted: false, reason: 'duplicate-event' }
  return { accepted: true }
}

export function nextRetryDelayMs(
  attempt: number,
  retryAfterSeconds?: number,
  random = Math.random,
): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 6) return null
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(15 * 60_000, Math.round(retryAfterSeconds * 1000))
  }
  const base = Math.min(60_000, 1000 * 2 ** (attempt - 1))
  return Math.round(base / 2 + base / 2 * random())
}

export interface ReconciliationInput {
  openingBalanceCents: number
  closingBalanceCents: number
  signedMovementCents: number[]
  toleranceCents?: number
}

export function reconcileBankBalance(input: ReconciliationInput): {
  reconciled: boolean
  expectedClosingBalanceCents: number
  differenceCents: number
} {
  const expectedClosingBalanceCents = input.openingBalanceCents
    + input.signedMovementCents.reduce((sum, amount) => sum + amount, 0)
  const differenceCents = input.closingBalanceCents - expectedClosingBalanceCents
  const tolerance = Math.max(0, input.toleranceCents ?? 1)
  return { reconciled: Math.abs(differenceCents) <= tolerance, expectedClosingBalanceCents, differenceCents }
}

export interface SyncCursorState {
  connectionId: string
  previousCursor?: string
  nextCursor?: string
  pageCount: number
  completed: boolean
}

export function validateSyncCursor(state: SyncCursorState): { valid: boolean; reason?: string } {
  if (!state.connectionId) return { valid: false, reason: 'Missing connection identifier.' }
  if (!Number.isInteger(state.pageCount) || state.pageCount < 1 || state.pageCount > 10_000) return { valid: false, reason: 'Invalid page count.' }
  if (!state.completed && !state.nextCursor) return { valid: false, reason: 'Incomplete sync requires a continuation cursor.' }
  if (state.previousCursor && state.nextCursor === state.previousCursor) return { valid: false, reason: 'Provider cursor did not advance.' }
  if (state.completed && state.nextCursor) return { valid: false, reason: 'Completed sync must not expose a continuation cursor.' }
  return { valid: true }
}
