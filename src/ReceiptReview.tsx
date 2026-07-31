import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ImagePlus, Leaf, LoaderCircle, ReceiptText, ShieldCheck, ShoppingBasket, Store, Tag } from 'lucide-react'
import {
  formatReceiptMoney,
  prepareReceiptImage,
  requestReceiptReview,
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

export function ReceiptReview() {
  const [image, setImage] = useState<PreparedReceiptImage | null>(null)
  const [fileName, setFileName] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReceiptReviewResult | null>(null)

  async function selectFile(file: File | undefined) {
    if (!file) return
    setPreparing(true)
    setError('')
    setResult(null)
    try {
      const prepared = await prepareReceiptImage(file)
      setImage(prepared)
      setFileName(file.name)
    } catch (reason) {
      setImage(null)
      setFileName('')
      setError(reason instanceof Error ? reason.message : 'Der Beleg konnte nicht vorbereitet werden.')
    } finally {
      setPreparing(false)
    }
  }

  async function analyze() {
    if (!image || !consent || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await requestReceiptReview(image))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die Beleganalyse ist fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="receipt-review-page">
    <section className="panel receipt-hero">
      <div><p className="eyebrow">Nachhaltiger Einkaufscheck</p><h2>Lebensmittelbeleg mit KI bewerten</h2><p>Fotografiere oder lade einen Kassenbon hoch. Die Analyse bewertet Preisgefühl, BIO/Fairtrade und Umweltwirkung und schlägt mögliche Alternativen vor.</p></div>
      <div className="receipt-model-note"><Leaf size={20}/><div><strong>Open-Weight Vision-Modell</strong><span>Qwen2.5-VL-7B · Apache-2.0 · Hugging Face</span></div></div>
    </section>

    <section className="receipt-layout">
      <article className="panel receipt-upload-card">
        <div className="panel-header"><div><p className="eyebrow">1. Beleg</p><h2>Bild auswählen</h2></div><ReceiptText size={21}/></div>
        <label className="receipt-dropzone">
          {image ? <img src={image.previewUrl} alt="Vorschau des ausgewählten Kassenbons"/> : <><ImagePlus size={34}/><strong>Beleg fotografieren oder hochladen</strong><span>JPEG, PNG oder WebP · wird lokal auf höchstens 700 KB komprimiert</span></>}
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void selectFile(event.target.files?.[0])}/>
        </label>
        {preparing && <p className="status-message" role="status"><LoaderCircle className="spin" size={17}/> Bild wird lokal vorbereitet …</p>}
        {image && <p className="receipt-file-meta"><strong>{fileName}</strong><span>{Math.round(image.compressedBytes / 1024)} KB komprimiert</span></p>}
        <label className="checkbox receipt-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>Ich stimme zu, dass dieses Belegbild einmalig über den Finance-Planner-Server an das konfigurierte Hugging-Face-Modell gesendet wird. Das Bild wird nicht im Finance Planner gespeichert.</span></label>
        <button type="button" className="primary receipt-analyze" disabled={!image || !consent || preparing || loading} onClick={() => void analyze()}>
          {loading ? <LoaderCircle className="spin" size={18}/> : <ShoppingBasket size={18}/>} {loading ? 'Beleg wird analysiert …' : 'Einkauf bewerten'}
        </button>
        <p className="receipt-disclaimer"><ShieldCheck size={16}/> Keine Live-Preis- oder Bestandsabfrage. Händler- und Sparvorschläge sind unverbindliche KI-Schätzungen.</p>
        {error && <p className="status-message error-message" role="alert"><AlertTriangle size={17}/>{error}</p>}
      </article>

      <article className="panel receipt-result-card" aria-live="polite">
        <div className="panel-header"><div><p className="eyebrow">2. Ergebnis</p><h2>Dein Einkaufs-Score</h2></div>{result && <CheckCircle2 size={22}/>}</div>
        {!result && <div className="receipt-empty"><Leaf size={42}/><strong>Noch keine Auswertung</strong><span>Nach dem Upload siehst du hier Score, erkannte Artikel und bessere Alternativen.</span></div>}
        {result && <>
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

    {result && <>
      <section className="panel receipt-items">
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
      </section>

      <section className="receipt-layout receipt-followup">
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Nächster Einkauf</p><h2>Empfehlungen</h2></div><Leaf size={20}/></div><ol className="receipt-recommendations">{result.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ol></article>
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Transparenz</p><h2>Grenzen der Analyse</h2></div><ShieldCheck size={20}/></div><ul className="receipt-limitations">{result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p className="receipt-model-id">{result.model.id} · Revision {result.model.revision.slice(0, 8)} · {result.model.license}</p></article>
      </section>
    </>}
  </div>
}
