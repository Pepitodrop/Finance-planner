import { describe, expect, it } from 'vitest'
import {
  acceptWebhook,
  assessBankProductionReadiness,
  nextRetryDelayMs,
  reconcileBankBalance,
  validateSyncCursor,
  type BankProductionControls,
} from './bankProduction'

const readyControls: BankProductionControls = {
  encryptedTokenStorage: true,
  tokenKeyRotation: true,
  leastPrivilegeSecrets: true,
  consentRenewalFlow: true,
  consentRevocationFlow: true,
  oauthStateValidation: true,
  webhookReplayProtection: true,
  syncCursorPersistence: true,
  balanceReconciliation: true,
  structuredAuditLog: true,
  metricsAndAlerts: true,
  providerSandboxE2E: true,
  incidentRunbook: true,
  dataRetentionPolicy: true,
}

describe('production banking readiness', () => {
  it('requires every operational and critical control', () => {
    expect(assessBankProductionReadiness(readyControls)).toMatchObject({ score: 100, productionReady: true })
  })

  it('blocks production when a critical token control is absent', () => {
    const report = assessBankProductionReadiness({ ...readyControls, encryptedTokenStorage: false })
    expect(report.score).toBe(88)
    expect(report.productionReady).toBe(false)
    expect(report.criticalFailures).toContain('Provider tokens encrypted at rest')
  })
})

describe('webhook replay protection', () => {
  const now = new Date('2026-07-26T12:00:00.000Z')

  it('accepts a fresh, signed, unique event', () => {
    expect(acceptWebhook({ eventId: 'evt-1', occurredAt: '2026-07-26T11:58:00.000Z', signatureValid: true }, new Set(), now)).toEqual({ accepted: true })
  })

  it('rejects duplicate, unsigned, future and stale events', () => {
    expect(acceptWebhook({ eventId: 'evt-1', occurredAt: '2026-07-26T11:58:00.000Z', signatureValid: true }, new Set(['evt-1']), now).accepted).toBe(false)
    expect(acceptWebhook({ eventId: 'evt-2', occurredAt: '2026-07-26T11:58:00.000Z', signatureValid: false }, new Set(), now).reason).toBe('invalid-signature')
    expect(acceptWebhook({ eventId: 'evt-3', occurredAt: '2026-07-26T12:01:00.000Z', signatureValid: true }, new Set(), now).reason).toBe('outside-replay-window')
    expect(acceptWebhook({ eventId: 'evt-4', occurredAt: '2026-07-26T11:40:00.000Z', signatureValid: true }, new Set(), now).reason).toBe('outside-replay-window')
  })
})

describe('sync resilience', () => {
  it('uses bounded exponential backoff with jitter and honors Retry-After', () => {
    expect(nextRetryDelayMs(3, undefined, () => 0)).toBe(2000)
    expect(nextRetryDelayMs(3, undefined, () => 1)).toBe(4000)
    expect(nextRetryDelayMs(1, 30)).toBe(30_000)
    expect(nextRetryDelayMs(7)).toBeNull()
  })

  it('rejects stalled and inconsistent provider cursors', () => {
    expect(validateSyncCursor({ connectionId: 'c1', previousCursor: 'a', nextCursor: 'a', pageCount: 2, completed: false }).valid).toBe(false)
    expect(validateSyncCursor({ connectionId: 'c1', previousCursor: 'a', nextCursor: 'b', pageCount: 2, completed: false }).valid).toBe(true)
    expect(validateSyncCursor({ connectionId: 'c1', previousCursor: 'a', pageCount: 2, completed: true }).valid).toBe(true)
  })

  it('reconciles signed movements against provider balances', () => {
    expect(reconcileBankBalance({ openingBalanceCents: 100_000, closingBalanceCents: 95_500, signedMovementCents: [-5_000, 500] })).toEqual({
      reconciled: true,
      expectedClosingBalanceCents: 95_500,
      differenceCents: 0,
    })
    expect(reconcileBankBalance({ openingBalanceCents: 100_000, closingBalanceCents: 95_000, signedMovementCents: [-5_000, 500] }).reconciled).toBe(false)
  })
})
