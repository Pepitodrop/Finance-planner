export type InstitutionProvider = 'gocardless' | 'finapi' | 'paypal' | 'manual'
export type InstitutionKind = 'bank' | 'wallet' | 'broker' | 'card' | 'manual'

export interface Institution {
  id: string
  name: string
  bic?: string
  blz?: string
  provider: InstitutionProvider
  popular?: boolean
  kind: InstitutionKind
  description?: string
}

export const commonInstitutions: Institution[] = [
  { id: 'sparkasse', name: 'Sparkasse', provider: 'gocardless', popular: true, kind: 'bank', description: 'Sparkassen und regionale Institute über PSD2.' },
  { id: 'volksbank', name: 'Volksbank / Raiffeisenbank', provider: 'gocardless', popular: true, kind: 'bank', description: 'Volksbanken und Raiffeisenbanken über PSD2.' },
  { id: 'ing', name: 'ING', bic: 'INGDDEFFXXX', blz: '50010517', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'dkb', name: 'DKB', bic: 'BYLADEM1001', blz: '12030000', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'comdirect', name: 'Comdirect', bic: 'COBADEHDXXX', blz: '20041111', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'deutsche-bank', name: 'Deutsche Bank', bic: 'DEUTDEFFXXX', blz: '10070000', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'postbank', name: 'Postbank', bic: 'PBNKDEFFXXX', blz: '10010010', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'commerzbank', name: 'Commerzbank', bic: 'COBADEFFXXX', blz: '10040000', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'n26', name: 'N26', bic: 'NTSBDEB1XXX', blz: '10011001', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'hypovereinsbank', name: 'UniCredit Bank – HypoVereinsbank', bic: 'HYVEDEMMXXX', blz: '70020270', provider: 'gocardless', popular: true, kind: 'bank' },
  { id: 'consorsbank', name: 'Consorsbank', bic: 'CSDBDE71XXX', blz: '76030080', provider: 'gocardless', kind: 'bank' },
  { id: 'santander', name: 'Santander', bic: 'SCFBDE33XXX', blz: '31010833', provider: 'gocardless', kind: 'bank' },
  { id: 'paypal', name: 'PayPal', provider: 'paypal', popular: true, kind: 'wallet', description: 'Weiterleitung zu PayPal und sichere Rückkehr zu Finance Planner.' },
  { id: 'trade-republic', name: 'Trade Republic', provider: 'finapi', popular: true, kind: 'broker', description: 'Brokerage-Verbindung, soweit der Anbieter Daten bereitstellt.' },
  { id: 'credit-card-manual', name: 'Kreditkarte manuell hinzufügen', provider: 'manual', kind: 'card', description: 'Saldo, Limit und Fälligkeit selbst pflegen.' },
  { id: 'manual', name: 'Virtuelles / manuelles Konto', provider: 'manual', kind: 'manual', description: 'Ein Konto ohne externe Verbindung anlegen.' },
]

function searchable(institution: Institution): string {
  return [institution.name, institution.bic, institution.blz, institution.description]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('de-DE')
}

export function searchInstitutions(query: string, institutions = commonInstitutions): Institution[] {
  const normalized = query.trim().toLocaleLowerCase('de-DE')
  return [...institutions]
    .filter((institution) => !normalized || searchable(institution).includes(normalized))
    .sort((left, right) => Number(Boolean(right.popular)) - Number(Boolean(left.popular)) || left.name.localeCompare(right.name, 'de-DE'))
}

export function groupInstitutions(institutions: Institution[]): Record<InstitutionKind, Institution[]> {
  return institutions.reduce<Record<InstitutionKind, Institution[]>>((groups, institution) => {
    groups[institution.kind].push(institution)
    return groups
  }, { bank: [], wallet: [], broker: [], card: [], manual: [] })
}
