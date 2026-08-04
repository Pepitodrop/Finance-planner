export interface Institution {
  id: string
  name: string
  bic?: string
  blz?: string
  provider: 'gocardless' | 'finapi' | 'paypal' | 'manual'
  popular?: boolean
  kind: 'bank' | 'wallet' | 'broker' | 'card' | 'manual'
}

export const commonInstitutions: Institution[] = [
  { id: 'sparkasse', name: 'Sparkasse', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'volksbank', name: 'Volksbank / Raiffeisenbank', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'ing', name: 'ING', bic: 'INGDDEFFXXX', blz: '50010517', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'dkb', name: 'DKB', bic: 'BYLADEM1001', blz: '12030000', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'comdirect', name: 'Comdirect', bic: 'COBADEHDXXX', blz: '20041111', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'deutsche-bank', name: 'Deutsche Bank', bic: 'DEUTDEFFXXX', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'postbank', name: 'Postbank', bic: 'PBNKDEFFXXX', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'commerzbank', name: 'Commerzbank', bic: 'COBADEFFXXX', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'n26', name: 'N26', bic: 'NTSBDEB1XXX', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'hypovereinsbank', name: 'UniCredit Bank – HypoVereinsbank', bic: 'HYVEDEMMXXX', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'paypal', name: 'PayPal', provider: 'paypal', popular: true, kind: 'wallet' },
  { id: 'trade-republic', name: 'Trade Republic', provider: 'finapi', popular: true, kind: 'broker' },
  { id: 'manual', name: 'Virtuelles / manuelles Konto', provider: 'manual', kind: 'manual' },
]

function searchable(institution: Institution): string {
  return [institution.name, institution.bic, institution.blz].filter(Boolean).join(' ').toLocaleLowerCase('de-DE')
}

export function searchInstitutions(query: string, institutions = commonInstitutions): Institution[] {
  const normalized = query.trim().toLocaleLowerCase('de-DE')
  return [...institutions]
    .filter((institution) => !normalized || searchable(institution).includes(normalized))
    .sort((left, right) => Number(Boolean(right.popular)) - Number(Boolean(left.popular)) || left.name.localeCompare(right.name, 'de-DE'))
}
