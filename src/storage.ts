import { initialState } from './data'
import type { AppState } from './types'
import { isAppState } from './validation'

const STORAGE_KEY = 'finance-planner-state-v2'
const LEGACY_STORAGE_KEY = 'finance-planner-state-v1'
const RECOVERY_KEY = 'finance-planner-recovery-state'

function cloneInitialState(): AppState {
  return structuredClone(initialState)
}

export function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return cloneInitialState()

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isAppState(parsed)) {
      localStorage.setItem(RECOVERY_KEY, raw)
      return cloneInitialState()
    }
    return parsed
  } catch {
    localStorage.setItem(RECOVERY_KEY, raw)
    return cloneInitialState()
  }
}

export function saveState(state: AppState): void {
  if (!isAppState(state)) throw new Error('Ungültiger Anwendungszustand wurde nicht gespeichert.')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function resetStoredState(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}
