import { formatMoney, monthlyProjection, totalBalance } from './finance'
import type { AppState } from './types'
import { getSecureValue, removeSecureValue, setSecureValue } from './vault'

export const ASSISTANT_MODEL = 'Hosted Hugging Face ensemble'
export type AssistantMode = 'analysis' | 'question' | 'planning'

interface AssistantMemoryItem { mode: AssistantMode; question: string; answer: string; createdAt: string }
interface AiSignal { title: string; explanation: string; suggestedAction?: string; severity: 'info' | 'warning' | 'critical' }
interface AiResponse { summary: string; confidence: number; signals: AiSignal[]; source?: string; warning?: string }

const SECURE_MEMORY_KEY = 'assistant-memory-v1'
const LEGACY_MEMORY_KEY = 'finance-planner-assistant-memory-v1'

function validMemory(value: unknown): value is AssistantMemoryItem[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null
    && ['analysis', 'question', 'planning'].includes(String((item as AssistantMemoryItem).mode))
    && typeof (item as AssistantMemoryItem).question === 'string'
    && typeof (item as AssistantMemoryItem).answer === 'string'
    && typeof (item as AssistantMemoryItem).createdAt === 'string')
}

function loadMemory(): AssistantMemoryItem[] {
  const encrypted = getSecureValue<unknown>(SECURE_MEMORY_KEY, undefined)
  if (validMemory(encrypted)) return encrypted
  const legacy = localStorage.getItem(LEGACY_MEMORY_KEY)
  if (!legacy) return []
  try {
    const parsed: unknown = JSON.parse(legacy)
    if (!validMemory(parsed)) return []
    setSecureValue(SECURE_MEMORY_KEY, parsed)
    localStorage.removeItem(LEGACY_MEMORY_KEY)
    return parsed
  } catch { return [] }
}

function saveMemory(item: AssistantMemoryItem): void {
  setSecureValue(SECURE_MEMORY_KEY, [item, ...loadMemory()].slice(0, 20))
  localStorage.removeItem(LEGACY_MEMORY_KEY)
}

export function clearAssistantMemory(): void { removeSecureValue(SECURE_MEMORY_KEY); localStorage.removeItem(LEGACY_MEMORY_KEY) }
export function assistantMemoryCount(): number { return loadMemory().length }

function exactAnswer(state: AppState, question: string): string | null {
  const normalized = question.toLocaleLowerCase('de-DE')
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const income = state.transactions.filter((item) => item.type === 'income')
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const incomeTotal = income.reduce((sum, item) => sum + item.amountCents, 0)
  if (/gesamtvermögen|wie viel.*habe ich|kontostand/.test(normalized)) return `Dein aktuell erfasstes Gesamtvermögen beträgt ${formatMoney(totalBalance(state))}.`
  if (/feste.*zahlung|wiederkehr|vertrag|abos?/.test(normalized)) return `Deine bestätigten wiederkehrenden Ausgaben betragen ${formatMoney(expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0))}.`
  if (/einnahmen/.test(normalized) && /ausgaben/.test(normalized)) return `Erfasste Einnahmen: ${formatMoney(incomeTotal)}. Erfasste Ausgaben: ${formatMoney(expenseTotal)}. Netto: ${formatMoney(incomeTotal - expenseTotal)}.`
  return null
}

function fallbackAnswer(mode: AssistantMode, state: AppState, question: string): string {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const recurringTotal = expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0)
  const freeCash = state.transactions.reduce((sum, item) => sum + (item.type === 'income' ? item.amountCents : -item.amountCents), 0)
  if (mode === 'planning') return `Plan: 1. Baue zuerst einen Notgroschen auf. 2. Reserviere monatlich bis zu ${formatMoney(Math.max(0, Math.round(freeCash * 0.7)))} für priorisierte Sparziele. 3. Prüfe feste Zahlungen von ${formatMoney(recurringTotal)}. 4. Aktualisiere den Plan monatlich.`
  if (mode === 'analysis') return `Analyse: Der erfasste Netto-Cashflow beträgt ${formatMoney(freeCash)}. Wiederkehrende Ausgaben liegen bei ${formatMoney(recurringTotal)}.`
  return exactAnswer(state, question) ?? `Für eine genaue Antwort auf „${question}“ reichen die aktuell gespeicherten Daten nicht aus.`
}

function snapshot(state: AppState) {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const income = state.transactions.filter((item) => item.type === 'income')
  const categoryMap = new Map<string, number>()
  expenses.forEach((item) => categoryMap.set(item.category, (categoryMap.get(item.category) ?? 0) + item.amountCents))
  const dates = state.transactions.map((item) => new Date(item.date).getTime()).filter(Number.isFinite)
  const monthsCovered = dates.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...dates)) / 2_629_800_000)) : 0
  const incomeCents = income.reduce((sum, item) => sum + item.amountCents, 0)
  const expenseCents = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  return {
    incomeCents,
    expenseCents,
    freeCashCents: incomeCents - expenseCents,
    recurringExpenseCents: expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0),
    accountBalanceCents: totalBalance(state),
    transactionCount: state.transactions.length,
    monthsCovered: Math.min(1200, monthsCovered),
    categoryTotals: [...categoryMap.values()].sort((a, b) => b - a).slice(0, 8).map((amountCents, index) => ({ rank: index + 1, amountCents })),
    goals: state.goals.slice(0, 20).map((goal) => ({ remainingCents: Math.max(0, goal.targetCents - goal.currentCents), targetDate: goal.targetDate })),
  }
}

function formatAiResponse(result: AiResponse, mode: AssistantMode, question: string): string {
  const heading = mode === 'planning' ? `Plan für „${question}“` : mode === 'question' ? `Antwort auf „${question}“` : 'Persönliche Finanzanalyse'
  const signals = result.signals?.map((signal, index) => `${index + 1}. ${signal.title}: ${signal.explanation}${signal.suggestedAction ? ` Nächster Schritt: ${signal.suggestedAction}` : ''}`).join('\n')
  return `${heading}\n\n${result.summary}${signals ? `\n\n${signals}` : ''}\n\nKonfidenz: ${Math.round((result.confidence || 0) * 100)} %.`
}

export async function runAssistant(mode: AssistantMode, state: AppState, question: string): Promise<string> {
  if (mode === 'question') {
    const exact = exactAnswer(state, question)
    if (exact) { saveMemory({ mode, question, answer: exact, createdAt: new Date().toISOString() }); return exact }
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 55_000)
  try {
    const response = await fetch('/api/ai/financial-intelligence', {
      method: 'POST', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consentExternalAi: true, snapshot: snapshot(state) }),
    })
    const payload = await response.json().catch(() => ({})) as AiResponse & { error?: string }
    if (!response.ok) throw new Error(payload.error || 'Die KI-Analyse ist momentan nicht erreichbar.')
    const answer = formatAiResponse(payload, mode, question)
    saveMemory({ mode, question, answer, createdAt: new Date().toISOString() })
    return answer
  } catch {
    const answer = fallbackAnswer(mode, state, question)
    saveMemory({ mode, question, answer, createdAt: new Date().toISOString() })
    return `${answer}\n\nHinweis: Die gehostete KI war nicht erreichbar; deshalb wurde die lokale deterministische Ersatzanalyse verwendet.`
  } finally { window.clearTimeout(timeout) }
}
