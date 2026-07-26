import type { Transaction } from './types'

export const HUGGING_FACE_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

export interface AiSuggestion {
  category: string
  merchant: string
  confidence: number
  explanation: string
  recurringProbability: number
  anomalyScore: number
}

type ModelOutput = { data: Float32Array | number[] }
type Extractor = (input: string | string[], options?: Record<string, unknown>) => Promise<ModelOutput>

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
  const cleaned = description
    .replace(/\b(ec|visa|mastercard|lastschrift|kartenzahlung|zahlung|sepa|gmbh|ag|kg)\b/gi, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^\p{L}\p{N}&+.-]+/gu, ' ')
    .trim()

  const known: Array<[RegExp, string]> = [
    [/\brewe\b/i, 'REWE'], [/\bedeka\b/i, 'EDEKA'], [/\blidl\b/i, 'Lidl'], [/\baldi\b/i, 'ALDI'],
    [/\bnetflix\b/i, 'Netflix'], [/\bspotify\b/i, 'Spotify'], [/\bamazon\b/i, 'Amazon'],
    [/\bdeutsche bahn|\bdb vertrieb/i, 'Deutsche Bahn'], [/\bpaypal\b/i, 'PayPal'],
  ]
  const knownMerchant = known.find(([pattern]) => pattern.test(description))?.[1]
  return knownMerchant ?? (cleaned.split(' ').slice(0, 4).join(' ') || description)
}

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const moduleUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'
      const transformers = await import(/* @vite-ignore */ moduleUrl) as {
        pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Extractor>
      }
      return transformers.pipeline('feature-extraction', HUGGING_FACE_MODEL, { dtype: 'q8' })
    })()
  }
  return extractorPromise
}

function toVector(output: ModelOutput): number[] {
  return Array.from(output.data)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    dot += left * right
    normA += left ** 2
    normB += right ** 2
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}

async function getPrototypes(): Promise<Map<string, number[]>> {
  if (!prototypePromise) {
    prototypePromise = (async () => {
      const extractor = await getExtractor()
      const result = new Map<string, number[]>()
      for (const [category, examples] of Object.entries(categoryExamples)) {
        const output = await extractor(examples.join('. '), { pooling: 'mean', normalize: true })
        result.set(category, toVector(output))
      }
      return result
    })()
  }
  return prototypePromise
}

function ruleBasedCategory(description: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/gehalt|lohn|werkstudent|honorar|zins|erstattung/i, 'Einkommen'],
    [/miete|nebenkosten|strom|gas|stadtwerke|rundfunk/i, 'Wohnen'],
    [/rewe|edeka|lidl|aldi|kaufland|dm |rossmann|bäck/i, 'Lebensmittel'],
    [/bahn|deutschlandticket|tank|shell|aral|uber|taxi|parken/i, 'Mobilität'],
    [/netflix|spotify|fitness|abo|subscription|mobilfunk|vodafone|telekom/i, 'Verträge'],
    [/apotheke|arzt|zahnarzt|klinik|medikament/i, 'Gesundheit'],
    [/uni|kit|semester|udemy|coursera|buch/i, 'Bildung'],
    [/amazon|zalando|mediamarkt|saturn|ikea/i, 'Shopping'],
  ]
  return rules.find(([pattern]) => pattern.test(description))?.[1] ?? null
}

function estimateRecurring(description: string, transactions: Transaction[]): number {
  const merchant = normalizeMerchant(description).toLowerCase()
  const similar = transactions.filter((transaction) => normalizeMerchant(transaction.description).toLowerCase() === merchant)
  if (similar.some((transaction) => transaction.recurring)) return 0.98
  if (similar.length >= 3) return 0.9
  if (similar.length === 2) return 0.72
  if (/miete|abo|subscription|ticket|fitness|versicherung|netflix|spotify/i.test(description)) return 0.82
  return 0.18
}

function estimateAnomaly(amountCents: number, category: string, transactions: Transaction[]): number {
  const peers = transactions.filter((transaction) => transaction.type === 'expense' && transaction.category === category)
  if (peers.length < 2) return 0.15
  const mean = peers.reduce((sum, transaction) => sum + transaction.amountCents, 0) / peers.length
  return Math.min(0.99, Math.abs(amountCents - mean) / Math.max(mean, 1) / 2)
}

export async function classifyTransaction(description: string, amountCents: number, transactions: Transaction[]): Promise<AiSuggestion> {
  const ruleCategory = ruleBasedCategory(description)
  let category = ruleCategory ?? 'Sonstiges'
  let semanticScore = ruleCategory ? 0.92 : 0.45

  try {
    const extractor = await getExtractor()
    const prototypes = await getPrototypes()
    const output = await extractor(description, { pooling: 'mean', normalize: true })
    const vector = toVector(output)
    const best = [...prototypes.entries()]
      .map(([name, prototype]) => ({ name, score: cosine(vector, prototype) }))
      .sort((a, b) => b.score - a.score)[0]
    if (best && (!ruleCategory || best.score > 0.72)) {
      category = best.name
      semanticScore = best.score
    }
  } catch {
    // Offline/rules fallback keeps the app usable before the model has been cached.
  }

  const recurringProbability = estimateRecurring(description, transactions)
  const anomalyScore = estimateAnomaly(amountCents, category, transactions)
  return {
    category,
    merchant: normalizeMerchant(description),
    confidence: Math.round(Math.max(0.45, Math.min(0.99, semanticScore)) * 100),
    recurringProbability: Math.round(recurringProbability * 100),
    anomalyScore: Math.round(anomalyScore * 100),
    explanation: ruleCategory
      ? `Bekannter Händler- oder Buchungstext passt zu „${category}“; die lokale semantische KI prüft den Vorschlag zusätzlich.`
      : `Das mehrsprachige Hugging-Face-Modell ordnet den Buchungstext semantisch am ehesten „${category}“ zu.`,
  }
}

export function generateInsights(transactions: Transaction[]): string[] {
  const expenses = transactions.filter((transaction) => transaction.type === 'expense')
  const recurring = expenses.filter((transaction) => transaction.recurring)
  const biggest = [...expenses].sort((a, b) => b.amountCents - a.amountCents)[0]
  const categoryTotals = new Map<string, number>()
  expenses.forEach((transaction) => categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + transaction.amountCents))
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]
  const euro = (cents: number) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

  return [
    recurring.length ? `${recurring.length} feste Zahlungen verursachen zusammen ${euro(recurring.reduce((sum, item) => sum + item.amountCents, 0))} pro Monat.` : 'Noch keine wiederkehrenden Zahlungen bestätigt.',
    topCategory ? `Die größte Ausgabenkategorie ist ${topCategory[0]} mit ${euro(topCategory[1])}.` : 'Noch nicht genug Ausgaben für eine Kategorienanalyse.',
    biggest ? `Die größte einzelne Ausgabe ist „${biggest.description}“ mit ${euro(biggest.amountCents)}.` : 'Noch keine Ausgaben vorhanden.',
  ]
}
