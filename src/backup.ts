import type { AppState } from './types'
import { isAppState } from './validation'

const BACKUP_ITERATIONS = 310_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface EncryptedBackupEnvelope {
  format: 'finance-planner-encrypted-backup'
  version: 1
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
  exportedAt: string
}

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

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function exportBackup(state: AppState, password: string): Promise<void> {
  if (password.length < 12) throw new Error('The backup password must be at least 12 characters long.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, BACKUP_ITERATIONS)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(state)))
  const envelope: EncryptedBackupEnvelope = {
    format: 'finance-planner-encrypted-backup',
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: BACKUP_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    exportedAt: new Date().toISOString(),
  }
  download(`finance-planner-backup-${new Date().toISOString().slice(0, 10)}.fpbackup`, JSON.stringify(envelope), 'application/octet-stream')
}

function csvCell(value: string | number | boolean | undefined): string {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

export function exportTransactionsCsv(state: AppState): void {
  const header = ['Date', 'Description', 'Category', 'Type', 'Amount_EUR', 'Account', 'Recurring']
  const accountNames = new Map(state.accounts.map((account) => [account.id, account.name]))
  const rows = state.transactions.map((transaction) => [
    transaction.date,
    transaction.description,
    transaction.category,
    transaction.type,
    (transaction.amountCents / 100).toFixed(2),
    accountNames.get(transaction.accountId) ?? transaction.accountId,
    Boolean(transaction.recurring),
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')
  download(`finance-planner-transactions-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8')
}

export async function importBackup(file: File, password: string): Promise<AppState> {
  if (file.size > 10_000_000) throw new Error('The backup file is larger than 10 MB.')
  if (!password) throw new Error('Enter the backup password.')
  const parsed: unknown = JSON.parse(await file.text())
  if (typeof parsed !== 'object' || parsed === null) throw new Error("This file isn't a valid encrypted backup.")
  const envelope = parsed as Partial<EncryptedBackupEnvelope>
  if (
    envelope.format !== 'finance-planner-encrypted-backup'
    || envelope.version !== 1
    || envelope.kdf !== 'PBKDF2-SHA-256'
    || typeof envelope.iterations !== 'number'
    || envelope.iterations < 100_000
    || typeof envelope.salt !== 'string'
    || typeof envelope.iv !== 'string'
    || typeof envelope.ciphertext !== 'string'
  ) throw new Error('The backup format is invalid.')

  try {
    const key = await deriveKey(password, base64ToBytes(envelope.salt), envelope.iterations)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
      key,
      base64ToBytes(envelope.ciphertext),
    )
    const state: unknown = JSON.parse(decoder.decode(decrypted))
    if (!isAppState(state)) throw new Error('The decrypted data is invalid.')
    return state
  } catch {
    throw new Error('Wrong password, or the backup file is corrupted.')
  }
}
