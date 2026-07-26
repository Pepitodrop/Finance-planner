import { formatMoney, monthlyProjection, totalBalance } from './finance'
import type { AppState } from './types'

export const ASSISTANT_MODEL = 'Xenova/flan-t5-small'
export type AssistantMode = 'analysis' | 'question' | 'planning'

type GeneratorResult = Array<{ generated_text: string }>
type Generator = (input: string, options?: Record<string, unknown>) => Promise<GeneratorResult>

let generatorPromise: Promise<Generator> | null = null

async function getGenerator(): Promise<Generator> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const moduleUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'
      const transformers = await import(/* @vite-ignore */ moduleUrl) as {
        pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Generator>
      }
      return transformers.pipeline('text2text-generation', ASSISTANT_MODEL, { dtype: 'q8' })
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
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  return [
    `Gesamtvermögen: ${formatMoney(totalBalance(state))}.`,
    `Erfasste Einnahmen: ${formatMoney(incomeTotal)}.`,
    `Erfasste Ausgaben: ${formatMoney(expenseTotal)}.`,
    `Feste Zahlungen: ${formatMoney(recurringTotal)} pro Monat.`,
    `Prognostizierter Kontostand nach 12 Monaten: ${formatMoney(Math.round((projection.at(-1)?.balance ?? 0) * 100))}.`,
    `Größte Kategorien: ${categories.map(([name, amount]) => `${name} ${formatMoney(amount)}`).join(', ') || 'keine'}.`,
    `Sparziele: ${state.goals.map((goal) => `${goal.name}: ${formatMoney(goal.currentCents)} von ${formatMoney(goal.targetCents)} bis ${goal.targetDate}`).join('; ') || 'keine'}.`,
    `Letzte Buchungen: ${[...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((item) => `${item.date} ${item.description} ${item.type === 'expense' ? '-' : '+'}${formatMoney(item.amountCents)} ${item.category}`).join('; ')}.`,
  ].join(' ')
}

function fallbackAnswer(mode: AssistantMode, state: AppState, question: string): string {
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const recurring = expenses.filter((item) => item.recurring)
  const recurringTotal = recurring.reduce((sum, item) => sum + item.amountCents, 0)
  const freeCash = state.transactions.reduce((sum, item) => sum + (item.type === 'income' ? item.amountCents : -item.amountCents), 0)

  if (mode === 'planning') {
    return `Plan: 1. Sichere zuerst einen Notgroschen. 2. Reserviere monatlich höchstens ${formatMoney(Math.max(0, Math.round(freeCash * 0.7)))} für Sparziele. 3. Prüfe feste Zahlungen von ${formatMoney(recurringTotal)} monatlich. 4. Kontrolliere den Plan nach jeder neuen Monatsabrechnung.`
  }
  if (mode === 'analysis') {
    return `Analyse: Dein erfasster Netto-Cashflow beträgt ${formatMoney(freeCash)}. Wiederkehrende Ausgaben liegen bei ${formatMoney(recurringTotal)}. Die Aussage basiert ausschließlich auf den aktuell gespeicherten Buchungen.`
  }
  return `Auf Basis deiner gespeicherten Daten: ${question || 'Es wurde keine konkrete Frage eingegeben.'} Dein aktuelles Gesamtvermögen beträgt ${formatMoney(totalBalance(state))}. Für eine genaue Antwort müssen genügend passende Buchungen vorhanden sein.`
}

export async function runAssistant(mode: AssistantMode, state: AppState, question: string): Promise<string> {
  const context = buildFinancialContext(state)
  const instruction = mode === 'analysis'
    ? 'Erstelle eine vorsichtige persönliche Finanzanalyse. Nenne Risiken, Muster und drei umsetzbare nächste Schritte. Erfinde keine Daten und gib keine Anlagegarantie.'
    : mode === 'planning'
      ? `Erstelle einen realistischen, priorisierten Finanzplan zur Frage: ${question || 'Verbessere meine finanzielle Situation'}. Nutze konkrete Euro-Beträge aus dem Kontext, kennzeichne Annahmen und teile den Plan in Jetzt, diesen Monat und nächste 12 Monate.`
      : `Beantworte die Frage ausschließlich anhand des Kontextes. Sage klar, wenn die Daten nicht reichen. Frage: ${question}`

  try {
    const generator = await getGenerator()
    const prompt = `Du bist ein vorsichtiger deutschsprachiger persönlicher Finanzassistent. ${instruction}\nFINANZKONTEXT: ${context}\nANTWORT:`
    const output = await generator(prompt, {
      max_new_tokens: mode === 'question' ? 160 : 240,
      temperature: 0.2,
      repetition_penalty: 1.15,
      do_sample: false,
    })
    return output[0]?.generated_text?.trim() || fallbackAnswer(mode, state, question)
  } catch {
    return fallbackAnswer(mode, state, question)
  }
}