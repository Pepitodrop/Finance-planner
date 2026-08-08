import { GoalsPage } from './features/goals/GoalsPage'
import type { AppState } from './types'

export function SavingsGoals({ state, onChange, initialEditorOpen }: { state: AppState; onChange: (next: AppState) => void; initialEditorOpen?: boolean }) {
  return <GoalsPage state={state} onChange={onChange} initialEditorOpen={initialEditorOpen}/>
}
