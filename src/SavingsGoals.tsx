import { useMemo, useState } from 'react'
import { CalendarDays, CircleDollarSign, Pencil, PiggyBank, Plus, Target, Trash2, TrendingUp } from 'lucide-react'
import { formatMoney } from './finance'
import type { AppState, SavingsGoal } from './types'

const MAX_GOAL_EUROS = 1_000_000_000_000

function safeCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_GOAL_EUROS) return null
  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export function SavingsGoals({ state, onChange }: { state: AppState; onChange: (next: AppState) => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SavingsGoal | null>(null)
  const [error, setError] = useState('')

  const summary = useMemo(() => {
    const targetCents = state.goals.reduce((sum, goal) => sum + goal.targetCents, 0)
    const savedCents = state.goals.reduce((sum, goal) => sum + goal.currentCents, 0)
    const nextGoal = [...state.goals].sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0] ?? null
    const averageProgress = state.goals.length
      ? Math.round(state.goals.reduce((sum, goal) => sum + Math.min(100, (goal.currentCents / goal.targetCents) * 100), 0) / state.goals.length)
      : 0
    return { targetCents, savedCents, remainingCents: Math.max(0, targetCents - savedCents), nextGoal, averageProgress }
  }, [state.goals])

  const startCreate = () => { setEditing(null); setError(''); setOpen(true) }
  const startEdit = (goal: SavingsGoal) => { setEditing(goal); setError(''); setOpen(true) }
  const remove = (id: string) => { if (window.confirm('Sparziel wirklich löschen?')) onChange({ ...state, goals: state.goals.filter((goal) => goal.id !== id) }) }

  const save = (formData: FormData) => {
    const name = String(formData.get('name') || '').trim()
    const target = Number(formData.get('target'))
    const current = Number(formData.get('current'))
    const targetDate = String(formData.get('targetDate') || '')
    const targetCents = safeCents(target)
    const currentCents = safeCents(current)
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetCents === null || targetCents <= 0 || currentCents === null) {
      setError(`Bitte fülle alle Felder mit gültigen Werten bis maximal ${MAX_GOAL_EUROS.toLocaleString('de-DE')} € aus.`)
      return
    }
    if (currentCents > targetCents) { setError('Der bereits gesparte Betrag darf das Ziel nicht überschreiten.'); return }
    const goal: SavingsGoal = { id: editing?.id ?? crypto.randomUUID(), name, targetCents, currentCents, targetDate }
    onChange({ ...state, goals: editing ? state.goals.map((item) => item.id === editing.id ? goal : item) : [...state.goals, goal] })
    setOpen(false); setEditing(null); setError('')
  }

  return <div className="goals-reference-page">
    <section className="reference-page-toolbar">
      <div><p className="eyebrow">Ziele & Fortschritt</p><h2>Deine finanziellen Meilensteine</h2><p className="muted">Plane größere Ausgaben, verfolge deinen Fortschritt und erkenne, welches Ziel als Nächstes Aufmerksamkeit braucht.</p></div>
      <button className="primary" onClick={startCreate}><Plus size={18}/> Neues Sparziel</button>
    </section>

    <section className="reference-kpi-grid" aria-label="Sparzielübersicht">
      <article className="reference-kpi-card"><span>Zielvolumen</span><strong>{formatMoney(summary.targetCents)}</strong><small><Target size={15}/> {state.goals.length} aktive Ziele</small></article>
      <article className="reference-kpi-card"><span>Bereits gespart</span><strong>{formatMoney(summary.savedCents)}</strong><small className="positive-text"><TrendingUp size={15}/> {summary.averageProgress}% Ø Fortschritt</small></article>
      <article className="reference-kpi-card"><span>Noch erforderlich</span><strong>{formatMoney(summary.remainingCents)}</strong><small><PiggyBank size={15}/> Über alle Ziele</small></article>
      <article className="reference-kpi-card highlight"><span>Nächster Termin</span><strong>{summary.nextGoal ? new Date(summary.nextGoal.targetDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</strong><small><CalendarDays size={15}/> {summary.nextGoal?.name ?? 'Noch kein Ziel'}</small></article>
    </section>

    <section className="reference-content-grid goals-content-grid">
      <div className="reference-primary-column">
        <section className="panel goals-list-panel">
          <div className="panel-header"><div><p className="eyebrow">Portfolio</p><h2>Alle Sparziele</h2></div><span className="pill">{state.goals.length} Ziele</span></div>
          {state.goals.length === 0 ? <div className="connection-empty-state"><div className="goal-hero-icon"><Target size={24}/></div><strong>Noch keine Sparziele vorhanden</strong><span>Lege dein erstes Ziel an und verfolge den Fortschritt wie in einem persönlichen Finanz-Dashboard.</span><button className="primary" onClick={startCreate}><Plus size={18}/> Erstes Sparziel anlegen</button></div> : <div className="goal-card-grid">{state.goals.map((goal) => {
            const progress = Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100))
            return <article className="panel big-goal" key={goal.id}>
              <div className="panel-header"><div className="goal-hero-icon"><Target size={24}/></div><div className="row-actions"><button aria-label="Sparziel bearbeiten" onClick={() => startEdit(goal)}><Pencil size={16}/></button><button aria-label="Sparziel löschen" onClick={() => remove(goal.id)}><Trash2 size={16}/></button></div></div>
              <p className="eyebrow">Ziel bis {new Date(goal.targetDate).toLocaleDateString('de-DE')}</p>
              <h2>{goal.name}</h2>
              <strong>{formatMoney(goal.currentCents)}</strong>
              <span>{formatMoney(goal.targetCents)} Zielbetrag · noch {formatMoney(Math.max(0, goal.targetCents - goal.currentCents))}</span>
              <div className="progress large" aria-label={`${progress} Prozent erreicht`}><span style={{ width: `${progress}%` }}/></div>
              <b>{progress}% erreicht</b>
            </article>
          })}</div>}
        </section>
      </div>

      <aside className="reference-context-column" aria-label="Sparzielanalyse">
        <section className="panel reference-side-card">
          <div className="panel-header"><div><p className="eyebrow">Fortschritt</p><h2>Gesamtstatus</h2></div><CircleDollarSign size={20}/></div>
          <div className="goal-overall-progress"><strong>{summary.averageProgress}%</strong><span>durchschnittlich erreicht</span><div className="progress large"><span style={{ width: `${summary.averageProgress}%` }}/></div></div>
        </section>
        <section className="panel reference-side-card">
          <div className="panel-header"><div><p className="eyebrow">Priorität</p><h2>Nächstes Ziel</h2></div><CalendarDays size={20}/></div>
          {summary.nextGoal ? <div className="next-goal-summary"><strong>{summary.nextGoal.name}</strong><span>{new Date(summary.nextGoal.targetDate).toLocaleDateString('de-DE')}</span><b>{formatMoney(Math.max(0, summary.nextGoal.targetCents - summary.nextGoal.currentCents))} fehlen</b></div> : <p className="muted">Lege ein Ziel mit Termin an, um hier eine Priorisierung zu sehen.</p>}
        </section>
        <button className="reference-wide-action" onClick={startCreate}><Plus size={17}/> Weiteres Ziel hinzufügen</button>
      </aside>
    </section>

    {open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><form className="modal" onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)) }} onMouseDown={(event) => event.stopPropagation()}><div className="panel-header"><div><p className="eyebrow">{editing ? 'Sparziel ändern' : 'Neues Sparziel'}</p><h2>{editing ? 'Sparziel bearbeiten' : 'Sparziel hinzufügen'}</h2></div></div><label>Name<input name="name" required maxLength={100} defaultValue={editing?.name ?? ''} placeholder="z. B. Motorradführerschein"/></label><label>Zielbetrag in €<input name="target" type="number" required min="0.01" max={MAX_GOAL_EUROS} step="0.01" inputMode="decimal" defaultValue={editing ? editing.targetCents / 100 : undefined}/></label><label>Bereits gespart in €<input name="current" type="number" required min="0" max={MAX_GOAL_EUROS} step="0.01" inputMode="decimal" defaultValue={editing ? editing.currentCents / 100 : 0}/></label><label>Zieldatum<input name="targetDate" type="date" required defaultValue={editing?.targetDate ?? ''}/></label>{error && <p className="status-message error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Abbrechen</button><button type="submit" className="primary">{editing ? 'Änderungen speichern' : 'Sparziel speichern'}</button></div></form></div>}
  </div>
}
