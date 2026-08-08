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
const CONFLICT_KEY_PREFIX = 'finance-planner-cloud-conflict-v2:'
const SYNC_METADATA_PREFIX = 'finance-planner-cloud-metadata-v1:'
const SAVE_DEBOUNCE_MS = 650

export type CloudSyncPhase = 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'

export interface CloudSyncStatus {
  phase: CloudSyncPhase
  message: string
  lastSyncedAt?: string
}

interface SyncMetadata {
  version: number
  dirty: boolean
  lastSyncedAt?: string
}

type StatusListener = (status: CloudSyncStatus) => void

let activeUserId = ''
let syncMetadata: SyncMetadata = { version: 0, dirty: false }
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
let status: CloudSyncStatus = { phase: 'local', message: 'Encrypted local storage active.' }
const listeners = new Set<StatusListener>()

function cloneInitialState(): AppState {
  return structuredClone(initialState)
}

function requireActiveUser(): string {
  if (!activeUserId) throw new Error('Cloud storage was not assigned to a signed-in account.')
  return activeUserId
}

function accountStorageKey(prefix: string): string {
  return `${prefix}${encodeURIComponent(requireActiveUser())}`
}

function conflictStorageKey(): string {
  return accountStorageKey(CONFLICT_KEY_PREFIX)
}

function syncMetadataStorageKey(): string {
  return accountStorageKey(SYNC_METADATA_PREFIX)
}

function hasSyncMetadataRecord(): boolean {
  return localStorage.getItem(syncMetadataStorageKey()) !== null
}

function readSyncMetadata(): SyncMetadata {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(syncMetadataStorageKey()) || '{}')
    if (typeof parsed !== 'object' || parsed === null) return { version: 0, dirty: false }
    const candidate = parsed as Partial<SyncMetadata>
    const version = Number(candidate.version)
    return {
      version: Number.isSafeInteger(version) && version >= 0 ? version : 0,
      dirty: candidate.dirty === true,
      ...(typeof candidate.lastSyncedAt === 'string' ? { lastSyncedAt: candidate.lastSyncedAt } : {}),
    }
  } catch {
    return { version: 0, dirty: false }
  }
}

function writeSyncMetadata(next: SyncMetadata): void {
  syncMetadata = next
  localStorage.setItem(syncMetadataStorageKey(), JSON.stringify(next))
}

function markDirty(): void {
  if (!activeUserId || syncMetadata.dirty) return
  writeSyncMetadata({ ...syncMetadata, dirty: true })
}

function markSynced(version: number, updatedAt: string): void {
  writeSyncMetadata({ version, dirty: false, lastSyncedAt: updatedAt })
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
  return typeof localStorage !== 'undefined' && localStorage.getItem(conflictStorageKey()) === 'true'
}

function clearRetryTimer(): void {
  if (retryTimer === null || typeof window === 'undefined') return
  window.clearTimeout(retryTimer)
  retryTimer = null
}

function clearSaveTimer(): void {
  if (saveTimer === null || typeof window === 'undefined') return
  window.clearTimeout(saveTimer)
  saveTimer = null
}

function setConflict(): void {
  localStorage.setItem(conflictStorageKey(), 'true')
  cloudEnabled = false
  saveRequested = false
  pendingBootstrapFingerprint = null
  clearRetryTimer()
  emit({
    phase: 'conflict',
    message: 'A different or not-yet-linked data state was found. Local changes stay encrypted and safe until you choose which version should apply.',
  })
}

function clearConflict(): void {
  localStorage.removeItem(conflictStorageKey())
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
  emit({ phase: 'syncing', message: 'Encrypting and syncing your financial data with PostgreSQL…', lastSyncedAt: status.lastSyncedAt })
  try {
    const result = await saveCloudState(payload, cloudVersion, { keepalive })
    cloudVersion = result.version
    markSynced(result.version, result.updatedAt)
    retryDelayMs = 2_000
    clearRetryTimer()
    clearConflict()
    emit({ phase: 'synced', message: 'All accounts, transactions, goals, and personal learning data are synced.', lastSyncedAt: result.updatedAt })
  } catch (error) {
    if (error instanceof CloudStateConflictError) {
      cloudVersion = error.currentVersion
      setConflict()
      return
    }
    saveRequested = false
    emit({ phase: 'offline', message: error instanceof Error ? `Cloud sync paused: ${error.message}` : 'Cloud sync is temporarily unreachable.', lastSyncedAt: status.lastSyncedAt })
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
  clearSaveTimer()
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void drainSaveQueue()
  }, delay)
}

setVaultChangeListener(() => {
  if (typeof window !== 'undefined' && activeUserId) {
    markDirty()
    scheduleCloudSave()
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!activeUserId) return
    clearRetryTimer()
    if (cloudEnabled) scheduleCloudSave(0)
    else scheduleBootstrapRetry()
  })
}

export function configureAuthenticatedStorage(userId: string): void {
  const normalized = String(userId || '').trim()
  if (!normalized || normalized.length > 256) throw new Error('The signed-in account identifier is invalid.')
  if (activeUserId === normalized) return
  clearSaveTimer()
  clearRetryTimer()
  activeUserId = normalized
  syncMetadata = readSyncMetadata()
  unlockedState = null
  savedStateFingerprint = ''
  pendingBootstrapFingerprint = null
  cloudVersion = syncMetadata.version
  cloudEnabled = false
  saveInFlight = null
  saveRequested = false
  retryDelayMs = 2_000
  emit({ phase: 'local', message: syncMetadata.dirty ? 'Unsynced local changes were found for this account.' : 'Encrypted local storage active for the signed-in account.', ...(syncMetadata.lastSyncedAt ? { lastSyncedAt: syncMetadata.lastSyncedAt } : {}) })
}

export function prepareNewDeviceCloudBootstrap(): void {
  requireActiveUser()
  if (!hasSyncMetadataRecord()) writeSyncMetadata({ version: 0, dirty: false })
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
  requireActiveUser()
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return cloneInitialState()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Die vorhandenen Klartextdaten sind beschädigt und wurden nicht verändert. Sie können nicht automatisch in den verschlüsselten Vault migriert werden.')
  }
  if (!isAppState(parsed)) {
    throw new Error('Die vorhandenen Klartextdaten haben ein unbekanntes Format und wurden nicht verändert. Sie können nicht automatisch in den verschlüsselten Vault migriert werden.')
  }
  return parsed
}

export function hasLegacyPlaintextState(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null || localStorage.getItem(LEGACY_STORAGE_KEY) !== null
}

export function clearLegacyPlaintextState(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function setUnlockedState(state: AppState): void {
  requireActiveUser()
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
  requireActiveUser()
  rememberState(localState)
  if (conflictExists()) {
    emit({ phase: 'conflict', message: 'An unresolved cloud conflict is protecting your local changes from being overwritten.' })
    return structuredClone(localState)
  }

  if (pendingBootstrapFingerprint === null) pendingBootstrapFingerprint = currentVaultFingerprint()
  emit({ phase: 'syncing', message: 'Loading your encrypted cloud data…' })
  try {
    const remote = await fetchCloudState()
    cloudVersion = remote.version
    if (remote.payload) {
      if (pendingBootstrapFingerprint !== currentVaultFingerprint()) {
        markDirty()
        setConflict()
        return loadState()
      }
      if (!hasSyncMetadataRecord()) {
        const localPayload = getUnlockedVaultPayload()
        if (localPayload && fingerprint(localPayload) !== fingerprint(remote.payload)) {
          markDirty()
          setConflict()
          return loadState()
        }
      }
      if (syncMetadata.dirty) {
        if (syncMetadata.version !== remote.version) {
          setConflict()
          return loadState()
        }
        pendingBootstrapFingerprint = null
        cloudEnabled = true
        retryDelayMs = 2_000
        clearRetryTimer()
        emit({ phase: 'syncing', message: 'Uploading your locally saved offline changes before loading the server version…', ...(syncMetadata.lastSyncedAt ? { lastSyncedAt: syncMetadata.lastSyncedAt } : {}) })
        scheduleCloudSave(0)
        return loadState()
      }

      await replaceUnlockedVaultPayload(remote.payload)
      rememberState(remote.payload.state)
      pendingBootstrapFingerprint = null
      cloudEnabled = true
      markSynced(remote.version, remote.updatedAt ?? new Date().toISOString())
      retryDelayMs = 2_000
      clearRetryTimer()
      emit({ phase: 'synced', message: 'Cloud data was opened on this device.', ...(remote.updatedAt ? { lastSyncedAt: remote.updatedAt } : {}) })
      return structuredClone(remote.payload.state)
    }

    const localPayload = getUnlockedVaultPayload() ?? { state: structuredClone(localState), secureData: {} }
    const created = await saveCloudState(localPayload, 0)
    cloudVersion = created.version
    rememberState(localPayload.state)
    pendingBootstrapFingerprint = null
    cloudEnabled = true
    markSynced(created.version, created.updatedAt)
    retryDelayMs = 2_000
    clearRetryTimer()
    emit({ phase: 'synced', message: 'Your local data was saved as an encrypted cloud copy.', lastSyncedAt: created.updatedAt })
    return structuredClone(localPayload.state)
  } catch (error) {
    if (error instanceof CloudStateConflictError) {
      cloudVersion = error.currentVersion
      setConflict()
      return loadState()
    }
    cloudEnabled = false
    emit({ phase: 'offline', message: error instanceof Error ? `Local mode: ${error.message}` : 'Local mode: cloud storage unreachable.', ...(syncMetadata.lastSyncedAt ? { lastSyncedAt: syncMetadata.lastSyncedAt } : {}) })
    scheduleBootstrapRetry()
    return loadState()
  }
}

export function saveState(state: AppState): void {
  requireActiveUser()
  if (!isAppState(state)) throw new Error('Invalid application state was not saved.')
  const nextFingerprint = fingerprint(state)
  unlockedState = structuredClone(state)
  if (nextFingerprint === savedStateFingerprint) return
  savedStateFingerprint = nextFingerprint
  markDirty()
  void persistEncryptedState(state).catch((error: unknown) => {
    emit({ phase: 'error', message: error instanceof Error ? error.message : 'Local encryption failed.' })
    console.error('Encrypted persistence failed', error)
  })
}

export async function flushCloudState({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
  clearSaveTimer()
  clearRetryTimer()
  if (!cloudEnabled || !syncMetadata.dirty) return
  saveRequested = true
  await drainSaveQueue({ keepalive })
}

export async function resolveCloudConflict(strategy: 'server' | 'local'): Promise<AppState> {
  requireActiveUser()
  const remote = await fetchCloudState()
  if (strategy === 'server') {
    if (!remote.payload) throw new Error('Auf dem Server ist kein Datenstand vorhanden.')
    await replaceUnlockedVaultPayload(remote.payload)
    rememberState(remote.payload.state)
    cloudVersion = remote.version
    markSynced(remote.version, remote.updatedAt ?? new Date().toISOString())
  } else {
    const localPayload = getUnlockedVaultPayload()
    if (!localPayload) throw new Error('The local vault is not unlocked.')
    const saved = await saveCloudState(localPayload, remote.version)
    cloudVersion = saved.version
    rememberState(localPayload.state)
    markSynced(saved.version, saved.updatedAt)
  }
  cloudEnabled = true
  pendingBootstrapFingerprint = null
  retryDelayMs = 2_000
  clearRetryTimer()
  clearConflict()
  emit({ phase: 'synced', message: strategy === 'server' ? 'The cloud version was applied.' : "This device's version was deliberately saved as the new cloud version.", lastSyncedAt: syncMetadata.lastSyncedAt })
  return loadState()
}

export function resetStoredState(): void {
  const userId = requireActiveUser()
  clearLegacyPlaintextState()
  const resetPayload: VaultPayload = { state: cloneInitialState(), secureData: {} }
  rememberState(resetPayload.state)
  markDirty()
  if (getUnlockedVaultPayload()) {
    void replaceUnlockedVaultPayload(resetPayload)
      .then(() => scheduleCloudSave(0))
      .catch((error: unknown) => emit({ phase: 'error', message: error instanceof Error ? error.message : 'Reset failed.' }))
  } else {
    removeEncryptedVault(userId)
  }
}
