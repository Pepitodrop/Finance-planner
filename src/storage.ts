import { initialState } from './data'
import type { AppState } from './types'

const STORAGE_KEY = 'finance-planner-state-v1'

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as AppState : initialState
  } catch {
    return initialState
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
