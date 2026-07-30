import { useState } from 'react'
import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { formatMoney } from './finance'
import type { AppState, SavingsGoal } from './types'

export function SavingsGoals({ state, onChange }: { state: AppState; onChange: (next: AppState) => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SavingsGoal | null>(null)
  const [error, setError] = useState('')

  const startCreate = () => { setEditing(null); setError(''); setOpen(true) }
  const startEdit = (goal: SavingsGoal) => { setEditing(goal); setError(''); setOpen(true) }
  const remove = (id: string) => { if (window.confirm('Sparziel wirklich löschen?')) onChange({ ...state, goals: state.goals.filter((goal) => goal.id !== id) }) }

  const save = (formData: FormData) => {
    const name = String(formData.get('name') || '').trim()
    const target = Number(formData.get('target'))
    const current = Number(formData.get('current'))
    const targetDate = String(formData.get('targetDate') || '')
    if (!name || !targetDate || !Number.isFinite(target) || target <= 0 || !Number.isFinite(current) || current < 0) { setError('Bitte fülle alle Felder mit gültigen Werten aus.'); return }
    if (current > target) { setError('Der bereits gesparte Betrag darf das Ziel nicht überschreiten.'); return }
    const goal: SavingsGoal = { id: editing?.id ?? crypto.randomUUID(), name, targetCents: Math.round(target * 100), currentCents: Math.round(current * 100), targetDate }
    onChange({ ...state, goals: editing ? state.goals.map((item) => item.id === editing.id ? goal : item) : [...state.goals, goal] })
    setOpen(false); setEditing(null); setError('')
  }

  return <>
    <div className="panel-header"><div><p className="eyebrow">Deine Planung</p><h2>Sparziele</h2></div><button className="primary" onClick={startCreate}><Plus size={18}/> Sparziel hinzufügen</button></div>
    {state.goals.length === 0 ? <section className="panel"><p className="muted">Noch keine Sparziele vorhanden.</p><button className="primary" onClick={startCreate}><Plus size={18}/> Erstes Sparziel anlegen</button></section> : <section className="goal-card-grid">{state.goals.map((goal) => {
      const progress = Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100))
      return <article className="panel big-goal" key={goal.id}><div className="panel-header"><div className="goal-hero-icon"><Target size={24}/></div><div className="row-actions"><button aria-label="Sparziel bearbeiten" onClick={() => startEdit(goal)}><Pencil size={16}/></button><button aria-label="Sparziel löschen" onClick={() => remove(goal.id)}><Trash2 size={16}/></button></div></div><p className="eyebrow">Ziel bis {new Date(goal.targetDate).toLocaleDateString('de-DE')}</p><h2>{goal.name}</h2><strong>{formatMoney(goal.currentCents)}</strong><span>Noch {formatMoney(Math.max(0, goal.targetCents - goal.currentCents))} bis zum Ziel</span><div className="progress large"><span style={{ width: `${progress}%` }}/></div><b>{progress}% erreicht</b></article>
    })}</section>}
    {open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><form className="modal" onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)) }} onMouseDown={(event) => event.stopPropagation()}><div className="panel-header"><div><p className="eyebrow">{editing ? 'Sparziel ändern' : 'Neues Sparziel'}</p><h2>{editing ? 'Sparziel bearbeiten' : 'Sparziel hinzufügen'}</h2></div></div><label>Name<input name="name" required maxLength={100} defaultValue={editing?.name ?? ''} placeholder="z. B. Motorradführerschein"/></label><label>Zielbetrag in €<input name="target" type="number" required min="0.01" step="0.01" defaultValue={editing ? editing.targetCents / 100 : undefined}/></label><label>Bereits gespart in €<input name="current" type="number" required min="0" step="0.01" defaultValue={editing ? editing.currentCents / 100 : 0}/></label><label>Zieldatum<input name="targetDate" type="date" required defaultValue={editing?.targetDate ?? ''}/></label>{error && <p className="status-message error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Abbrechen</button><button type="submit" className="primary">{editing ? 'Änderungen speichern' : 'Sparziel speichern'}</button></div></form></div>}
  </>
}
