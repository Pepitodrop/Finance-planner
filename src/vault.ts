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

let sessionKey: CryptoKey | null = null

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

async function encryptState(state: AppState, key: CryptoKey, salt: Uint8Array, iterations: number): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(state))
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

export function hasEncryptedVault(): boolean {
  return localStorage.getItem(VAULT_KEY) !== null
}

export function isVaultUnlocked(): boolean {
  return sessionKey !== null
}

export async function createVault(password: string, state: AppState): Promise<void> {
  if (password.length < 12) throw new Error('Das Passwort muss mindestens 12 Zeichen lang sein.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const envelope = await encryptState(state, key, salt, PBKDF2_ITERATIONS)
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope))
  sessionKey = key
}

export async function unlockVault(password: string): Promise<AppState> {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('Kein verschlüsselter Datenspeicher gefunden.')
  const envelope = parseEnvelope(raw)
  const salt = base64ToBytes(envelope.salt)
  const iv = base64ToBytes(envelope.iv)
  const key = await deriveKey(password, salt, envelope.iterations)
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(envelope.ciphertext),
    )
    const parsed: unknown = JSON.parse(decoder.decode(decrypted))
    if (!isAppState(parsed)) throw new Error('Die entschlüsselten Daten sind ungültig.')
    sessionKey = key
    return parsed
  } catch {
    throw new Error('Passwort falsch oder verschlüsselte Daten beschädigt.')
  }
}

export async function persistEncryptedState(state: AppState): Promise<void> {
  if (!sessionKey) return
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('Der verschlüsselte Datenspeicher fehlt.')
  const current = parseEnvelope(raw)
  const salt = base64ToBytes(current.salt)
  const envelope = await encryptState(state, sessionKey, salt, current.iterations)
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope))
}

export function lockVault(): void {
  sessionKey = null
}

export function removeEncryptedVault(): void {
  sessionKey = null
  localStorage.removeItem(VAULT_KEY)
}
