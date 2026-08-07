import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ImagePlus, Leaf, LoaderCircle, ReceiptText, ShieldCheck, ShoppingBasket, Store, Tag } from 'lucide-react'
import { IntelligenceBadge } from './IntelligenceBadge'
import {
  formatReceiptMoney,
  prepareReceiptImage,
  receiptConsentMatches,
  requestReceiptReview,
  shouldApplyReceiptResult,
  type PreparedReceiptImage,
  type ReceiptLabels,
  type ReceiptReviewResult,
} from './receiptReview'

export type ReceiptAcceptanceMode = 'selected' | 'running' | 'sufficient' | 'insufficient' | 'error'

function scoreLabel(score: number): string {
  if (score >= 80) return 'Very good choice'
  if (score >= 60) return 'Good foundation'
  if (score >= 40) return 'Room to improve'
  return 'Significant room for improvement'
}

function visibleLabels(labels: ReceiptLabels): string[] {
  const result: string[] = []
  if (labels.bio === true) result.push('Bio')
  if (labels.fairTrade === true) result.push('Fair trade')
  if (labels.regional === true) result.push('Regional')
  if (labels.seasonal === true) result.push('Seasonal (estimated)')
  if (labels.packagingConcern === true) result.push('Packaging concern')
  return result
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

const acceptanceResult: ReceiptReviewResult = {
  merchant: 'REWE SAGT', totalCents: 4732, currency: 'EUR', evidenceStatus: 'sufficient', score: 72,
  subScores: { affordability: 65, bioFairTrade: 80, eco: 71 },
  items: [{
    name: 'Bio-Äpfel 1kg', priceCents: 349, labels: { bio: true, fairTrade: null, regional: true, seasonal: null, packagingConcern: false },
    assessment: 'A reasonably priced organic option; portion size matches typical household use.',
    cheaperAlternative: 'Conventional apples, same weight', sustainableAlternative: 'Loose (unpackaged) apples if available',
    alternativeStores: ['Farmers’ market', 'Discount grocer'], confidence: 0.74,
  }],
  recommendations: ['Buy loose produce where available to reduce packaging.'],
  limitations: ['No live price, offer, or inventory data — price and merchant suggestions are non-binding estimates.', 'Bio/Fairtrade/regional/seasonal labels are the model’s best reading, not verified certifications.'],
  confidence: 0.68, source: 'hugging-face-receipt-vision',
  model: { id: 'Qwen/Qwen2.5-VL-7B-Instruct:fastest', license: 'Apache-2.0', routing: 'hugging-face-provider-managed' },
  imageStored: false, generatedAt: '2026-08-01T00:00:00.000Z',
}
const acceptanceInsufficient: ReceiptReviewResult = { ...acceptanceResult, evidenceStatus: 'insufficient', merchant: null, totalCents: null, score: null, subScores: null, items: [], recommendations: [], confidence: 0.34 }

export function ReceiptReview({ acceptanceMode }: { acceptanceMode?: ReceiptAcceptanceMode } = {}) {
  const [image, setImage] = useState<PreparedReceiptImage | null>(acceptanceMode ? { mimeType: 'image/jpeg', dataBase64: '', previewUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7', compressedBytes: 421_875 } : null)
  const [fileName, setFileName] = useState(acceptanceMode ? 'receipt-2026-08-07.jpg' : '')
  const [consentedImageId, setConsentedImageId] = useState<number | null>(null)
  const [loading, setLoading] = useState(acceptanceMode === 'running')
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState(acceptanceMode === 'error' ? 'The request to the hosted model failed, and there’s no automatic substitute for this feature — retrying with the same photo, or a clearer one, is the best next step.' : '')
  const [result, setResult] = useState<ReceiptReviewResult | null>(acceptanceMode === 'sufficient' ? acceptanceResult : acceptanceMode === 'insufficient' ? acceptanceInsufficient : null)
  const selectedImageIdRef = useRef(acceptanceMode ? 1 : 0)
  const requestControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    selectedImageIdRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  async function selectFile(file: File | undefined) {
    if (!file) return

    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    const selectedImageId = selectedImageIdRef.current + 1
    selectedImageIdRef.current = selectedImageId

    setImage(null)
    setFileName('')
    setConsentedImageId(null)
    setLoading(false)
    setPreparing(true)
    setError('')
    setResult(null)

    try {
      const prepared = await prepareReceiptImage(file)
      if (selectedImageId !== selectedImageIdRef.current) return
      setImage(prepared)
      setFileName(file.name)
    } catch (reason) {
      if (selectedImageId !== selectedImageIdRef.current) return
      setError(reason instanceof Error ? reason.message : 'The receipt could not be prepared.')
    } finally {
      if (selectedImageId === selectedImageIdRef.current) setPreparing(false)
    }
  }

  async function analyze() {
    const selectedImageId = selectedImageIdRef.current
    if (!image || !receiptConsentMatches(selectedImageId, consentedImageId) || loading) return

    const controller = new AbortController()
    requestControllerRef.current?.abort()
    requestControllerRef.current = controller

    setConsentedImageId(null)
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const nextResult = await requestReceiptReview(image, controller.signal)
      if (shouldApplyReceiptResult(selectedImageId, selectedImageIdRef.current, controller.signal.aborted)) {
        setResult(nextResult)
      }
    } catch (reason) {
      if (!isAbortError(reason) && shouldApplyReceiptResult(selectedImageId, selectedImageIdRef.current, controller.signal.aborted)) {
        setError(reason instanceof Error ? reason.message : 'The receipt analysis failed, and there’s no automatic substitute for this feature — retrying with the same photo, or a clearer one, is the best next step.')
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
        setLoading(false)
      }
    }
  }

  const consent = image !== null && receiptConsentMatches(selectedImageIdRef.current, consentedImageId)
  const hasSufficientEvidence = result?.evidenceStatus === 'sufficient'

  return <div className="receipt-review-page" lang="en">
    <section className="panel receipt-hero">
      <div><p className="eyebrow">Sustainable purchase check</p><h2>Review a grocery receipt</h2><p>Photograph or upload a receipt to get a value and sustainability check on what you bought. The analysis assesses price sense, bio/fair trade, and environmental impact, and suggests possible alternatives.</p></div>
      <div className="receipt-model-note"><IntelligenceBadge kind="hosted" label="Hosted vision model"/><span>Qwen2.5-VL-7B · Apache-2.0 · Hugging Face provider routing · sent only after you consent to this exact image</span></div>
    </section>

    <section className="receipt-layout">
      <article className="panel receipt-upload-card">
        <div className="panel-header"><div><p className="eyebrow">1. Receipt</p><h2>Choose an image</h2></div><ReceiptText size={21}/></div>
        <label className="receipt-dropzone">
          {image?.previewUrl ? <img src={image.previewUrl} alt="Preview of the selected receipt photo"/> : <><ImagePlus size={34}/><strong>Photograph or upload a receipt</strong><span>JPEG, PNG, or WebP · compressed locally to about 650 KB before anything is sent</span></>}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void selectFile(file)
            }}
          />
        </label>
        {preparing && <p className="status-message" role="status"><LoaderCircle className="spin" size={17}/> Preparing image locally…</p>}
        {image && <p className="receipt-file-meta"><strong>{fileName}</strong><span>{Math.round(image.compressedBytes / 1024)} KB compressed</span></p>}
        {image && <label className="checkbox receipt-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!image || preparing || loading}
            onChange={(event) => setConsentedImageId(event.target.checked ? selectedImageIdRef.current : null)}
          />
          <span>I agree that for exactly this receipt image, it will be sent once through the Finance Planner server to the configured Hugging Face model. Consent is used at the start of the review and resets if you choose a different image. The image is not stored by Finance Planner.</span>
        </label>}
        <button type="button" className="primary receipt-analyze" disabled={!image || !consent || preparing || loading} onClick={() => void analyze()}>
          {loading ? <LoaderCircle className="spin" size={18}/> : <ShoppingBasket size={18}/>} {loading ? 'Reviewing your receipt…' : 'Review purchase'}
        </button>
        {loading && <p className="status-message receipt-running-note" role="status" aria-live="polite">This can take up to a minute — consent given for this photo.</p>}
        <p className="receipt-disclaimer"><ShieldCheck size={16}/> No live price or inventory lookup. Merchant and savings suggestions are unverified estimates from the model.</p>
        {error && <p className="status-message error-message" role="alert"><AlertTriangle size={17}/>{error}</p>}
      </article>

      <article className="panel receipt-result-card" aria-live="polite">
        <div className="panel-header">
          <div><p className="eyebrow">2. Result</p><h2>Your purchase score</h2></div>
          {hasSufficientEvidence && <CheckCircle2 size={22}/>}
          {result?.evidenceStatus === 'insufficient' && <AlertTriangle size={22}/>}
        </div>
        {!result && !error && <div className="receipt-empty"><Leaf size={42}/><strong>No review yet</strong><span>After upload, you'll see the score, detected items, and better alternatives here.</span></div>}
        {result?.evidenceStatus === 'insufficient' && <div className="receipt-insufficient" role="status">
          <AlertTriangle size={38}/>
          <strong>Not enough to give a reliable review.</strong>
          <span>The receipt wasn't clear enough to read reliably, so no score, item assessments, or alternatives are shown — showing an unreliable result would be worse than showing none.</span>
          <small>Model confidence: {Math.round(result.confidence * 100)}%</small>
          <p className="receipt-retry-tip">Try again with the whole receipt visible, in focus, and in good light.</p>
        </div>}
        {result && hasSufficientEvidence && result.score !== null && result.subScores !== null && <>
          <div className="receipt-score-summary">
            <div className="receipt-score"><strong>{result.score}</strong><span>/ 100</span></div>
            <div><h3>{scoreLabel(result.score)}</h3><p>{result.merchant || 'Merchant not confidently detected'} · {formatReceiptMoney(result.totalCents)}</p><span className="receipt-confidence-line">Model confidence: {Math.round(result.confidence * 100)}%</span></div>
          </div>
          <div className="receipt-subscores">
            <div><span>Affordability</span><strong>{result.subScores.affordability}</strong></div>
            <div><span>Bio & fair trade</span><strong>{result.subScores.bioFairTrade}</strong></div>
            <div><span>Environment</span><strong>{result.subScores.eco}</strong></div>
          </div>
        </>}
      </article>
    </section>

    {hasSufficientEvidence && result && <section className="panel receipt-items">
      <div className="panel-header"><div><p className="eyebrow">Detected items</p><h2>What was good — what could be better?</h2></div><span className="pill">{result.items.length} items</span></div>
      <div className="receipt-item-list">{result.items.map((item, index) => {
        const labels = visibleLabels(item.labels)
        return <article className="receipt-item" key={`${item.name}-${index}`}>
          <div className="receipt-item-heading"><div><strong>{item.name}</strong><span>{formatReceiptMoney(item.priceCents)} · confidence {Math.round(item.confidence * 100)}%</span></div>{labels.length > 0 && <div className="receipt-labels">{labels.map((label) => <span key={label}><Tag size={12}/>{label}</span>)}</div>}</div>
          <p>{item.assessment}</p>
          <div className="receipt-alternatives">
            {item.cheaperAlternative && <div><strong>Cheaper</strong><span>{item.cheaperAlternative}</span></div>}
            {item.sustainableAlternative && <div><strong>More sustainable</strong><span>{item.sustainableAlternative}</span></div>}
            {item.alternativeStores.length > 0 && <div><strong><Store size={14}/> Try also</strong><span>{item.alternativeStores.join(' · ')}</span></div>}
          </div>
        </article>
      })}</div>
    </section>}

    {result && <section className={`receipt-layout receipt-followup${hasSufficientEvidence ? '' : ' receipt-followup-single'}`}>
      {hasSufficientEvidence && <article className="panel"><div className="panel-header"><div><p className="eyebrow">Next purchase</p><h2>Recommendations</h2></div><Leaf size={20}/></div><ol className="receipt-recommendations">{result.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ol></article>}
      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Transparency</p><h2>Limitations</h2></div><ShieldCheck size={20}/></div><ul className="receipt-limitations">{result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p className="receipt-model-id">{result.model.id} · provider-managed routing · {result.model.license}</p></article>
    </section>}
  </div>
}
