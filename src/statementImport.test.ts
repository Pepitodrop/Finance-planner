import { describe, expect, it } from 'vitest'
import { applyStatementImport, buildStatementPreview, parseStatement } from './statementImport'
import type { AppState } from './types'

const empty: AppState = { accounts: [], transactions: [], goals: [] }

describe('statement imports', () => {
  it('parses German semicolon CSV and applies signed balances', () => {
    const parsed = parseStatement('Buchungstag;Verwendungszweck;Betrag;Referenz\n25.07.2026;Gehalt;2.500,00;salary\n26.07.2026;Supermarkt;-12,99;shop', 'giro.csv')
    const preview = buildStatementPreview(empty, parsed)
    expect(preview.transactions).toHaveLength(2)
    expect(preview.transactions[0].type).toBe('income')
    expect(preview.transactions[1].amountCents).toBe(1299)
    const imported = applyStatementImport(empty, preview)
    expect(imported.accounts[0].balanceCents).toBe(248701)
  })

  it('parses CAMT debit and credit entries', () => {
    const xml = `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>DE001234</IBAN></Id></Acct><Ntry><Amt Ccy="EUR">10.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-07-20</Dt></BookgDt><AcctSvcrRef>a</AcctSvcrRef><AddtlNtryInf>Café</AddtlNtryInf></Ntry><Ntry><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-07-21</Dt></BookgDt><AcctSvcrRef>b</AcctSvcrRef><AddtlNtryInf>Erstattung</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`
    const preview = buildStatementPreview(empty, parseStatement(xml, 'statement.xml'))
    expect(preview.transactions.map((item) => item.type)).toEqual(['expense', 'income'])
    expect(applyStatementImport(empty, preview).accounts[0].balanceCents).toBe(8950)
  })

  it('skips duplicate statement transactions', () => {
    const parsed = parseStatement('Datum;Beschreibung;Betrag;Referenz\n25.07.2026;Gehalt;100,00;fixed', 'giro.csv')
    const first = buildStatementPreview(empty, parsed)
    const second = buildStatementPreview(applyStatementImport(empty, first), parsed)
    expect(second.transactions).toHaveLength(0)
    expect(second.duplicates).toBe(1)
  })
})
