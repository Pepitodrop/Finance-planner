import { initialState } from './data'
import type { AppState } from './types'
import { isAppState } from './validation'
import { persistEncryptedState, removeEncryptedVault } from './vault'

const STORAGE_KEY = 'finance-planner-state-v2'
const LEGACY_STORAGE_KEY = 'finance-planner-state-v1'
const RECOVERY_KEY = 'finance-planner-recovery-state'

let unlockedState: AppState | null = null

function cloneInitialState(): AppState {
  return structuredClone(initialState)
}

export function loadLegacyState(): AppState {
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

export function hasLegacyPlaintextState(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null || localStorage.getItem(LEGACY_STORAGE_KEY) !== null
}

export function clearLegacyPlaintextState(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function setUnlockedState(state: AppState): void {
  unlockedState = structuredClone(state)
}

export function clearUnlockedState(): void {
  unlockedState = null
}

export function loadState(): AppState {
  return unlockedState ? structuredClone(unlockedState) : cloneInitialState()
}

export function saveState(state: AppState): void {
  if (!isAppState(state)) throw new Error('Ungültiger Anwendungszustand wurde nicht gespeichert.')
  unlockedState = structuredClone(state)
  void persistEncryptedState(state).catch((error: unknown) => {
    console.error('Encrypted persistence failed', error)
  })
}

export function resetStoredState(): void {
  clearLegacyPlaintextState()
  removeEncryptedVault()
  unlockedState = null
}
