import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ImagePlus, Leaf, LoaderCircle, ReceiptText, ShieldCheck, ShoppingBasket, Store, Tag } from 'lucide-react'
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

function scoreLabel(score: number): string {
  if (score >= 80) return 'Sehr gute Wahl'
  if (score >= 60) return 'Gute Grundlage'
  if (score >= 40) return 'Ausbaufähig'
  return 'Deutliches Verbesserungspotenzial'
}

function visibleLabels(labels: ReceiptLabels): string[] {
  const result: string[] = []
  if (labels.bio === true) result.push('BIO erkannt')
  if (labels.fairTrade === true) result.push('Fairtrade erkannt')
  if (labels.regional === true) result.push('regional erkannt')
  if (labels.seasonal === true) result.push('saisonal eingeschätzt')
  if (labels.packagingConcern === true) result.push('Verpackung kritisch')
  return result
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

export function ReceiptReview() {
  const [image, setImage] = useState<PreparedReceiptImage | null>(null)
  const [fileName, setFileName] = useState('')
  const [consentedImageId, setConsentedImageId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReceiptReviewResult | null>(null)
  const selectedImageIdRef = useRef(0)
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
      setError(reason instanceof Error ? reason.message : 'Der Beleg konnte nicht vorbereitet werden.')
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
        setError(reason instanceof Error ? reason.message : 'Die Beleganalyse ist fehlgeschlagen.')
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

  return <div className="receipt-review-page">
    <section className="panel receipt-hero">
      <div><p className="eyebrow">Nachhaltiger Einkaufscheck</p><h2>Lebensmittelbeleg mit KI bewerten</h2><p>Fotografiere oder lade einen Kassenbon hoch. Die Analyse bewertet Preisgefühl, BIO/Fairtrade und Umweltwirkung und schlägt mögliche Alternativen vor.</p></div>
      <div className="receipt-model-note"><Leaf size={20}/><div><strong>Open-Weight Vision-Modell</strong><span>Qwen2.5-VL-7B · Apache-2.0 · Hugging Face Provider-Routing</span></div></div>
    </section>

    <section className="receipt-layout">
      <article className="panel receipt-upload-card">
        <div className="panel-header"><div><p className="eyebrow">1. Beleg</p><h2>Bild auswählen</h2></div><ReceiptText size={21}/></div>
        <label className="receipt-dropzone">
          {image ? <img src={image.previewUrl} alt="Vorschau des ausgewählten Kassenbons"/> : <><ImagePlus size={34}/><strong>Beleg fotografieren oder hochladen</strong><span>JPEG, PNG oder WebP · wird lokal auf höchstens 700 KB komprimiert</span></>}
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
        {preparing && <p className="status-message" role="status"><LoaderCircle className="spin" size={17}/> Bild wird lokal vorbereitet …</p>}
        {image && <p className="receipt-file-meta"><strong>{fileName}</strong><span>{Math.round(image.compressedBytes / 1024)} KB komprimiert</span></p>}
        <label className="checkbox receipt-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!image || preparing || loading}
            onChange={(event) => setConsentedImageId(event.target.checked ? selectedImageIdRef.current : null)}
          />
          <span>Ich stimme für genau dieses Belegbild zu, dass es einmalig über den Finance-Planner-Server an das konfigurierte Hugging-Face-Modell gesendet wird. Die Zustimmung wird beim Start verbraucht und bei jedem Bildwechsel zurückgesetzt. Das Bild wird nicht im Finance Planner gespeichert.</span>
        </label>
        <button type="button" className="primary receipt-analyze" disabled={!image || !consent || preparing || loading} onClick={() => void analyze()}>
          {loading ? <LoaderCircle className="spin" size={18}/> : <ShoppingBasket size={18}/>} {loading ? 'Beleg wird analysiert …' : 'Einkauf bewerten'}
        </button>
        <p className="receipt-disclaimer"><ShieldCheck size={16}/> Keine Live-Preis- oder Bestandsabfrage. Händler- und Sparvorschläge sind unverbindliche KI-Schätzungen.</p>
        {error && <p className="status-message error-message" role="alert"><AlertTriangle size={17}/>{error}</p>}
      </article>

      <article className="panel receipt-result-card" aria-live="polite">
        <div className="panel-header">
          <div><p className="eyebrow">2. Ergebnis</p><h2>Dein Einkaufs-Score</h2></div>
          {hasSufficientEvidence && <CheckCircle2 size={22}/>} 
          {result?.evidenceStatus === 'insufficient' && <AlertTriangle size={22}/>} 
        </div>
        {!result && <div className="receipt-empty"><Leaf size={42}/><strong>Noch keine Auswertung</strong><span>Nach dem Upload siehst du hier Score, erkannte Artikel und bessere Alternativen.</span></div>}
        {result?.evidenceStatus === 'insufficient' && <div className="receipt-insufficient" role="status">
          <AlertTriangle size={38}/>
          <strong>Keine belastbare Bewertung möglich</strong>
          <span>Der Beleg war nicht zuverlässig genug lesbar. Deshalb werden bewusst kein Score, keine Produktbewertung und keine Alternativen angezeigt. Fotografiere den gesamten Bon gerade, scharf und bei gutem Licht.</span>
          <small>Modellkonfidenz {Math.round(result.confidence * 100)} %</small>
        </div>}
        {result && hasSufficientEvidence && result.score !== null && result.subScores !== null && <>
          <div className="receipt-score-summary">
            <div className="receipt-score"><strong>{result.score}</strong><span>/ 100</span></div>
            <div><h3>{scoreLabel(result.score)}</h3><p>{result.merchant || 'Händler nicht sicher erkannt'} · {formatReceiptMoney(result.totalCents)}</p><small>Modellkonfidenz {Math.round(result.confidence * 100)} %</small></div>
          </div>
          <div className="receipt-subscores">
            <div><span>Preis</span><strong>{result.subScores.affordability}</strong></div>
            <div><span>BIO & Fairtrade</span><strong>{result.subScores.bioFairTrade}</strong></div>
            <div><span>Umwelt</span><strong>{result.subScores.eco}</strong></div>
          </div>
        </>}
      </article>
    </section>

    {hasSufficientEvidence && result && <section className="panel receipt-items">
      <div className="panel-header"><div><p className="eyebrow">Erkannte Positionen</p><h2>Was war gut – was wäre besser?</h2></div><span className="pill">{result.items.length} Artikel</span></div>
      <div className="receipt-item-list">{result.items.map((item, index) => {
        const labels = visibleLabels(item.labels)
        return <article className="receipt-item" key={`${item.name}-${index}`}>
          <div className="receipt-item-heading"><div><strong>{item.name}</strong><span>{formatReceiptMoney(item.priceCents)} · Sicherheit {Math.round(item.confidence * 100)} %</span></div>{labels.length > 0 && <div className="receipt-labels">{labels.map((label) => <span key={label}><Tag size={12}/>{label}</span>)}</div>}</div>
          <p>{item.assessment}</p>
          <div className="receipt-alternatives">
            {item.cheaperAlternative && <div><strong>Günstiger</strong><span>{item.cheaperAlternative}</span></div>}
            {item.sustainableAlternative && <div><strong>Nachhaltiger</strong><span>{item.sustainableAlternative}</span></div>}
            {item.alternativeStores.length > 0 && <div><strong><Store size={14}/> Andere Einkaufsorte</strong><span>{item.alternativeStores.join(' · ')}</span></div>}
          </div>
        </article>
      })}</div>
    </section>}

    {result && <section className={`receipt-layout receipt-followup${hasSufficientEvidence ? '' : ' receipt-followup-single'}`}>
      {hasSufficientEvidence && <article className="panel"><div className="panel-header"><div><p className="eyebrow">Nächster Einkauf</p><h2>Empfehlungen</h2></div><Leaf size={20}/></div><ol className="receipt-recommendations">{result.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ol></article>}
      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Transparenz</p><h2>Grenzen der Analyse</h2></div><ShieldCheck size={20}/></div><ul className="receipt-limitations">{result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p className="receipt-model-id">{result.model.id} · provider-managed Routing · {result.model.license}</p></article>
    </section>}
  </div>
}
