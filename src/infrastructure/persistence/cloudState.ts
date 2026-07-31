import type { VaultPayload } from '../../vault'
import { isAppState } from '../../validation'

export interface CloudStateDocument {
  payload: VaultPayload | null
  version: number
  updatedAt: string | null
}

export interface CloudStateWriteResult {
  version: number
  updatedAt: string
}

export class CloudStateConflictError extends Error {
  readonly currentVersion: number

  constructor(currentVersion: number) {
    super('Der Cloud-Datenstand wurde auf einem anderen Gerät geändert.')
    this.name = 'CloudStateConflictError'
    this.currentVersion = currentVersion
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVaultPayload(value: unknown): value is VaultPayload {
  return isRecord(value) && isAppState(value.state) && isRecord(value.secureData)
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}))
  return isRecord(payload) ? payload : {}
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  const error = payload.error
  if (typeof error === 'string') return error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return fallback
}

export async function fetchCloudState(): Promise<CloudStateDocument> {
  const response = await fetch('/api/finance/state', {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  const payload = await responsePayload(response)
  if (!response.ok) throw new Error(errorMessage(payload, 'Der Cloud-Datenstand konnte nicht geladen werden.'))
  const version = Number(payload.version)
  const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : null
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Der Cloud-Datenstand hat eine ungültige Version.')
  if (payload.payload !== null && !isVaultPayload(payload.payload)) throw new Error('Der Cloud-Datenstand hat ein ungültiges Format.')
  return { payload: payload.payload as VaultPayload | null, version, updatedAt }
}

export async function saveCloudState(
  payload: VaultPayload,
  expectedVersion: number,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<CloudStateWriteResult> {
  if (!isVaultPayload(payload)) throw new Error('Ungültige lokale Daten können nicht synchronisiert werden.')
  const response = await fetch('/api/finance/state', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    keepalive,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ payload, expectedVersion }),
  })
  const result = await responsePayload(response)
  if (response.status === 409) {
    const currentVersion = Number(result.currentVersion)
    throw new CloudStateConflictError(Number.isSafeInteger(currentVersion) && currentVersion >= 0 ? currentVersion : expectedVersion)
  }
  if (!response.ok) throw new Error(errorMessage(result, 'Der Cloud-Datenstand konnte nicht gespeichert werden.'))
  const version = Number(result.version)
  if (!Number.isSafeInteger(version) || version < 1 || typeof result.updatedAt !== 'string') {
    throw new Error('Die Cloud-Speicherbestätigung ist ungültig.')
  }
  return { version, updatedAt: result.updatedAt }
}
