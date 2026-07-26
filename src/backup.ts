import type { AppState } from './types'
import { isAppState } from './validation'

interface BackupEnvelope {
  format: 'finance-planner-backup'
  version: 1
  exportedAt: string
  state: AppState
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportBackup(state: AppState): void {
  const envelope: BackupEnvelope = {
    format: 'finance-planner-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  }
  download(`finance-planner-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(envelope, null, 2), 'application/json')
}

function csvCell(value: string | number | boolean | undefined): string {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

export function exportTransactionsCsv(state: AppState): void {
  const header = ['Datum', 'Beschreibung', 'Kategorie', 'Typ', 'Betrag_EUR', 'Konto', 'Wiederkehrend']
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
  download(`finance-planner-transaktionen-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8')
}

export async function importBackup(file: File): Promise<AppState> {
  if (file.size > 10_000_000) throw new Error('Die Sicherungsdatei ist größer als 10 MB.')
  const parsed: unknown = JSON.parse(await file.text())
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Die Datei enthält kein gültiges Backup.')
  const envelope = parsed as Partial<BackupEnvelope>
  if (envelope.format !== 'finance-planner-backup' || envelope.version !== 1 || !isAppState(envelope.state)) {
    throw new Error('Das Backup-Format oder die enthaltenen Daten sind ungültig.')
  }
  return envelope.state
}
