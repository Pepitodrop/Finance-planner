import { formatMoney, monthlyProjection, totalBalance } from './finance'
import type { AppState } from './types'

export const PRIMARY_ASSISTANT_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct'
export const FALLBACK_ASSISTANT_MODEL = 'Xenova/flan-t5-small'
export const ASSISTANT_MODEL = `${PRIMARY_ASSISTANT_MODEL} (Fallback: ${FALLBACK_ASSISTANT_MODEL})`
export type AssistantMode = 'analysis' | 'question' | 'planning'

interface GeneratedItem { generated_text?: string }
type Generator = (input: string, options?: Record<string, unknown>) => Promise<GeneratedItem[]>

interface AssistantMemoryItem {
  mode: AssistantMode
  question: string
  answer: string
  createdAt: string
}

const MEMORY_KEY = 'finance-planner-assistant-memory-v1'
let generatorPromise: Promise<{ generator: Generator; model: string }> | null = null

function loadMemory(): AssistantMemoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '[]') as AssistantMemoryItem[]
  } catch {
    return []
  }
}

function saveMemory(item: AssistantMemoryItem): void {
  const next = [item, ...loadMemory()].slice(0, 20)
  localStorage.setItem(MEMORY_KEY, JSON.stringify(next))
}

export function clearAssistantMemory(): void {
  localStorage.removeItem(MEMORY_KEY)
}

export function assistantMemoryCount(): number {
  return loadMemory().length
}

function supportsWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

async function loadPipeline(task: string, model: string, options: Record<string, unknown>): Promise<Generator> {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1'
  const transformers = await import(/* @vite-ignore */ moduleUrl) as {
    pipeline: (pipelineTask: string, pipelineModel: string, pipelineOptions?: Record<string, unknown>) => Promise<Generator>
  }
  return transformers.pipeline(task, model, options)
}

async function getGenerator(): Promise<{ generator: Generator; model: string }> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      try {
        const options: Record<string, unknown> = supportsWebGpu()
          ? { device: 'webgpu', dtype: 'q4' }
          : { dtype: 'q4' }
        return {
          generator: await loadPipeline('text-generation', PRIMARY_ASSISTANT_MODEL, options),
          model: PRIMARY_ASSISTANT_MODEL,
        }
      } catch {
        return {
          generator: await loadPipeline('text2text-generation', FALLBACK_ASSISTANT_MODEL, { dtype: 'q8' }),
          model: FALLBACK_ASSISTANT_MODEL,
        }
      }
    })()
  }
  return generatorPromise
}

function buildFinancialContext(state: AppState): string {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const income = state.transactions.filter((item) => item.type === 'income')
  const recurring = expenses.filter((item) => item.recurring)
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const incomeTotal = income.reduce((sum, item) => sum + item.amountCents, 0)
  const recurringTotal = recurring.reduce((sum, item) => sum + item.amountCents, 0)
  const projection = monthlyProjection(state, 12)
  const categoryTotals = new Map<string, number>()
  expenses.forEach((item) => categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.amountCents))
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const history = loadMemory().slice(0, 4).map((item) => `Frage: ${item.question}; Antwort: ${item.answer.slice(0, 300)}`).join(' | ')

  return [
    `Gesamtvermögen: ${formatMoney(totalBalance(state))}.`,
    `Erfasste Einnahmen: ${formatMoney(incomeTotal)}.`,
    `Erfasste Ausgaben: ${formatMoney(expenseTotal)}.`,
    `Netto-Cashflow: ${formatMoney(incomeTotal - expenseTotal)}.`,
    `Feste Zahlungen: ${formatMoney(recurringTotal)}.`,
    `Prognose nach 12 Monaten: ${formatMoney(Math.round((projection.at(-1)?.balance ?? 0) * 100))}.`,
    `Kategorien: ${categories.map(([name, amount]) => `${name} ${formatMoney(amount)}`).join(', ') || 'keine'}.`,
    `Sparziele: ${state.goals.map((goal) => `${goal.name}: ${formatMoney(goal.currentCents)} von ${formatMoney(goal.targetCents)} bis ${goal.targetDate}`).join('; ') || 'keine'}.`,
    `Letzte Buchungen: ${[...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((item) => `${item.date} ${item.description} ${item.type === 'expense' ? '-' : '+'}${formatMoney(item.amountCents)} ${item.category}`).join('; ')}.`,
    history ? `Frühere Assistenteninteraktionen: ${history}.` : '',
  ].filter(Boolean).join(' ')
}

function exactAnswer(state: AppState, question: string): string | null {
  const normalized = question.toLocaleLowerCase('de-DE')
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const income = state.transactions.filter((item) => item.type === 'income')
  const recurring = expenses.filter((item) => item.recurring)
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const incomeTotal = income.reduce((sum, item) => sum + item.amountCents, 0)

  if (/gesamtvermögen|wie viel.*habe ich|kontostand/.test(normalized)) return `Dein aktuell erfasstes Gesamtvermögen beträgt ${formatMoney(totalBalance(state))}.`
  if (/feste.*zahlung|wiederkehr|vertrag|abos?/.test(normalized)) return `Deine bestätigten wiederkehrenden Ausgaben betragen ${formatMoney(recurring.reduce((sum, item) => sum + item.amountCents, 0))}.`
  if (/einnahmen/.test(normalized) && /ausgaben/.test(normalized)) return `Erfasste Einnahmen: ${formatMoney(incomeTotal)}. Erfasste Ausgaben: ${formatMoney(expenseTotal)}. Netto: ${formatMoney(incomeTotal - expenseTotal)}.`
  if (/größte.*ausgabe/.test(normalized)) {
    const biggest = [...expenses].sort((a, b) => b.amountCents - a.amountCents)[0]
    return biggest ? `Deine größte erfasste Ausgabe ist ${biggest.description} mit ${formatMoney(biggest.amountCents)}.` : 'Es sind noch keine Ausgaben vorhanden.'
  }
  return null
}

function fallbackAnswer(mode: AssistantMode, state: AppState, question: string): string {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const recurringTotal = expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0)
  const freeCash = state.transactions.reduce((sum, item) => sum + (item.type === 'income' ? item.amountCents : -item.amountCents), 0)
  if (mode === 'planning') return `Plan: 1. Baue zuerst einen Notgroschen auf. 2. Reserviere monatlich bis zu ${formatMoney(Math.max(0, Math.round(freeCash * 0.7)))} für priorisierte Sparziele. 3. Prüfe feste Zahlungen von ${formatMoney(recurringTotal)}. 4. Aktualisiere den Plan monatlich anhand neuer Buchungen.`
  if (mode === 'analysis') return `Analyse: Der erfasste Netto-Cashflow beträgt ${formatMoney(freeCash)}. Wiederkehrende Ausgaben liegen bei ${formatMoney(recurringTotal)}. Diese Aussage basiert nur auf den lokal gespeicherten Buchungen.`
  return exactAnswer(state, question) ?? `Für eine genaue Antwort auf „${question}“ reichen die aktuell gespeicherten Daten nicht aus.`
}

export async function runAssistant(mode: AssistantMode, state: AppState, question: string): Promise<string> {
  if (mode === 'question') {
    const exact = exactAnswer(state, question)
    if (exact) {
      saveMemory({ mode, question, answer: exact, createdAt: new Date().toISOString() })
      return exact
    }
  }

  const context = buildFinancialContext(state)
  const instruction = mode === 'analysis'
    ? 'Erstelle eine vorsichtige persönliche Finanzanalyse mit Mustern, Risiken, Einsparpotenzial und drei priorisierten Maßnahmen. Rechne nicht selbst neu, sondern nutze nur die angegebenen Zahlen.'
    : mode === 'planning'
      ? `Erstelle einen realistischen Plan für: ${question || 'meine finanzielle Situation verbessern'}. Gliedere in Sofort, diesen Monat, 3 Monate und 12 Monate. Nutze konkrete Euro-Beträge, kennzeichne Annahmen und nenne messbare Kontrollpunkte.`
      : `Beantworte ausschließlich aus dem Kontext. Nenne zuerst die direkte Antwort, dann die verwendeten Daten und Unsicherheiten. Frage: ${question}`

  try {
    const loaded = await getGenerator()
    const prompt = `System: Du bist ein vorsichtiger deutschsprachiger persönlicher Finanzassistent. Keine erfundenen Daten, keine Garantien, keine Steuer- oder Anlageentscheidung ohne Hinweis auf professionelle Prüfung.\nAufgabe: ${instruction}\nFinanzkontext: ${context}\nAntwort:`
    const output = await loaded.generator(prompt, {
      max_new_tokens: mode === 'question' ? 220 : 360,
      temperature: 0.15,
      top_p: 0.9,
      repetition_penalty: 1.12,
      do_sample: false,
      return_full_text: false,
    })
    const answer = output[0]?.generated_text?.trim() || fallbackAnswer(mode, state, question)
    saveMemory({ mode, question, answer, createdAt: new Date().toISOString() })
    return answer
  } catch {
    const answer = fallbackAnswer(mode, state, question)
    saveMemory({ mode, question, answer, createdAt: new Date().toISOString() })
    return answer
  }
}