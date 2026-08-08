import type { AppState } from './types'
import { isAppState } from './validation'

const LEGACY_VAULT_KEY = 'finance-planner-encrypted-vault-v1'
const VAULT_KEY_PREFIX = 'finance-planner-encrypted-vault-v2:'
const PBKDF2_ITERATIONS = 310_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface LegacyVaultEnvelope {
  format: 'finance-planner-encrypted-vault'
  version: 1
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
  updatedAt: string
}

interface VaultEnvelope {
  format: 'finance-planner-encrypted-vault'
  version: 2
  ownerId: string
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
  updatedAt: string
}

type AnyVaultEnvelope = LegacyVaultEnvelope | VaultEnvelope

export interface VaultPayload {
  state: AppState
  secureData: Record<string, unknown>
}

let sessionKey: CryptoKey | null = null
let sessionPayload: VaultPayload | null = null
let sessionOwnerId: string | null = null
let changeListener: (() => void) | null = null
let persistenceQueue: Promise<void> = Promise.resolve()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function requireOwnerId(userId: string): string {
  const normalized = String(userId || '').trim()
  if (!normalized || normalized.length > 256) throw new Error('The signed-in account identifier is invalid.')
  return normalized
}

function vaultStorageKey(userId: string): string {
  return `${VAULT_KEY_PREFIX}${bytesToBase64(encoder.encode(requireOwnerId(userId)))}`
}

function ownerBinding(userId: string): Uint8Array {
  return encoder.encode(`finance-planner-device-vault:v2:${requireOwnerId(userId)}`)
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function parseEnvelope(raw: string): AnyVaultEnvelope {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The encrypted vault is corrupted.')
  const envelope = parsed as Partial<AnyVaultEnvelope>
  const commonValid = envelope.format === 'finance-planner-encrypted-vault'
    && (envelope.version === 1 || envelope.version === 2)
    && envelope.kdf === 'PBKDF2-SHA-256'
    && typeof envelope.iterations === 'number'
    && envelope.iterations >= 100_000
    && typeof envelope.salt === 'string'
    && typeof envelope.iv === 'string'
    && typeof envelope.ciphertext === 'string'
    && typeof envelope.updatedAt === 'string'
  if (!commonValid || (envelope.version === 2 && (typeof envelope.ownerId !== 'string' || !envelope.ownerId))) {
    throw new Error('The encrypted vault has an invalid format.')
  }
  return envelope as AnyVaultEnvelope
}

export function normalizeVaultPayload(parsed: unknown): VaultPayload {
  if (isAppState(parsed)) return { state: parsed, secureData: {} }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The decrypted data is invalid.')
  const candidate = parsed as Partial<VaultPayload>
  if (!isAppState(candidate.state) || typeof candidate.secureData !== 'object' || candidate.secureData === null || Array.isArray(candidate.secureData)) {
    throw new Error('The decrypted data is invalid.')
  }
  return { state: structuredClone(candidate.state), secureData: structuredClone(candidate.secureData as Record<string, unknown>) }
}

async function encryptPayload(payload: VaultPayload, key: CryptoKey, salt: Uint8Array, iterations: number, ownerId: string): Promise<VaultEnvelope> {
  const normalizedOwnerId = requireOwnerId(ownerId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ownerBinding(normalizedOwnerId) }, key, plaintext)
  return {
    format: 'finance-planner-encrypted-vault',
    version: 2,
    ownerId: normalizedOwnerId,
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    updatedAt: new Date().toISOString(),
  }
}

async function decryptEnvelope(envelope: AnyVaultEnvelope, key: CryptoKey, ownerId: string): Promise<VaultPayload> {
  if (envelope.version === 2 && envelope.ownerId !== ownerId) throw new Error('This local vault belongs to a different account.')
  const algorithm: AesGcmParams = envelope.version === 2
    ? { name: 'AES-GCM', iv: base64ToBytes(envelope.iv), additionalData: ownerBinding(ownerId) }
    : { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) }
  const decrypted = await crypto.subtle.decrypt(algorithm, key, base64ToBytes(envelope.ciphertext))
  return normalizeVaultPayload(JSON.parse(decoder.decode(decrypted)))
}

function queueSessionPersistence(): Promise<void> {
  const key = sessionKey
  const ownerId = sessionOwnerId
  const payload = sessionPayload ? structuredClone(sessionPayload) : null
  if (!key || !ownerId || !payload) return Promise.resolve()

  const operation = persistenceQueue.then(async () => {
    const storageKey = vaultStorageKey(ownerId)
    const raw = localStorage.getItem(storageKey)
    if (!raw) throw new Error('The account-bound encrypted vault is missing.')
    const current = parseEnvelope(raw)
    if (current.version !== 2 || current.ownerId !== ownerId) throw new Error('This local vault is not correctly bound to this account.')
    const envelope = await encryptPayload(payload, key, base64ToBytes(current.salt), current.iterations, ownerId)
    localStorage.setItem(storageKey, JSON.stringify(envelope))
  })
  persistenceQueue = operation.catch(() => {})
  return operation
}

function notifyChange(): void {
  changeListener?.()
}

export function setVaultChangeListener(listener: (() => void) | null): void {
  changeListener = listener
}

export function hasEncryptedVault(userId: string): boolean {
  return localStorage.getItem(vaultStorageKey(userId)) !== null || localStorage.getItem(LEGACY_VAULT_KEY) !== null
}

export function isVaultUnlocked(): boolean {
  return sessionKey !== null && sessionPayload !== null && sessionOwnerId !== null
}

export function getUnlockedVaultPayload(): VaultPayload | null {
  return sessionPayload ? structuredClone(sessionPayload) : null
}

export async function createVault(password: string, state: AppState, userId: string): Promise<void> {
  const ownerId = requireOwnerId(userId)
  if (password.length < 12) throw new Error('The password must be at least 12 characters long.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const payload: VaultPayload = { state: structuredClone(state), secureData: {} }
  const envelope = await encryptPayload(payload, key, salt, PBKDF2_ITERATIONS, ownerId)
  localStorage.setItem(vaultStorageKey(ownerId), JSON.stringify(envelope))
  sessionKey = key
  sessionPayload = payload
  sessionOwnerId = ownerId
  persistenceQueue = Promise.resolve()
}

export async function unlockVault(password: string, userId: string): Promise<AppState> {
  const ownerId = requireOwnerId(userId)
  const accountKey = vaultStorageKey(ownerId)
  const accountRaw = localStorage.getItem(accountKey)
  const legacyRaw = accountRaw ? null : localStorage.getItem(LEGACY_VAULT_KEY)
  const raw = accountRaw ?? legacyRaw
  if (!raw) throw new Error('No encrypted vault has been set up for this account on this device yet.')
  const envelope = parseEnvelope(raw)
  const key = await deriveKey(password, base64ToBytes(envelope.salt), envelope.iterations)
  try {
    const payload = await decryptEnvelope(envelope, key, ownerId)
    sessionKey = key
    sessionPayload = payload
    sessionOwnerId = ownerId
    persistenceQueue = Promise.resolve()

    if (envelope.version === 1 || legacyRaw) {
      const migrated = await encryptPayload(payload, key, base64ToBytes(envelope.salt), envelope.iterations, ownerId)
      localStorage.setItem(accountKey, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_VAULT_KEY)
    }
    return structuredClone(payload.state)
  } catch (error) {
    if (error instanceof Error && /anderen Konto/.test(error.message)) throw error
    throw new Error('Incorrect password, or the encrypted data is corrupted.')
  }
}

export async function replaceUnlockedVaultPayload(payload: VaultPayload): Promise<void> {
  if (!sessionKey || !sessionPayload || !sessionOwnerId) throw new Error('The vault is not unlocked.')
  sessionPayload = normalizeVaultPayload(payload)
  await queueSessionPersistence()
}

export async function persistEncryptedState(state: AppState): Promise<void> {
  if (!sessionPayload) return
  sessionPayload = { ...sessionPayload, state: structuredClone(state) }
  await queueSessionPersistence()
  notifyChange()
}

export async function changeVaultPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!sessionPayload || !sessionKey || !sessionOwnerId) throw new Error('The vault is not unlocked.')
  if (newPassword.length < 12) throw new Error('The new password must be at least 12 characters long.')
  await persistenceQueue
  const storageKey = vaultStorageKey(sessionOwnerId)
  const raw = localStorage.getItem(storageKey)
  if (!raw) throw new Error('The encrypted vault is missing.')
  const current = parseEnvelope(raw)
  if (current.version !== 2 || current.ownerId !== sessionOwnerId) throw new Error('This local vault is not correctly bound to this account.')
  const verificationKey = await deriveKey(currentPassword, base64ToBytes(current.salt), current.iterations)
  try {
    await decryptEnvelope(current, verificationKey, sessionOwnerId)
  } catch {
    throw new Error('The current vault password is incorrect.')
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const newKey = await deriveKey(newPassword, salt, PBKDF2_ITERATIONS)
  const envelope = await encryptPayload(sessionPayload, newKey, salt, PBKDF2_ITERATIONS, sessionOwnerId)
  localStorage.setItem(storageKey, JSON.stringify(envelope))
  sessionKey = newKey
  persistenceQueue = Promise.resolve()
}

export function getSecureValue<T>(key: string, fallback: T): T {
  if (!sessionPayload) return fallback
  const value = sessionPayload.secureData[key]
  return value === undefined ? fallback : structuredClone(value) as T
}

export function setSecureValue<T>(key: string, value: T): void {
  if (!sessionPayload) return
  sessionPayload = {
    ...sessionPayload,
    secureData: { ...sessionPayload.secureData, [key]: structuredClone(value) },
  }
  void queueSessionPersistence()
    .then(notifyChange)
    .catch((error: unknown) => console.error('Encrypted secure data persistence failed', error))
}

export function removeSecureValue(key: string): void {
  if (!sessionPayload) return
  const secureData = { ...sessionPayload.secureData }
  delete secureData[key]
  sessionPayload = { ...sessionPayload, secureData }
  void queueSessionPersistence()
    .then(notifyChange)
    .catch((error: unknown) => console.error('Encrypted secure data persistence failed', error))
}

export function lockVault(): void {
  sessionKey = null
  sessionPayload = null
  sessionOwnerId = null
}

export function removeEncryptedVault(userId: string): void {
  const ownerId = requireOwnerId(userId)
  if (sessionOwnerId === ownerId) lockVault()
  localStorage.removeItem(vaultStorageKey(ownerId))
  localStorage.removeItem(LEGACY_VAULT_KEY)
}
