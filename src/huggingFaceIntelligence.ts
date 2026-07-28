import type { AppState } from './types'

export type FinancialSignalType = 'cashflow' | 'recurring-cost' | 'goal-risk' | 'anomaly' | 'data-quality'

export interface FinancialSignal {
  type: FinancialSignalType
  severity: 'info' | 'warning' | 'critical'
  title: string
  explanation: string
  confidence: number
  evidence: string[]
  suggestedAction?: string
  requiresApproval: true
}

export interface FinancialIntelligenceResult {
  summary: string
  signals: FinancialSignal[]
  confidence: number
  source: 'hugging-face' | 'deterministic-fallback'
  model?: string
  generatedAt: string
  warnings: string[]
}

export interface HuggingFaceChatTransport {
  chatCompletion(input: {
    model: string
    messages: Array<{ role: 'system' | 'user'; content: string }>
    temperature: number
    maxTokens: number
  }): Promise<string>
}

export interface HuggingFaceIntelligenceOptions {
  transport: HuggingFaceChatTransport
  model?: string
  now?: Date
  timeoutMs?: number
}

interface FinancialSnapshot {
  incomeCents: number
  expenseCents: number
  freeCashCents: number
  recurringExpenseCents: number
  accountBalanceCents: number
  transactionCount: number
  monthsCovered: number
  categoryTotals: Array<{ category: string; amountCents: number }>
  goals: Array<{ name: string; remainingCents: number; targetDate: string }>
}

const DEFAULT_MODEL = 'Qwen/Qwen3-4B-Thinking-2507:fastest'
const ALLOWED_SIGNAL_TYPES = new Set<FinancialSignalType>(['cashflow', 'recurring-cost', 'goal-risk', 'anomaly', 'data-quality'])

function clampConfidence(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0
}

function euro(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

export function buildFinancialSnapshot(state: AppState): FinancialSnapshot {
  const incomeCents = state.transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amountCents, 0)
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const expenseCents = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const recurringExpenseCents = expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0)
  const categoryMap = new Map<string, number>()
  for (const item of expenses) categoryMap.set(item.category || 'Unkategorisiert', (categoryMap.get(item.category || 'Unkategorisiert') ?? 0) + item.amountCents)

  return {
    incomeCents,
    expenseCents,
    freeCashCents: incomeCents - expenseCents,
    recurringExpenseCents,
    accountBalanceCents: state.accounts.reduce((sum, account) => sum + account.balanceCents, 0),
    transactionCount: state.transactions.length,
    monthsCovered: new Set(state.transactions.map((item) => item.date.slice(0, 7))).size,
    categoryTotals: [...categoryMap.entries()]
      .map(([category, amountCents]) => ({ category, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 8),
    goals: state.goals.map((goal) => ({
      name: goal.name,
      remainingCents: Math.max(0, goal.targetCents - goal.currentCents),
      targetDate: goal.targetDate,
    })),
  }
}

function deterministicFallback(snapshot: FinancialSnapshot, now: Date, warning: string): FinancialIntelligenceResult {
  const signals: FinancialSignal[] = []
  if (snapshot.freeCashCents <= 0) signals.push({
    type: 'cashflow', severity: 'critical', title: 'Cashflow ist nicht positiv',
    explanation: `Die erfassten Ausgaben übersteigen oder entsprechen den Einnahmen. Freier Cashflow: ${euro(snapshot.freeCashCents)}.`,
    confidence: 0.98, evidence: [`Einnahmen ${euro(snapshot.incomeCents)}`, `Ausgaben ${euro(snapshot.expenseCents)}`],
    suggestedAction: 'Ausgaben prüfen und vor neuen Sparzuweisungen einen Liquiditätspuffer herstellen.', requiresApproval: true,
  })
  if (snapshot.recurringExpenseCents > 0) signals.push({
    type: 'recurring-cost', severity: 'warning', title: 'Wiederkehrende Kosten prüfen',
    explanation: `Wiederkehrende Ausgaben summieren sich auf ${euro(snapshot.recurringExpenseCents)}.`,
    confidence: 0.95, evidence: [`Markierte wiederkehrende Ausgaben ${euro(snapshot.recurringExpenseCents)}`],
    suggestedAction: 'Abonnements und feste Verträge einzeln bestätigen oder kündigen.', requiresApproval: true,
  })
  if (snapshot.transactionCount < 15 || snapshot.monthsCovered < 3) signals.push({
    type: 'data-quality', severity: 'info', title: 'Noch wenig belastbare Historie',
    explanation: 'Prognosen und personalisierte Empfehlungen sind wegen der begrenzten Datenbasis vorsichtig zu interpretieren.',
    confidence: 0.99, evidence: [`${snapshot.transactionCount} Buchungen`, `${snapshot.monthsCovered} Monate Historie`],
    requiresApproval: true,
  })
  return {
    summary: signals.length ? 'Regelbasierte Analyse verfügbar; das Sprachmodell konnte nicht sicher verwendet werden.' : 'Keine dringenden regelbasierten Risiken erkannt.',
    signals, confidence: signals.length ? 0.86 : 0.7, source: 'deterministic-fallback', generatedAt: now.toISOString(), warnings: [warning],
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(candidate)
}

function validateModelResult(value: unknown): { summary: string; signals: FinancialSignal[]; confidence: number } {
  if (!value || typeof value !== 'object') throw new Error('AI response is not an object')
  const record = value as Record<string, unknown>
  if (typeof record.summary !== 'string' || record.summary.length < 1 || record.summary.length > 800) throw new Error('AI summary is invalid')
  if (!Array.isArray(record.signals) || record.signals.length > 8) throw new Error('AI signals are invalid')

  const signals = record.signals.map((item): FinancialSignal => {
    if (!item || typeof item !== 'object') throw new Error('AI signal is invalid')
    const signal = item as Record<string, unknown>
    if (!ALLOWED_SIGNAL_TYPES.has(signal.type as FinancialSignalType)) throw new Error('AI signal type is invalid')
    if (!['info', 'warning', 'critical'].includes(String(signal.severity))) throw new Error('AI signal severity is invalid')
    if (typeof signal.title !== 'string' || typeof signal.explanation !== 'string') throw new Error('AI signal text is invalid')
    if (!Array.isArray(signal.evidence) || !signal.evidence.every((entry) => typeof entry === 'string')) throw new Error('AI evidence is invalid')
    return {
      type: signal.type as FinancialSignalType,
      severity: signal.severity as FinancialSignal['severity'],
      title: signal.title.slice(0, 140),
      explanation: signal.explanation.slice(0, 600),
      confidence: clampConfidence(signal.confidence),
      evidence: signal.evidence.slice(0, 5).map((entry) => entry.slice(0, 200)),
      suggestedAction: typeof signal.suggestedAction === 'string' ? signal.suggestedAction.slice(0, 300) : undefined,
      requiresApproval: true,
    }
  })
  return { summary: record.summary, signals, confidence: clampConfidence(record.confidence) }
}

export async function createHuggingFaceFinancialIntelligence(
  state: AppState,
  options: HuggingFaceIntelligenceOptions,
): Promise<FinancialIntelligenceResult> {
  const now = options.now ?? new Date()
  const snapshot = buildFinancialSnapshot(state)
  const model = options.model ?? DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? 12_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const prompt = JSON.stringify(snapshot)
  try {
    const response = await Promise.race([
      options.transport.chatCompletion({
        model,
        temperature: 0.1,
        maxTokens: 900,
        messages: [
          {
            role: 'system',
            content: 'Du bist ein vorsichtiger Finanzanalyse-Assistent. Nutze ausschließlich die aggregierten Fakten. Erfinde keine Transaktionen, stelle keine Rechts-, Steuer- oder Anlageberatung als sicher dar und führe keine Aktion aus. Antworte ausschließlich als JSON mit summary, confidence und signals. Jede signal-Struktur enthält type, severity, title, explanation, confidence, evidence, optional suggestedAction. Zulässige type-Werte: cashflow, recurring-cost, goal-risk, anomaly, data-quality. Jede Empfehlung bleibt genehmigungspflichtig.',
          },
          { role: 'user', content: `Analysiere diesen anonymisierten Finanz-Snapshot: ${prompt}` },
        ],
      }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Hugging Face inference timed out')), { once: true })),
    ])
    const validated = validateModelResult(extractJson(response))
    return { ...validated, source: 'hugging-face', model, generatedAt: now.toISOString(), warnings: [] }
  } catch (error) {
    return deterministicFallback(snapshot, now, error instanceof Error ? error.message : 'Hugging Face inference failed')
  } finally {
    clearTimeout(timeout)
  }
}
