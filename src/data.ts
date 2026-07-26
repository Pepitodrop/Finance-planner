import type { AppState } from './types'

export const initialState: AppState = {
  accounts: [
    { id: 'account-checking', name: 'Girokonto', type: 'checking', balanceCents: 286450, currency: 'EUR' },
    { id: 'account-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 420000, currency: 'EUR' },
    { id: 'account-cash', name: 'Bargeld', type: 'cash', balanceCents: 8500, currency: 'EUR' },
  ],
  transactions: [
    { id: 't1', accountId: 'account-checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 185000, date: '2026-07-01', recurring: true },
    { id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
    { id: 't3', accountId: 'account-checking', description: 'Supermarkt', category: 'Lebensmittel', type: 'expense', amountCents: 6840, date: '2026-07-08' },
    { id: 't4', accountId: 'account-checking', description: 'Fitnessstudio', category: 'Verträge', type: 'expense', amountCents: 2990, date: '2026-07-10', recurring: true },
    { id: 't5', accountId: 'account-checking', description: 'Deutschlandticket', category: 'Mobilität', type: 'expense', amountCents: 5800, date: '2026-07-12', recurring: true },
    { id: 't6', accountId: 'account-checking', description: 'Werkstudentenjob', category: 'Einkommen', type: 'income', amountCents: 62000, date: '2026-07-15', recurring: true },
    { id: 't7', accountId: 'account-checking', description: 'Restaurant', category: 'Freizeit', type: 'expense', amountCents: 4200, date: '2026-07-18' },
  ],
  goals: [
    { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
    { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
  ],
}
