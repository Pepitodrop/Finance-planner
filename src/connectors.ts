import { assessBankImportQuality, suggestCategoryFromHistory, type BankImportQuality } from './bankIntelligence'
import type { Account, AppState, Transaction } from './types'

export type ConnectorProvider = 'gocardless' | 'finapi' | 'paypal'
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectorConnection { id: string; provider: ConnectorProvider; displayName: string; status: ConnectorStatus; lastSyncAt?: string; consentExpiresAt?: string; error?: string }
export interface ExternalAccount { externalId: string; name: string; type: Account['type']; balanceCents: number; currency: 'EUR' }
export interface ExternalTransaction { externalId: string; externalAccountId: string; description: string; category?: string; amountCents: number; currency: 'EUR'; bookingDate: string; pending?: boolean }
export interface SyncPayload { connection: ConnectorConnection; accounts: ExternalAccount[]; transactions: ExternalTransaction[] }
export interface SyncPreview { accountsToCreate: Account[]; transactionsToImport: Transaction[]; duplicateCount: number; pendingCount: number; quality: BankImportQuality }

function normalizeDescription(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unbenannte Transaktion' }
export function transactionFingerprint(transaction: Pick<Transaction, 'accountId' | 'date' | 'amountCents' | 'description'>): string { return [transaction.accountId, transaction.date, transaction.amountCents, normalizeDescription(transaction.description).toLocaleLowerCase('de-DE')].join('|') }

export function buildSyncPreview(state: AppState, payload: SyncPayload): SyncPreview {
  const accountMap = new Map<string, string>(); const accountsToCreate: Account[] = []
  for (const external of payload.accounts) {
    const deterministicId = `connector:${payload.connection.provider}:${external.externalId}`
    const existing = state.accounts.find((account) => account.id === deterministicId)
    accountMap.set(external.externalId, deterministicId)
    if (!existing) accountsToCreate.push({ id: deterministicId, name: external.name, type: external.type, balanceCents: external.balanceCents, currency: 'EUR' })
  }
  const known = new Set(state.transactions.map(transactionFingerprint)); const transactionsToImport: Transaction[] = []; let duplicateCount = 0; let pendingCount = 0; let smartCategorized = 0
  for (const external of payload.transactions) {
    if (external.currency !== 'EUR') continue
    if (external.pending) { pendingCount += 1; continue }
    const accountId = accountMap.get(external.externalAccountId); if (!accountId) continue
    const description = normalizeDescription(external.description)
    const learned = external.category?.trim() ? null : suggestCategoryFromHistory(description, state.transactions)
    const category = external.category?.trim() || learned?.category || 'Unkategorisiert'
    if (learned) smartCategorized += 1
    const transaction: Transaction = { id: `connector:${payload.connection.provider}:${external.externalId}`, accountId, description, category, type: external.amountCents >= 0 ? 'income' : 'expense', amountCents: Math.abs(external.amountCents), date: external.bookingDate, recurring: false }
    const fingerprint = transactionFingerprint(transaction)
    if (known.has(fingerprint) || state.transactions.some((item) => item.id === transaction.id)) { duplicateCount += 1; continue }
    known.add(fingerprint); transactionsToImport.push(transaction)
  }
  return { accountsToCreate, transactionsToImport, duplicateCount, pendingCount, quality: assessBankImportQuality(transactionsToImport, smartCategorized) }
}

export function applySyncPreview(state: AppState, preview: SyncPreview): AppState { return { ...state, accounts: [...state.accounts, ...preview.accountsToCreate], transactions: [...preview.transactionsToImport, ...state.transactions] } }

async function initializeDevelopmentSession(baseUrl: string): Promise<void> {
  if (!/^http:\/\/localhost(?::\d+)?$/.test(baseUrl)) return
  const response = await fetch(`${baseUrl}/api/session/local`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(`Lokale Backend-Sitzung konnte nicht gestartet werden (${response.status}).`)
}

export async function startConnector(provider: ConnectorProvider, backendBaseUrl: string): Promise<void> {
  const baseUrl = backendBaseUrl.replace(/\/$/, '')
  await initializeDevelopmentSession(baseUrl)
  const response = await fetch(`${baseUrl}/api/connectors/${provider}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ redirectUri: window.location.href, country: 'DE' }) })
  if (!response.ok) throw new Error(`Verbindung konnte nicht gestartet werden (${response.status}).`)
  const result = await response.json() as { redirectUrl?: string }
  if (!result.redirectUrl || !result.redirectUrl.startsWith('https://')) throw new Error('Der Connector lieferte keine sichere Weiterleitungsadresse.')
  window.location.assign(result.redirectUrl)
}

export async function synchronizeConnections(backendBaseUrl: string): Promise<SyncPayload[]> {
  const baseUrl = backendBaseUrl.replace(/\/$/, '')
  await initializeDevelopmentSession(baseUrl)
  const response = await fetch(`${baseUrl}/api/connectors/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
  if (!response.ok) throw new Error(`Synchronisierung fehlgeschlagen (${response.status}).`)
  const result = await response.json() as { connections?: SyncPayload[] }
  if (!Array.isArray(result.connections)) throw new Error('Der Sync-Dienst lieferte ein ungültiges Ergebnis.')
  return result.connections
}
