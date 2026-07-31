import { initialState } from '../../data'
import type { AppState } from '../../types'
import { isAppState } from '../../validation'
import {
  getUnlockedVaultPayload,
  persistEncryptedState,
  removeEncryptedVault,
  replaceUnlockedVaultPayload,
  setVaultChangeListener,
  type VaultPayload,
} from '../../vault'
import { CloudStateConflictError, fetchCloudState, saveCloudState } from './cloudState'

const STORAGE_KEY = 'finance-planner-state-v2'
const LEGACY_STORAGE_KEY = 'finance-planner-state-v1'
const RECOVERY_KEY = 'finance-planner-recovery-state'
const CONFLICT_KEY = 'finance-planner-cloud-conflict-v1'
const SAVE_DEBOUNCE_MS = 650

export type CloudSyncPhase = 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'

export interface CloudSyncStatus {
  phase: CloudSyncPhase
  message: string
  lastSyncedAt?: string
}

type StatusListener = (status: CloudSyncStatus) => void

let unlockedState: AppState | null = null
let savedStateFingerprint = ''
let pendingBootstrapFingerprint: string | null = null
let cloudVersion = 0
let cloudEnabled = false
let saveTimer: number | null = null
let retryTimer: number | null = null
let saveInFlight: Promise<void> | null = null
let saveRequested = false
let retryDelayMs = 2_000
let status: CloudSyncStatus = { phase: 'local', message: 'Verschlüsselter lokaler Speicher aktiv.' }
const listeners = new Set<StatusListener>()

function cloneInitialState(): AppState {
  return structuredClone(initialState)
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value)
}

function currentVaultFingerprint(): string {
  const payload = getUnlockedVaultPayload()
  return payload ? fingerprint(payload) : ''
}

function rememberState(state: AppState): void {
  unlockedState = structuredClone(state)
  savedStateFingerprint = fingerprint(state)
}

function emit(next: CloudSyncStatus): void {
  status = next
  for (const listener of listeners) listener(status)
}

function conflictExists(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(CONFLICT_KEY) === 'true'
}

function clearRetryTimer(): void {
  if (retryTimer === null || typeof window === 'undefined') return
  window.clearTimeout(retryTimer)
  retryTimer = null
}

function setConflict(): void {
  localStorage.setItem(CONFLICT_KEY, 'true')
  cloudEnabled = false
  saveRequested = false
  pendingBootstrapFingerprint = null
  clearRetryTimer()
  emit({
    phase: 'conflict',
    message: 'Ein anderes Gerät hat den Cloud-Datenstand geändert. Lokale Änderungen bleiben verschlüsselt erhalten, bis du auswählst, welcher Stand gelten soll.',
  })
}

function clearConflict(): void {
  localStorage.removeItem(CONFLICT_KEY)
}

function scheduleRetry(operation: () => void): void {
  if (typeof window === 'undefined' || retryTimer !== null || conflictExists()) return
  const delay = retryDelayMs
  retryDelayMs = Math.min(retryDelayMs * 2, 30_000)
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    operation()
  }, delay)
}

function scheduleSaveRetry(): void {
  if (!cloudEnabled) return
  scheduleRetry(() => scheduleCloudSave(0))
}

function scheduleBootstrapRetry(): void {
  if (!unlockedState || cloudEnabled) return
  scheduleRetry(() => {
    if (unlockedState) void synchronizeUnlockedState(unlockedState)
  })
}

async function persistLatestPayload({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
  const payload = getUnlockedVaultPayload()
  if (!payload || !cloudEnabled) return
  emit({ phase: 'syncing', message: 'Finanzdaten werden verschlüsselt mit PostgreSQL synchronisiert …', lastSyncedAt: status.lastSyncedAt })
  try {
    const result = await saveCloudState(payload, cloudVersion, { keepalive })
    cloudVersion = result.version
    retryDelayMs = 2_000
    clearRetryTimer()
    clearConflict()
    emit({ phase: 'synced', message: 'Alle Konten, Buchungen, Sparziele und persönlichen Lernwerte sind synchronisiert.', lastSyncedAt: result.updatedAt })
  } catch (error) {
    if (error instanceof CloudStateConflictError) {
      cloudVersion = error.currentVersion
      setConflict()
      return
    }
    saveRequested = false
    emit({ phase: 'offline', message: error instanceof Error ? `Cloud-Synchronisierung pausiert: ${error.message}` : 'Cloud-Synchronisierung ist vorübergehend nicht erreichbar.', lastSyncedAt: status.lastSyncedAt })
    scheduleSaveRetry()
  }
}

async function drainSaveQueue(options?: { keepalive?: boolean }): Promise<void> {
  if (saveInFlight) {
    saveRequested = true
    return saveInFlight
  }
  saveInFlight = (async () => {
    do {
      saveRequested = false
      await persistLatestPayload(options)
    } while (saveRequested && cloudEnabled)
  })().finally(() => { saveInFlight = null })
  return saveInFlight
}

function scheduleCloudSave(delay = SAVE_DEBOUNCE_MS): void {
  if (!cloudEnabled || conflictExists() || !getUnlockedVaultPayload()) return
  saveRequested = true
  clearRetryTimer()
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void drainSaveQueue()
  }, delay)
}

setVaultChangeListener(() => {
  if (typeof window !== 'undefined') scheduleCloudSave()
})

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    clearRetryTimer()
    if (cloudEnabled) scheduleCloudSave(0)
    else scheduleBootstrapRetry()
  })
}

export function subscribeCloudSyncStatus(listener: StatusListener): () => void {
  listeners.add(listener)
  listener(status)
  return () => listeners.delete(listener)
}

export function getCloudSyncStatus(): CloudSyncStatus {
  return status
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
  rememberState(state)
}

export function clearUnlockedState(): void {
  unlockedState = null
  savedStateFingerprint = ''
  pendingBootstrapFingerprint = null
  cloudEnabled = false
  clearRetryTimer()
}

export function loadState(): AppState {
  return unlockedState ? structuredClone(unlockedState) : cloneInitialState()
}

export async function synchronizeUnlockedState(localState: AppState): Promise<AppState> {
  rememberState(localState)
  if (conflictExists()) {
    emit({ phase: 'conflict', message: 'Ein ungelöster Cloud-Konflikt schützt deine lokalen Änderungen vor Überschreiben.' })
    return structuredClone(localState)
  }

  if (pendingBootstrapFingerprint === null) pendingBootstrapFingerprint = currentVaultFingerprint()
  emit({ phase: 'syncing', message: 'Verschlüsselter Cloud-Datenstand wird geladen …' })
  try {
    const remote = await fetchCloudState()
    cloudVersion = remote.version
    if (remote.payload) {
      if (pendingBootstrapFingerprint !== currentVaultFingerprint()) {
        setConflict()
        return loadState()
      }
      await replaceUnlockedVaultPayload(remote.payload)
      rememberState(remote.payload.state)
      pendingBootstrapFingerprint = null
      cloudEnabled = true
      retryDelayMs = 2_000
      clearRetryTimer()
      emit({ phase: 'synced', message: 'Cloud-Datenstand wurde auf diesem Gerät geöffnet.', ...(remote.updatedAt ? { lastSyncedAt: remote.updatedAt } : {}) })
      return structuredClone(remote.payload.state)
    }

    const localPayload = getUnlockedVaultPayload() ?? { state: structuredClone(localState), secureData: {} }
    const created = await saveCloudState(localPayload, 0)
    cloudVersion = created.version
    rememberState(localPayload.state)
    pendingBootstrapFingerprint = null
    cloudEnabled = true
    retryDelayMs = 2_000
    clearRetryTimer()
    emit({ phase: 'synced', message: 'Der lokale Datenstand wurde als verschlüsselte Cloud-Kopie angelegt.', lastSyncedAt: created.updatedAt })
    return structuredClone(localPayload.state)
  } catch (error) {
    if (error instanceof CloudStateConflictError) {
      cloudVersion = error.currentVersion
      setConflict()
      return loadState()
    }
    cloudEnabled = false
    emit({ phase: 'offline', message: error instanceof Error ? `Lokaler Modus: ${error.message}` : 'Lokaler Modus: Cloud-Speicher nicht erreichbar.' })
    scheduleBootstrapRetry()
    return loadState()
  }
}

export function saveState(state: AppState): void {
  if (!isAppState(state)) throw new Error('Ungültiger Anwendungszustand wurde nicht gespeichert.')
  const nextFingerprint = fingerprint(state)
  unlockedState = structuredClone(state)
  if (nextFingerprint === savedStateFingerprint) return
  savedStateFingerprint = nextFingerprint
  void persistEncryptedState(state).catch((error: unknown) => {
    emit({ phase: 'error', message: error instanceof Error ? error.message : 'Die lokale Verschlüsselung ist fehlgeschlagen.' })
    console.error('Encrypted persistence failed', error)
  })
}

export async function flushCloudState({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  clearRetryTimer()
  if (!cloudEnabled) return
  saveRequested = true
  await drainSaveQueue({ keepalive })
}

export async function resolveCloudConflict(strategy: 'server' | 'local'): Promise<AppState> {
  const remote = await fetchCloudState()
  if (strategy === 'server') {
    if (!remote.payload) throw new Error('Auf dem Server ist kein Datenstand vorhanden.')
    await replaceUnlockedVaultPayload(remote.payload)
    rememberState(remote.payload.state)
    cloudVersion = remote.version
  } else {
    const localPayload = getUnlockedVaultPayload()
    if (!localPayload) throw new Error('Der lokale Vault ist nicht entsperrt.')
    const saved = await saveCloudState(localPayload, remote.version)
    cloudVersion = saved.version
    rememberState(localPayload.state)
  }
  cloudEnabled = true
  pendingBootstrapFingerprint = null
  retryDelayMs = 2_000
  clearRetryTimer()
  clearConflict()
  emit({ phase: 'synced', message: strategy === 'server' ? 'Der Serverstand wurde übernommen.' : 'Der lokale Stand wurde bewusst als neuer Cloud-Stand gespeichert.', lastSyncedAt: new Date().toISOString() })
  return loadState()
}

export function resetStoredState(): void {
  clearLegacyPlaintextState()
  const resetPayload: VaultPayload = { state: cloneInitialState(), secureData: {} }
  rememberState(resetPayload.state)
  if (getUnlockedVaultPayload()) {
    void replaceUnlockedVaultPayload(resetPayload)
      .then(() => scheduleCloudSave(0))
      .catch((error: unknown) => emit({ phase: 'error', message: error instanceof Error ? error.message : 'Zurücksetzen fehlgeschlagen.' }))
  } else {
    removeEncryptedVault()
  }
}
