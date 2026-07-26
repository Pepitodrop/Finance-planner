import { predictFromBehavior } from './behavior'
import type { Transaction } from './types'

export const HUGGING_FACE_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

export interface AiSuggestion {
  category: string
  merchant: string
  confidence: number
  explanation: string
  recurringProbability: number
  anomalyScore: number
  alternatives: Array<{ category: string; confidence: number }>
  needsReview: boolean
  source: 'behavior' | 'rules' | 'hugging-face' | 'fallback'
}

type Extractor = (input: string | string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>

const categoryExamples: Record<string, string[]> = {
  Lebensmittel: ['Supermarkt Lebensmittel REWE Edeka Lidl Aldi Kaufland', 'Bäckerei Essen Getränke Drogerie'],
  Wohnen: ['Miete Nebenkosten Strom Gas Wasser Hausverwaltung', 'Wohnung Internet zuhause Rundfunkbeitrag'],
  Mobilität: ['Bahn Bus Deutschlandticket Tankstelle Benzin Parken Taxi', 'Auto Werkstatt Versicherung Fahrrad'],
  Freizeit: ['Restaurant Kino Bar Konzert Streaming Hobby Urlaub Hotel', 'Sport Fitness Tennis Golf Ski'],
  Verträge: ['Abonnement Mitgliedschaft Versicherung Mobilfunk monatlicher Vertrag', 'Netflix Spotify Fitnessstudio Cloud-Abo'],
  Gesundheit: ['Apotheke Arzt Zahnarzt Medikamente Therapie Krankenhaus', 'Brille Krankenversicherung Gesundheit'],
  Bildung: ['Universität Semesterbeitrag Bücher Kurs Weiterbildung Software lernen', 'Schule Studium Prüfung'],
  Shopping: ['Kleidung Elektronik Online-Shop Möbel Geschenk', 'Amazon Zalando MediaMarkt Kauf'],
  Einkommen: ['Gehalt Lohn Werkstudent Honorar Erstattung Zinsen', 'Einkommen Arbeitgeber Auszahlung'],
  Sparen: ['Sparplan Rücklage Tagesgeld Depot Investment ETF', 'Übertrag auf Sparkonto'],
}

let extractorPromise: Promise<Extractor> | null = null
let prototypePromise: Promise<Map<string, number[]>> | null = null

function normalizeMerchant(description: string): string {
  const cleaned = description.replace(/\b(ec|visa|mastercard|lastschrift|kartenzahlung|zahlung|sepa|gmbh|ag|kg)\b/gi, ' ').replace(/\d{3,}/g, ' ').replace(/[^\p{L}\p{N}&+.-]+/gu, ' ').trim()
  const known: Array<[RegExp, string]> = [[/\brewe\b/i, 'REWE'], [/\bedeka\b/i, 'EDEKA'], [/\blidl\b/i, 'Lidl'], [/\baldi\b/i, 'ALDI'], [/\bnetflix\b/i, 'Netflix'], [/\bspotify\b/i, 'Spotify'], [/\bamazon\b/i, 'Amazon'], [/\bdeutsche bahn|\bdb vertrieb/i, 'Deutsche Bahn'], [/\bpaypal\b/i, 'PayPal']]
  return known.find(([pattern]) => pattern.test(description))?.[1] ?? (cleaned.split(' ').slice(0, 4).join(' ') || description)
}

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) extractorPromise = (async () => {
    const moduleUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'
    const transformers = await import(/* @vite-ignore */ moduleUrl) as { pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Extractor> }
    return transformers.pipeline('feature-extraction', HUGGING_FACE_MODEL, { dtype: 'q8' })
  })()
  return extractorPromise
}

function toVector(output: { data: Float32Array | number[] }): number[] { return Array.from(output.data) }
function cosine(a: number[], b: number[]): number { let dot = 0, normA = 0, normB = 0; const length = Math.min(a.length, b.length); for (let i = 0; i < length; i += 1) { dot += a[i] * b[i]; normA += a[i] ** 2; normB += b[i] ** 2 } return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1) }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 }

async function getPrototypes(): Promise<Map<string, number[]>> {
  if (!prototypePromise) prototypePromise = (async () => {
    const extractor = await getExtractor()
    const result = new Map<string, number[]>()
    for (const [category, examples] of Object.entries(categoryExamples)) result.set(category, toVector(await extractor(examples.join('. '), { pooling: 'mean', normalize: true })))
    return result
  })()
  return prototypePromise
}

function ruleBasedCategory(description: string): string | null {
  const rules: Array<[RegExp, string]> = [[/gehalt|lohn|werkstudent|honorar|zins|erstattung/i, 'Einkommen'], [/miete|nebenkosten|strom|gas|stadtwerke|rundfunk/i, 'Wohnen'], [/rewe|edeka|lidl|aldi|kaufland|dm |rossmann|bäck/i, 'Lebensmittel'], [/bahn|deutschlandticket|tank|shell|aral|uber|taxi|parken/i, 'Mobilität'], [/netflix|spotify|fitness|abo|subscription|mobilfunk|vodafone|telekom/i, 'Verträge'], [/apotheke|arzt|zahnarzt|klinik|medikament/i, 'Gesundheit'], [/uni|kit|semester|udemy|coursera|buch/i, 'Bildung'], [/amazon|zalando|mediamarkt|saturn|ikea/i, 'Shopping']]
  return rules.find(([pattern]) => pattern.test(description))?.[1] ?? null
}

function estimateRecurring(description: string, transactions: Transaction[]): number {
  const merchant = normalizeMerchant(description).toLowerCase()
  const similar = transactions.filter((transaction) => normalizeMerchant(transaction.description).toLowerCase() === merchant)
  if (similar.some((transaction) => transaction.recurring)) return .98
  if (similar.length >= 3) return .9
  if (similar.length === 2) return .72
  if (/miete|abo|subscription|ticket|fitness|versicherung|netflix|spotify/i.test(description)) return .82
  return .18
}

export function robustAnomalyScore(amountCents: number, category: string, transactions: Transaction[]): number {
  const amounts = transactions.filter((transaction) => transaction.type === 'expense' && transaction.category === category).map((transaction) => transaction.amountCents)
  if (amounts.length < 5) return 15
  const center = median(amounts)
  const deviations = amounts.map((amount) => Math.abs(amount - center))
  const mad = Math.max(median(deviations), Math.max(center * 0.05, 100))
  const robustZ = Math.abs(amountCents - center) / (1.4826 * mad)
  return Math.round(Math.min(99, Math.max(5, robustZ / 4 * 100)))
}

export function calibrateSemanticConfidence(best: number, second: number): number {
  const margin = Math.max(0, best - second)
  const absolute = Math.max(0, Math.min(1, (best - 0.35) / 0.45))
  const separation = Math.max(0, Math.min(1, margin / 0.18))
  return Math.round((absolute * 0.65 + separation * 0.35) * 100)
}

export async function classifyTransaction(description: string, amountCents: number, transactions: Transaction[]): Promise<AiSuggestion> {
  const learned = predictFromBehavior(description)
  const ruleCategory = ruleBasedCategory(description)
  let category = learned?.category ?? ruleCategory ?? 'Sonstiges'
  let confidence = learned?.confidence ?? (ruleCategory ? 92 : 35)
  let alternatives: Array<{ category: string; confidence: number }> = []
  let source: AiSuggestion['source'] = learned ? 'behavior' : ruleCategory ? 'rules' : 'fallback'

  try {
    const extractor = await getExtractor()
    const prototypes = await getPrototypes()
    const vector = toVector(await extractor(description, { pooling: 'mean', normalize: true }))
    const ranked = [...prototypes.entries()].map(([name, prototype]) => ({ name, score: cosine(vector, prototype) })).sort((a, b) => b.score - a.score)
    const semanticConfidence = calibrateSemanticConfidence(ranked[0]?.score ?? 0, ranked[1]?.score ?? 0)
    alternatives = ranked.slice(0, 3).map((item, index) => ({ category: item.name, confidence: index === 0 ? semanticConfidence : Math.max(1, Math.round(item.score * 100)) }))
    if (!learned && !ruleCategory && semanticConfidence >= 58) { category = ranked[0].name; confidence = semanticConfidence; source = 'hugging-face' }
    if (!learned && ruleCategory && ranked[0]?.name === ruleCategory) confidence = Math.min(98, Math.max(confidence, semanticConfidence + 5))
  } catch {
    confidence = Math.max(confidence, ruleCategory ? 90 : 35)
  }

  const needsReview = confidence < 60 || category === 'Sonstiges'
  const recurringProbability = learned ? Math.max(learned.recurringProbability / 100, estimateRecurring(description, transactions)) : estimateRecurring(description, transactions)
  const explanation = learned
    ? `Dein persönlicher Verhaltensgraph bevorzugt „${category}“: ${learned.evidence}.`
    : source === 'rules'
      ? `Ein belastbarer Buchungstext-Regelsatz passt zu „${category}“; das Hugging-Face-Modell dient nur als Plausibilitätsprüfung.`
      : source === 'hugging-face'
        ? `Das mehrsprachige Hugging-Face-Modell erkennt „${category}“ mit ausreichendem Abstand zur zweitbesten Kategorie.`
        : 'Die Signale sind nicht eindeutig. Bitte Kategorie bestätigen, damit der persönliche Verhaltensgraph lernen kann.'

  return {
    category,
    merchant: normalizeMerchant(description),
    confidence: Math.max(1, Math.min(99, confidence)),
    recurringProbability: Math.round(recurringProbability * 100),
    anomalyScore: robustAnomalyScore(amountCents, category, transactions),
    alternatives,
    needsReview,
    source,
    explanation,
  }
}

export function generateInsights(transactions: Transaction[]): string[] {
  const expenses = transactions.filter((transaction) => transaction.type === 'expense')
  const recurring = expenses.filter((transaction) => transaction.recurring)
  const biggest = [...expenses].sort((a, b) => b.amountCents - a.amountCents)[0]
  const categoryTotals = new Map<string, number>()
  expenses.forEach((transaction) => categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + transaction.amountCents))
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]
  return [recurring.length ? `${recurring.length} feste Zahlungen verursachen zusammen ${(recurring.reduce((sum, item) => sum + item.amountCents, 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} pro Monat.` : 'Noch keine wiederkehrenden Zahlungen bestätigt.', topCategory ? `Die größte Ausgabenkategorie ist ${topCategory[0]} mit ${(topCategory[1] / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}.` : 'Noch nicht genug Ausgaben für eine Kategorienanalyse.', biggest ? `Die größte einzelne Ausgabe ist „${biggest.description}“ mit ${(biggest.amountCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}.` : 'Noch keine Ausgaben vorhanden.']
}
