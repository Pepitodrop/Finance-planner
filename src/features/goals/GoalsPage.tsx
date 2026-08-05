import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, MoreHorizontal, Pencil, Plus, Target, Trash2, X } from 'lucide-react'
import { formatMoney } from '../../finance'
import type { AppState, SavingsGoal } from '../../types'
import { goalProgress, MAX_GOAL_EUROS, summarizeGoals, eurosToCents, validateGoalDraft } from './goalsModel'

interface Props { state: AppState; onChange: (next: AppState) => void }

export function GoalsPage({ state, onChange }: Props) {
  const [editor, setEditor] = useState<SavingsGoal | 'new' | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const launchRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  const summary = useMemo(() => summarizeGoals(state.goals), [state.goals])

  const closeEditor = () => { setEditor(null); setError(''); requestAnimationFrame(() => launchRef.current?.focus()) }
  const openEditor = (goal: SavingsGoal | 'new', trigger: HTMLElement) => { launchRef.current = trigger; setMenuId(null); setError(''); setEditor(goal) }

  useEffect(() => {
    if (!editor) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = document.querySelector<HTMLElement>('.app-frame')
    const mobileNav = document.querySelector<HTMLElement>('.mobile-bottom-nav')
    frame?.setAttribute('inert', '')
    mobileNav?.setAttribute('inert', '')
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('input')?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEditor()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('input, button:not([disabled])')]
      const first = controls[0]; const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = previousOverflow; frame?.removeAttribute('inert'); mobileNav?.removeAttribute('inert'); document.removeEventListener('keydown', keydown) }
  }, [editor])

  const save = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const draft = { name: String(data.get('name') ?? ''), target: Number(data.get('target')), current: Number(data.get('current')), targetDate: String(data.get('targetDate') ?? '') }
    const message = validateGoalDraft(draft)
    if (message) { setError(message); return }
    const goal: SavingsGoal = { id: editor === 'new' ? crypto.randomUUID() : editor!.id, name: draft.name.trim(), targetCents: eurosToCents(draft.target)!, currentCents: eurosToCents(draft.current)!, targetDate: draft.targetDate }
    onChange({ ...state, goals: editor === 'new' ? [...state.goals, goal] : state.goals.map((item) => item.id === goal.id ? goal : item) })
    closeEditor()
  }

  const remove = (goal: SavingsGoal) => {
    setMenuId(null)
    if (window.confirm(`Delete “${goal.name}”?`)) onChange({ ...state, goals: state.goals.filter((item) => item.id !== goal.id) })
  }

  return <main className="goals-page" lang="en" data-feature="goals">
    <header className="planning-toolbar"><div><h1>Goals</h1><p>Track what you’re saving for.</p></div><button className="primary" onClick={(event) => openEditor('new', event.currentTarget)}><Plus size={18}/> Add goal</button></header>
    {state.goals.length > 0 && <section className="goals-summary" aria-label="Goals summary">
      <div><span>Total target</span><strong>{formatMoney(summary.targetCents)}</strong></div>
      <div><span>Saved</span><strong className="positive-text">{formatMoney(summary.savedCents)}</strong></div>
      <div className="goals-summary-wide"><span>Remaining</span><strong>{formatMoney(summary.remainingCents)}</strong><small><CalendarDays size={15}/> Next target {summary.nextGoal ? new Date(`${summary.nextGoal.targetDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</small></div>
    </section>}
    {state.goals.length === 0 ? <section className="planning-empty" aria-labelledby="goals-empty-title"><span className="planning-empty-icon"><Target/></span><h2 id="goals-empty-title">No goals yet</h2><p>A goal records a target amount, what you have already saved, and a target date.</p><button className="primary" onClick={(event) => openEditor('new', event.currentTarget)}><Plus size={18}/> Add first goal</button><small>You can update or remove goals at any time.</small></section> : <section aria-labelledby="goal-list-title"><h2 id="goal-list-title" className="planning-section-title">Your goals</h2><ul className="goal-list">{state.goals.map((goal) => {
      const progress = goalProgress(goal)
      return <li className="goal-card" key={goal.id}><span className="planning-icon"><Target/></span><div className="goal-card-main"><h3>{goal.name}</h3><div className="goal-progress" role="progressbar" aria-label={`${goal.name}: ${progress}% saved`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }}/></div><p><strong>{formatMoney(goal.currentCents)}</strong> of {formatMoney(goal.targetCents)} <b>{progress}%</b></p><small>Target date: {new Date(`${goal.targetDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div><div className="goal-menu"><button aria-label={`Actions for ${goal.name}`} aria-expanded={menuId === goal.id} onClick={() => setMenuId(menuId === goal.id ? null : goal.id)}><MoreHorizontal/></button>{menuId === goal.id && <div role="menu"><button role="menuitem" onClick={(event) => openEditor(goal, event.currentTarget)}><Pencil/> Edit</button><button role="menuitem" className="negative-text" onClick={() => remove(goal)}><Trash2/> Delete</button></div>}</div></li>
    })}</ul></section>}
    {editor && <div className="planning-dialog-backdrop" onMouseDown={closeEditor}><form ref={dialogRef} className="goal-dialog" role="dialog" aria-modal="true" aria-labelledby="goal-dialog-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); save(event.currentTarget) }}><span className="sheet-handle"/><header><div><h2 id="goal-dialog-title">{editor === 'new' ? 'Add goal' : 'Edit goal'}</h2><p>Set a target you can update later.</p></div><button type="button" aria-label="Close goal editor" onClick={closeEditor}><X/></button></header><label>Goal name<input name="name" required maxLength={100} defaultValue={editor === 'new' ? '' : editor.name}/></label><label>Target amount<span className="currency-input"><b>EUR</b><input name="target" type="number" min="0.01" max={MAX_GOAL_EUROS} step="0.01" inputMode="decimal" defaultValue={editor === 'new' ? '' : editor.targetCents / 100}/></span></label><label>Already saved<span className="currency-input"><b>EUR</b><input name="current" type="number" min="0" max={MAX_GOAL_EUROS} step="0.01" inputMode="decimal" defaultValue={editor === 'new' ? 0 : editor.currentCents / 100}/></span></label><label>Target date<input name="targetDate" type="date" required defaultValue={editor === 'new' ? '' : editor.targetDate}/></label>{error && <p className="goal-error" role="alert">{error}</p>}<footer><button type="button" className="secondary" onClick={closeEditor}>Cancel</button><button className="primary" type="submit">Save goal</button></footer></form></div>}
  </main>
}
