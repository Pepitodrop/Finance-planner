const SUPPORTED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SOURCE_BYTES = 10_000_000
const MAX_COMPRESSED_BYTES = 650_000
const MAX_IMAGE_DIMENSION = 1600

export interface PreparedReceiptImage {
  mimeType: 'image/jpeg'
  dataBase64: string
  previewUrl: string
  compressedBytes: number
}

export interface ReceiptLabels {
  bio: boolean | null
  fairTrade: boolean | null
  regional: boolean | null
  seasonal: boolean | null
  packagingConcern: boolean | null
}

export interface ReceiptReviewItem {
  name: string
  priceCents: number | null
  labels: ReceiptLabels
  assessment: string
  cheaperAlternative: string | null
  sustainableAlternative: string | null
  alternativeStores: string[]
  confidence: number
}

export interface ReceiptSubScores {
  affordability: number
  bioFairTrade: number
  eco: number
}

export interface ReceiptReviewResult {
  merchant: string | null
  totalCents: number | null
  currency: 'EUR'
  evidenceStatus: 'sufficient' | 'insufficient'
  score: number | null
  subScores: ReceiptSubScores | null
  items: ReceiptReviewItem[]
  recommendations: string[]
  limitations: string[]
  confidence: number
  source: string
  model: { id: string; license: string; routing: string }
  imageStored: false
  generatedAt: string
}

function imageFromObjectUrl(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Das Bild konnte nicht gelesen werden.')) }
    image.src = objectUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Der Beleg konnte nicht komprimiert werden.')), 'image/jpeg', quality)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Der Beleg konnte nicht vorbereitet werden.'))
    reader.onerror = () => reject(new Error('Der Beleg konnte nicht vorbereitet werden.'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareReceiptImage(file: File): Promise<PreparedReceiptImage> {
  if (!SUPPORTED_RECEIPT_TYPES.has(file.type)) throw new Error('Bitte ein JPEG-, PNG- oder WebP-Bild auswählen.')
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('Das Ausgangsbild darf höchstens 10 MB groß sein.')
  const image = await imageFromObjectUrl(file)
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Das Bild hat keine gültigen Abmessungen.')
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / image.naturalWidth, MAX_IMAGE_DIMENSION / image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  let compressed: Blob | null = null
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    compressed = await canvasToBlob(canvas, quality)
    if (compressed.size <= MAX_COMPRESSED_BYTES) break
  }
  if (!compressed || compressed.size > MAX_COMPRESSED_BYTES) throw new Error('Das Bild bleibt nach der Komprimierung zu groß. Bitte näher fotografieren oder zuschneiden.')
  const previewUrl = await blobToDataUrl(compressed)
  const dataBase64 = previewUrl.slice(previewUrl.indexOf(',') + 1)
  return { mimeType: 'image/jpeg', dataBase64, previewUrl, compressedBytes: compressed.size }
}

function integerScore(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) throw new Error(`Ungültiger Wert für ${field}.`)
  return Number(value)
}

function confidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Ungültige Modellkonfidenz.')
  return value
}

function nullableText(value: unknown): string | null {
  return value === null ? null : typeof value === 'string' ? value : null
}

export function receiptConsentMatches(imageId: number, consentedImageId: number | null): boolean {
  return Number.isInteger(imageId) && imageId > 0 && consentedImageId === imageId
}

export function shouldApplyReceiptResult(requestImageId: number, currentImageId: number, aborted: boolean): boolean {
  return !aborted && requestImageId === currentImageId
}

export function validateReceiptReviewResponse(value: unknown): ReceiptReviewResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Beleganalyse hat ein ungültiges Ergebnis geliefert.')
  const result = value as Partial<ReceiptReviewResult>
  if (result.currency !== 'EUR' || result.imageStored !== false || !result.model || typeof result.model !== 'object') throw new Error('Die Beleganalyse ist unvollständig.')
  if (result.evidenceStatus !== 'sufficient' && result.evidenceStatus !== 'insufficient') throw new Error('Der Evidenzstatus der Beleganalyse ist ungültig.')
  if (!Array.isArray(result.items) || !Array.isArray(result.recommendations) || !Array.isArray(result.limitations)) throw new Error('Die Beleganalyse enthält ungültige Listen.')

  const items = result.items.map((item, index) => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.assessment !== 'string' || !Array.isArray(item.alternativeStores)) throw new Error(`Artikel ${index + 1} ist ungültig.`)
    if (!item.labels || typeof item.labels !== 'object') throw new Error(`Siegelangaben für Artikel ${index + 1} sind ungültig.`)
    return item
  })

  let score: number | null
  let subScores: ReceiptSubScores | null
  if (result.evidenceStatus === 'sufficient') {
    score = integerScore(result.score, 'Gesamtscore')
    subScores = {
      affordability: integerScore(result.subScores?.affordability, 'Preis'),
      bioFairTrade: integerScore(result.subScores?.bioFairTrade, 'Bio und Fairtrade'),
      eco: integerScore(result.subScores?.eco, 'Umwelt'),
    }
  } else {
    if (result.score !== null || result.subScores !== null || items.length > 0 || result.recommendations.length > 0) {
      throw new Error('Eine unsichere Beleganalyse darf keinen Score oder Empfehlungen enthalten.')
    }
    score = null
    subScores = null
  }

  return {
    merchant: nullableText(result.merchant),
    totalCents: result.totalCents === null ? null : Number.isInteger(result.totalCents) ? Number(result.totalCents) : null,
    currency: 'EUR',
    evidenceStatus: result.evidenceStatus,
    score,
    subScores,
    items,
    recommendations: result.recommendations.filter((entry): entry is string => typeof entry === 'string'),
    limitations: result.limitations.filter((entry): entry is string => typeof entry === 'string'),
    confidence: confidence(result.confidence),
    source: typeof result.source === 'string' ? result.source : 'unknown',
    model: {
      id: typeof result.model.id === 'string' ? result.model.id : 'unknown',
      license: typeof result.model.license === 'string' ? result.model.license : 'unknown',
      routing: typeof result.model.routing === 'string' ? result.model.routing : 'unknown',
    },
    imageStored: false,
    generatedAt: typeof result.generatedAt === 'string' ? result.generatedAt : new Date().toISOString(),
  }
}

export async function requestReceiptReview(image: PreparedReceiptImage, signal?: AbortSignal): Promise<ReceiptReviewResult> {
  const response = await fetch('/api/ai/receipt-review', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consentExternalAi: true,
      image: { mimeType: image.mimeType, dataBase64: image.dataBase64 },
      preferences: { country: 'DE', priorities: ['bio', 'fairTrade', 'eco', 'price'] },
    }),
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message
    throw new Error(typeof message === 'string' ? message : 'Die Beleganalyse ist fehlgeschlagen.')
  }
  return validateReceiptReviewResponse(payload)
}

export function formatReceiptMoney(cents: number | null): string {
  return cents === null ? 'nicht erkannt' : (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}
