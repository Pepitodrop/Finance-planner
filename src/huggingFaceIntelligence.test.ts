import { describe, expect, it, vi } from 'vitest'
import { buildFinancialSnapshot, createHuggingFaceFinancialIntelligence } from './huggingFaceIntelligence'
import type { HuggingFaceChatRequest } from './huggingFaceIntelligence'
import type { AppState } from './types'

const state: AppState = {
  accounts: [{ id: 'a1', name: 'Girokonto', type: 'checking', balanceCents: 180000, currency: 'EUR' }],
  transactions: [
    { id: 't1', accountId: 'a1', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 250000, date: '2026-07-01' },
    { id: 't2', accountId: 'a1', description: 'Miete', category: 'Wohnen privat', type: 'expense', amountCents: 95000, date: '2026-07-02', recurring: true },
    { id: 't3', accountId: 'a1', description: 'Supermarkt', category: 'Gesundheit privat', type: 'expense', amountCents: 28000, date: '2026-07-04' },
  ],
  goals: [{ id: 'g1', name: 'Private Reise nach Tokio', targetCents: 500000, currentCents: 100000, targetDate: '2027-06-01' }],
}

describe('Hugging Face financial intelligence', () => {
  it('sends only numeric aggregates and accepts guarded structured output', async () => {
    const chatCompletion = vi.fn(async (_request: HuggingFaceChatRequest) => JSON.stringify({
      summary: 'Der Cashflow ist positiv, die Datenhistorie aber noch kurz.',
      confidence: 0.84,
      signals: [{
        type: 'data-quality', severity: 'info', title: 'Kurze Historie',
        explanation: 'Für belastbare Prognosen fehlen weitere Monate.', confidence: 0.91,
        evidence: ['3 Buchungen', '1 Monat Historie'], suggestedAction: 'Weitere bestätigte Buchungen sammeln',
      }],
    }))

    const result = await createHuggingFaceFinancialIntelligence(state, {
      transport: { chatCompletion }, now: new Date('2026-07-28T12:00:00.000Z'),
    })

    expect(result.source).toBe('hugging-face')
    expect(result.confidence).toBe(0.84)
    expect(result.signals[0].requiresApproval).toBe(true)
    const request = chatCompletion.mock.calls[0]?.[0]
    expect(request).toBeTruthy()
    expect(request?.temperature).toBe(0.1)
    const prompt = request?.messages[1]?.content ?? ''
    expect(prompt).not.toContain('Gehalt')
    expect(prompt).not.toContain('Supermarkt')
    expect(prompt).not.toContain('Wohnen privat')
    expect(prompt).not.toContain('Gesundheit privat')
    expect(prompt).not.toContain('Private Reise nach Tokio')
    expect(prompt).toContain('250000')
  })

  it('falls back deterministically when model output is malformed', async () => {
    const result = await createHuggingFaceFinancialIntelligence(state, {
      transport: { chatCompletion: vi.fn(async (_request: HuggingFaceChatRequest) => 'not json') },
      now: new Date('2026-07-28T12:00:00.000Z'),
    })

    expect(result.source).toBe('deterministic-fallback')
    expect(result.warnings[0]).toBeTruthy()
    expect(result.signals.some((signal) => signal.type === 'recurring-cost')).toBe(true)
  })

  it('rejects invented signal types and never removes approval requirements', async () => {
    const result = await createHuggingFaceFinancialIntelligence(state, {
      transport: { chatCompletion: vi.fn(async (_request: HuggingFaceChatRequest) => JSON.stringify({
        summary: 'Transferiere das Geld automatisch.', confidence: 1,
        signals: [{ type: 'execute-transfer', severity: 'critical', title: 'Transfer', explanation: 'Jetzt ausführen', confidence: 1, evidence: [] }],
      })) },
      now: new Date('2026-07-28T12:00:00.000Z'),
    })

    expect(result.source).toBe('deterministic-fallback')
    expect(result.signals.every((signal) => signal.requiresApproval)).toBe(true)
  })

  it('aborts the provider request when the orchestration timeout expires', async () => {
    let seenSignal: AbortSignal | undefined
    const result = await createHuggingFaceFinancialIntelligence(state, {
      timeoutMs: 5,
      transport: {
        chatCompletion: ({ signal }: HuggingFaceChatRequest) => new Promise((_resolve, reject) => {
          seenSignal = signal
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      },
    })

    expect(seenSignal?.aborted).toBe(true)
    expect(result.source).toBe('deterministic-fallback')
  })

  it('builds stable privacy-minimised financial facts', () => {
    expect(buildFinancialSnapshot(state)).toEqual(expect.objectContaining({
      incomeCents: 250000,
      expenseCents: 123000,
      freeCashCents: 127000,
      recurringExpenseCents: 95000,
      transactionCount: 3,
      monthsCovered: 1,
    }))
  })
})
