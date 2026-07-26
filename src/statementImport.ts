import { transactionFingerprint } from './connectors'
import type { Account, AppState, Transaction } from './types'

export type StatementFormat = 'csv' | 'camt'

export interface StatementRow {
  externalId: string
  date: string
  description: string
  signedAmountCents: number
}

export interface ParsedStatement {
  format: StatementFormat
  accountName: string
  rows: StatementRow[]
  rejected: number
}

export interface StatementPreview {
  format: StatementFormat
  account: Account
  accountIsNew: boolean
  transactions: Transaction[]
  duplicates: number
  rejected: number
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const de = trimmed.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/)
  return de ? `${de[3]}-${de[2]}-${de[1]}` : null
}

function parseMoney(value: string): number | null {
  let normalized = value.trim().replace(/\s/g, '').replace(/€/g, '')
  if (!normalized) return null
  if (normalized.includes(',') && normalized.includes('.')) normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.') ? normalized.replace(/\./g, '').replace(',', '.') : normalized.replace(/,/g, '')
  else if (normalized.includes(',')) normalized = normalized.replace(',', '.')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) { cells.push(current.trim()); current = '' }
    else current += char
  }
  cells.push(current.trim())
  return cells
}

function key(value: string): string {
  return value.toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]/g, '')
}

function parseCsv(content: string, filename: string): ParsedStatement {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error('CSV enthält keine Buchungen.')
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const headers = splitCsvLine(lines[0], delimiter).map(key)
  const find = (...names: string[]) => headers.findIndex((header) => names.some((name) => header.includes(name)))
  const dateIndex = find('buchungstag', 'valutadatum', 'datum', 'date')
  const amountIndex = find('betrag', 'amount', 'umsatz')
  const descriptionIndex = find('verwendungszweck', 'buchungstext', 'beschreibung', 'empfänger', 'beguenstigter', 'name')
  const idIndex = find('transaktionsid', 'referenz', 'kundenreferenz', 'endtoendid')
  if (dateIndex < 0 || amountIndex < 0) throw new Error('CSV benötigt mindestens Datum- und Betrag-Spalten.')
  const rows: StatementRow[] = []
  let rejected = 0
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter)
    const date = normalizeDate(cells[dateIndex] ?? '')
    const amount = parseMoney(cells[amountIndex] ?? '')
    if (!date || amount === null || amount === 0) { rejected += 1; continue }
    const description = (cells[descriptionIndex] ?? 'Bankbuchung').trim() || 'Bankbuchung'
    rows.push({ externalId: (cells[idIndex] ?? `${date}:${amount}:${description}`).trim(), date, description, signedAmountCents: amount })
  }
  return { format: 'csv', accountName: filename.replace(/\.[^.]+$/, '') || 'CSV-Kontoauszug', rows, rejected }
}

function firstTag(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'))
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  }
  return ''
}

function parseCamt(content: string, filename: string): ParsedStatement {
  if (!/<(?:\w+:)?Document\b/i.test(content) || !/<(?:\w+:)?Ntry\b/i.test(content)) throw new Error('Die XML-Datei ist kein unterstützter CAMT-Kontoauszug.')
  const accountName = firstTag(content, ['Nm', 'IBAN']) || filename.replace(/\.[^.]+$/, '') || 'CAMT-Konto'
  const entryPattern = /<(?:\w+:)?Ntry\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Ntry>/gi
  const rows: StatementRow[] = []
  let rejected = 0
  for (const match of content.matchAll(entryPattern)) {
    const block = match[1]
    const amountMatch = block.match(/<(?:\w+:)?Amt\b[^>]*Ccy=["']EUR["'][^>]*>([^<]+)<\/(?:\w+:)?Amt>/i)
    const date = normalizeDate(firstTag(block, ['BookgDt', 'Dt', 'ValDt']))
    let amount = amountMatch ? parseMoney(amountMatch[1]) : null
    const creditDebit = firstTag(block, ['CdtDbtInd']).toUpperCase()
    if (amount !== null && creditDebit === 'DBIT') amount = -Math.abs(amount)
    if (amount !== null && creditDebit === 'CRDT') amount = Math.abs(amount)
    if (!date || amount === null || amount === 0) { rejected += 1; continue }
    const description = firstTag(block, ['Ustrd', 'AddtlNtryInf', 'RmtInf', 'Nm']) || 'Bankbuchung'
    const externalId = firstTag(block, ['AcctSvcrRef', 'NtryRef', 'EndToEndId']) || `${date}:${amount}:${description}`
    rows.push({ externalId, date, description, signedAmountCents: amount })
  }
  if (!rows.length && rejected === 0) throw new Error('CAMT enthält keine Buchungen.')
  return { format: 'camt', accountName, rows, rejected }
}

export function parseStatement(content: string, filename: string): ParsedStatement {
  return /\.csv$/i.test(filename) || !content.trimStart().startsWith('<') ? parseCsv(content, filename) : parseCamt(content, filename)
}

export function buildStatementPreview(state: AppState, parsed: ParsedStatement): StatementPreview {
  const accountId = `statement:${parsed.accountName.toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, '-')}`
  const existingAccount = state.accounts.find((account) => account.id === accountId)
  const account: Account = existingAccount ?? { id: accountId, name: parsed.accountName, type: 'checking', balanceCents: 0, currency: 'EUR' }
  const fingerprints = new Set(state.transactions.map(transactionFingerprint))
  const ids = new Set(state.transactions.map((transaction) => transaction.id))
  const transactions: Transaction[] = []
  let duplicates = 0
  for (const row of parsed.rows) {
    const transaction: Transaction = {
      id: `statement:${parsed.format}:${row.externalId}`,
      accountId,
      description: row.description.replace(/\s+/g, ' ').trim().slice(0, 160),
      category: 'Unkategorisiert',
      type: row.signedAmountCents >= 0 ? 'income' : 'expense',
      amountCents: Math.abs(row.signedAmountCents),
      date: row.date,
      recurring: false,
    }
    const fingerprint = transactionFingerprint(transaction)
    if (ids.has(transaction.id) || fingerprints.has(fingerprint)) { duplicates += 1; continue }
    ids.add(transaction.id); fingerprints.add(fingerprint); transactions.push(transaction)
  }
  return { format: parsed.format, account, accountIsNew: !existingAccount, transactions, duplicates, rejected: parsed.rejected }
}

export function applyStatementImport(state: AppState, preview: StatementPreview): AppState {
  const netChange = preview.transactions.reduce((sum, transaction) => sum + (transaction.type === 'income' ? transaction.amountCents : -transaction.amountCents), 0)
  const accounts = preview.accountIsNew
    ? [...state.accounts, { ...preview.account, balanceCents: preview.account.balanceCents + netChange }]
    : state.accounts.map((account) => account.id === preview.account.id ? { ...account, balanceCents: account.balanceCents + netChange } : account)
  return { ...state, accounts, transactions: [...preview.transactions, ...state.transactions] }
}
