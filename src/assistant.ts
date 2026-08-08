import { formatMoney, monthlyProjection, totalBalance } from './finance'
import type { AppState } from './types'
import { getSecureValue, removeSecureValue, setSecureValue } from './vault'

export const HOSTED_ASSISTANT_MODEL = 'Qwen3 4B analyst + Qwen3 4B critic'
export const PRIMARY_LOCAL_ASSISTANT_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct'
export const FALLBACK_LOCAL_ASSISTANT_MODEL = 'Xenova/flan-t5-small'
export const ASSISTANT_MODEL = HOSTED_ASSISTANT_MODEL
export type AssistantMode = 'analysis' | 'question' | 'planning'
export type AssistantEngine = 'hosted' | 'local'

interface AssistantMemoryItem { mode: AssistantMode; question: string; answer: string; createdAt: string }
interface GeneratedItem { generated_text?: string }
type Generator = (input: string, options?: Record<string, unknown>) => Promise<GeneratedItem[]>
interface AiSignal { title: string; explanation: string; suggestedAction?: string; severity: 'info' | 'warning' | 'critical' }
interface AiResponse { summary: string; confidence: number; signals: AiSignal[]; source?: string; warnings?: string[] }

export class HostedAiFallbackError extends Error {
  readonly fallbackAnswer: string

  constructor(message: string, fallbackAnswer: string) {
    super(message)
    this.name = 'HostedAiFallbackError'
    this.fallbackAnswer = fallbackAnswer
  }
}

const SECURE_MEMORY_KEY = 'assistant-memory-v1'
const LEGACY_MEMORY_KEY = 'finance-planner-assistant-memory-v1'
const TRANSFORMERS_MODULE_URL = '/vendor/transformers-3.8.1.min.js'
let localGeneratorPromise: Promise<{ generator: Generator; model: string }> | null = null

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
  const normalized = question.toLocaleLowerCase('en-GB')
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const income = state.transactions.filter((item) => item.type === 'income')
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const incomeTotal = income.reduce((sum, item) => sum + item.amountCents, 0)
  if (/net worth|how much.*(do i have|money)|account balance/.test(normalized)) return `Your currently recorded net worth is ${formatMoney(totalBalance(state))}.`
  if (/recurring|subscription|fixed payment/.test(normalized)) return `Your confirmed recurring expenses total ${formatMoney(expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0))}.`
  if (/income/.test(normalized) && /expense/.test(normalized)) return `Recorded income: ${formatMoney(incomeTotal)}. Recorded expenses: ${formatMoney(expenseTotal)}. Net: ${formatMoney(incomeTotal - expenseTotal)}.`
  if (/biggest.*expense|largest.*expense/.test(normalized)) {
    const biggest = [...expenses].sort((a, b) => b.amountCents - a.amountCents)[0]
    return biggest ? `Your largest recorded expense is ${biggest.description} at ${formatMoney(biggest.amountCents)}.` : 'No expenses have been recorded yet.'
  }
  return null
}

function fallbackAnswer(mode: AssistantMode, state: AppState, question: string): string {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const recurringTotal = expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0)
  const freeCash = state.transactions.reduce((sum, item) => sum + (item.type === 'income' ? item.amountCents : -item.amountCents), 0)
  if (mode === 'planning') return `Plan: 1. Build a cash buffer first. 2. Reserve up to ${formatMoney(Math.max(0, Math.round(freeCash * 0.7)))} per month for prioritized savings goals. 3. Review recurring payments of ${formatMoney(recurringTotal)}. 4. Update the plan monthly.`
  if (mode === 'analysis') return `Analysis: Your recorded net cash flow is ${formatMoney(freeCash)}. Recurring expenses stand at ${formatMoney(recurringTotal)}.`
  return exactAnswer(state, question) ?? `The currently stored data isn't enough for a precise answer to "${question}".`
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

function buildFinancialContext(state: AppState): string {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const income = state.transactions.filter((item) => item.type === 'income')
  const recurring = expenses.filter((item) => item.recurring)
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const incomeTotal = income.reduce((sum, item) => sum + item.amountCents, 0)
  const projection = monthlyProjection(state, 12)
  const categoryTotals = new Map<string, number>()
  expenses.forEach((item) => categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.amountCents))
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const history = loadMemory().slice(0, 4).map((item) => `Question: ${item.question}; Answer: ${item.answer.slice(0, 300)}`).join(' | ')

  return [
    `Net worth: ${formatMoney(totalBalance(state))}.`,
    `Recorded income: ${formatMoney(incomeTotal)}.`,
    `Recorded expenses: ${formatMoney(expenseTotal)}.`,
    `Net cash flow: ${formatMoney(incomeTotal - expenseTotal)}.`,
    `Recurring payments: ${formatMoney(recurring.reduce((sum, item) => sum + item.amountCents, 0))}.`,
    `12-month projection: ${formatMoney(Math.round((projection.at(-1)?.balance ?? 0) * 100))}.`,
    `Categories: ${categories.map(([name, amount]) => `${name} ${formatMoney(amount)}`).join(', ') || 'none'}.`,
    `Savings goals: ${state.goals.map((goal) => `${goal.name}: ${formatMoney(goal.currentCents)} of ${formatMoney(goal.targetCents)} by ${goal.targetDate}`).join('; ') || 'none'}.`,
    `Recent transactions: ${[...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((item) => `${item.date} ${item.description} ${item.type === 'expense' ? '-' : '+'}${formatMoney(item.amountCents)} ${item.category}`).join('; ')}.`,
    history ? `Earlier assistant interactions: ${history}.` : '',
  ].filter(Boolean).join(' ')
}

function formatAiResponse(result: AiResponse, mode: AssistantMode, question: string): string {
  const heading = mode === 'planning' ? `Plan for "${question}"` : mode === 'question' ? `Answer to "${question}"` : 'Personal financial analysis'
  const signals = result.signals?.map((signal, index) => `${index + 1}. ${signal.title}: ${signal.explanation}${signal.suggestedAction ? ` Next step: ${signal.suggestedAction}` : ''}`).join('\n')
  return `${heading}\n\n${result.summary}${signals ? `\n\n${signals}` : ''}\n\nConfidence: ${Math.round((result.confidence || 0) * 100)}%.`
}

function supportsWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

async function loadTransformers(): Promise<{ pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Generator> }> {
  return await import(/* @vite-ignore */ TRANSFORMERS_MODULE_URL) as {
    pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Generator>
  }
}

async function getLocalGenerator(): Promise<{ generator: Generator; model: string }> {
  if (!localGeneratorPromise) {
    localGeneratorPromise = (async () => {
      const { pipeline } = await loadTransformers()
      try {
        const options: Record<string, unknown> = supportsWebGpu() ? { device: 'webgpu', dtype: 'q4' } : { dtype: 'q4' }
        return { generator: await pipeline('text-generation', PRIMARY_LOCAL_ASSISTANT_MODEL, options), model: PRIMARY_LOCAL_ASSISTANT_MODEL }
      } catch {
        return { generator: await pipeline('text2text-generation', FALLBACK_LOCAL_ASSISTANT_MODEL, { dtype: 'q8' }), model: FALLBACK_LOCAL_ASSISTANT_MODEL }
      }
    })().catch((error) => {
      localGeneratorPromise = null
      throw error
    })
  }
  return localGeneratorPromise
}

function fallbackReason(payload: AiResponse): string {
  const warning = payload.warnings?.find((value) => typeof value === 'string' && value.trim())?.trim()
  return warning
    ? `The hosted models did not return a verifiable answer. Reason: ${warning.slice(0, 240)}`
    : 'The hosted models did not return a verifiable answer. A rule-based substitute analysis was shown instead.'
}

async function runHostedAssistant(mode: AssistantMode, state: AppState, question: string, consentExternalAi: boolean): Promise<string> {
  if (!consentExternalAi) throw new Error('Please agree to sending aggregated financial metrics to the hosted AI models.')
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 55_000)
  try {
    const response = await fetch('/api/ai/financial-intelligence', {
      method: 'POST', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consentExternalAi, intent: { mode, question: question.slice(0, 500) }, snapshot: snapshot(state) }),
    })
    const payload = await response.json().catch(() => ({})) as AiResponse & { error?: string | { message?: string } }
    if (!response.ok) {
      const message = typeof payload.error === 'string' ? payload.error : payload.error?.message
      throw new Error(message || 'The AI analysis is not reachable right now.')
    }
    const formattedAnswer = formatAiResponse(payload, mode, question)
    if (payload.source === 'deterministic-fallback') {
      throw new HostedAiFallbackError(fallbackReason(payload), formattedAnswer)
    }
    return formattedAnswer
  } finally { globalThis.clearTimeout(timeout) }
}

async function runLocalAssistant(mode: AssistantMode, state: AppState, question: string): Promise<string> {
  const loaded = await getLocalGenerator()
  const instruction = mode === 'analysis'
    ? 'Create a careful personal financial analysis covering patterns, risks, savings potential, and three prioritized actions.'
    : mode === 'planning'
      ? `Create a realistic plan for: ${question || 'improving my financial situation'}. Structure it into Immediately, This month, 3 months, and 12 months.`
      : `Answer using only the given context. Question: ${question}`
  const prompt = `System: You are a careful personal finance assistant. Do not invent data.\nTask: ${instruction}\nFinancial context: ${buildFinancialContext(state)}\nAnswer:`
  const output = await loaded.generator(prompt, { max_new_tokens: mode === 'question' ? 220 : 360, temperature: 0.15, top_p: 0.9, repetition_penalty: 1.12, do_sample: false, return_full_text: false })
  return output[0]?.generated_text?.trim() || fallbackAnswer(mode, state, question)
}

export function runDeterministicAssistant(mode: AssistantMode, state: AppState, question: string): string {
  const answer = fallbackAnswer(mode, state, question)
  saveMemory({ mode, question, answer, createdAt: new Date().toISOString() })
  return answer
}

export async function runAssistant(mode: AssistantMode, state: AppState, question: string, engine: AssistantEngine = 'hosted', consentExternalAi = false): Promise<string> {
  if (mode === 'question') {
    const exact = exactAnswer(state, question)
    if (exact) { saveMemory({ mode, question, answer: exact, createdAt: new Date().toISOString() }); return exact }
  }
  const answer = engine === 'local'
    ? await runLocalAssistant(mode, state, question)
    : await runHostedAssistant(mode, state, question, consentExternalAi)
  saveMemory({ mode, question, answer, createdAt: new Date().toISOString() })
  return answer
}
