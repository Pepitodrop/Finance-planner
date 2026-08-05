import { GoalsPage } from './features/goals/GoalsPage'
import type { AppState } from './types'

export function SavingsGoals({ state, onChange }: { state: AppState; onChange: (next: AppState) => void }) {
  return <GoalsPage state={state} onChange={onChange}/>
}
