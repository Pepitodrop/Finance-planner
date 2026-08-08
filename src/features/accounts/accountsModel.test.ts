import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../types'
import { accountLiabilityCents, classifyDueDate, filterAccounts, summarizeAccounts, transactionsForAccount } from './accountsModel'

const assets: Account[] = [
  { id:'checking',name:'Checking',type:'checking',balanceCents:800_000,currency:'EUR' },
  { id:'large',name:'Large',type:'investment',balanceCents:9_007_199_254_740,currency:'EUR' },
]

describe('accounts model', () => {
  it('reconciles integer-cent assets, liabilities and net worth without double counting', () => {
    const card: Account = { id:'card',name:'Card',type:'credit-card',balanceCents:-999_00,currency:'EUR',creditCard:{amountOwedCents:248_000,availableCreditCents:502_000} }
    expect(accountLiabilityCents(card)).toBe(248_000)
    expect(summarizeAccounts([...assets,card])).toEqual({assetsCents:9_007_200_054_740,liabilitiesCents:248_000,netWorthCents:9_007_199_806_740})
  })
  it('uses the negative credit-card balance only as a fallback', () => {
    expect(accountLiabilityCents({id:'card',name:'Card',type:'credit-card',balanceCents:-75_500,currency:'EUR'})).toBe(75_500)
  })
  it('supports empty summaries and genuine type filters', () => {
    expect(summarizeAccounts([])).toEqual({assetsCents:0,liabilitiesCents:0,netWorthCents:0})
    expect(filterAccounts(assets,'investment').map(({id})=>id)).toEqual(['large'])
  })
  it('sorts account transactions deterministically', () => {
    const rows: Transaction[]=[{id:'a',accountId:'checking',description:'A',category:'A',type:'expense',amountCents:1,date:'2026-01-01'},{id:'b',accountId:'other',description:'B',category:'B',type:'expense',amountCents:1,date:'2026-02-01'},{id:'c',accountId:'checking',description:'C',category:'C',type:'income',amountCents:1,date:'2026-03-01'}]
    expect(transactionsForAccount(rows,'checking').map(({id})=>id)).toEqual(['c','a'])
  })
  it('classifies due dates from an explicit reference date', () => {
    const today = new Date(2026,7,4)
    expect(classifyDueDate(undefined,today)).toBe('none'); expect(classifyDueDate('bad',today)).toBe('invalid'); expect(classifyDueDate('2026-08-03',today)).toBe('overdue'); expect(classifyDueDate('2026-08-04',today)).toBe('due-today'); expect(classifyDueDate('2026-08-18',today)).toBe('future')
  })
})
