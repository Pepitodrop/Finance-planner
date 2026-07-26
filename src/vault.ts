import type { AppState } from './types'
import { isAppState } from './validation'

const VAULT_KEY = 'finance-planner-encrypted-vault-v1'
const PBKDF2_ITERATIONS = 310_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface VaultEnvelope {
  format: 'finance-planner-encrypted-vault'
  version: 1
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
  updatedAt: string
}

interface VaultPayload {
  state: AppState
  secureData: Record<string, unknown>
}

let sessionKey: CryptoKey | null = null
let sessionPayload: VaultPayload | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
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

function parseEnvelope(raw: string): VaultEnvelope {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Der verschlüsselte Datenspeicher ist beschädigt.')
  const envelope = parsed as Partial<VaultEnvelope>
  if (
    envelope.format !== 'finance-planner-encrypted-vault'
    || envelope.version !== 1
    || envelope.kdf !== 'PBKDF2-SHA-256'
    || typeof envelope.iterations !== 'number'
    || envelope.iterations < 100_000
    || typeof envelope.salt !== 'string'
    || typeof envelope.iv !== 'string'
    || typeof envelope.ciphertext !== 'string'
  ) throw new Error('Der verschlüsselte Datenspeicher hat ein ungültiges Format.')
  return envelope as VaultEnvelope
}

function normalizePayload(parsed: unknown): VaultPayload {
  if (isAppState(parsed)) return { state: parsed, secureData: {} }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Die entschlüsselten Daten sind ungültig.')
  const candidate = parsed as Partial<VaultPayload>
  if (!isAppState(candidate.state) || typeof candidate.secureData !== 'object' || candidate.secureData === null || Array.isArray(candidate.secureData)) {
    throw new Error('Die entschlüsselten Daten sind ungültig.')
  }
  return { state: candidate.state, secureData: candidate.secureData as Record<string, unknown> }
}

async function encryptPayload(payload: VaultPayload, key: CryptoKey, salt: Uint8Array, iterations: number): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    format: 'finance-planner-encrypted-vault',
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    updatedAt: new Date().toISOString(),
  }
}

async function persistSessionPayload(): Promise<void> {
  if (!sessionKey || !sessionPayload) return
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('Der verschlüsselte Datenspeicher fehlt.')
  const current = parseEnvelope(raw)
  const envelope = await encryptPayload(sessionPayload, sessionKey, base64ToBytes(current.salt), current.iterations)
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope))
}

export function hasEncryptedVault(): boolean {
  return localStorage.getItem(VAULT_KEY) !== null
}

export function isVaultUnlocked(): boolean {
  return sessionKey !== null && sessionPayload !== null
}

export async function createVault(password: string, state: AppState): Promise<void> {
  if (password.length < 12) throw new Error('Das Passwort muss mindestens 12 Zeichen lang sein.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const payload: VaultPayload = { state, secureData: {} }
  const envelope = await encryptPayload(payload, key, salt, PBKDF2_ITERATIONS)
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope))
  sessionKey = key
  sessionPayload = payload
}

export async function unlockVault(password: string): Promise<AppState> {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('Kein verschlüsselter Datenspeicher gefunden.')
  const envelope = parseEnvelope(raw)
  const salt = base64ToBytes(envelope.salt)
  const iv = base64ToBytes(envelope.iv)
  const key = await deriveKey(password, salt, envelope.iterations)
  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.ciphertext))
    const payload = normalizePayload(JSON.parse(decoder.decode(decrypted)))
    sessionKey = key
    sessionPayload = payload
    return payload.state
  } catch {
    throw new Error('Passwort falsch oder verschlüsselte Daten beschädigt.')
  }
}

export async function persistEncryptedState(state: AppState): Promise<void> {
  if (!sessionPayload) return
  sessionPayload = { ...sessionPayload, state: structuredClone(state) }
  await persistSessionPayload()
}

export async function changeVaultPassword(newPassword: string): Promise<void> {
  if (!sessionPayload || !sessionKey) throw new Error('Der Vault ist nicht entsperrt.')
  if (newPassword.length < 12) throw new Error('Das neue Passwort muss mindestens 12 Zeichen lang sein.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const newKey = await deriveKey(newPassword, salt, PBKDF2_ITERATIONS)
  const envelope = await encryptPayload(sessionPayload, newKey, salt, PBKDF2_ITERATIONS)
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope))
  sessionKey = newKey
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
  void persistSessionPayload().catch((error: unknown) => console.error('Encrypted secure data persistence failed', error))
}

export function removeSecureValue(key: string): void {
  if (!sessionPayload) return
  const secureData = { ...sessionPayload.secureData }
  delete secureData[key]
  sessionPayload = { ...sessionPayload, secureData }
  void persistSessionPayload().catch((error: unknown) => console.error('Encrypted secure data persistence failed', error))
}

export function lockVault(): void {
  sessionKey = null
  sessionPayload = null
}

export function removeEncryptedVault(): void {
  sessionKey = null
  sessionPayload = null
  localStorage.removeItem(VAULT_KEY)
}
