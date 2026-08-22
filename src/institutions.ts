// 'ais' is a Finance Planner-internal logical group, not a real provider id --
// a bank listed here has no fixed aggregator. Which concrete AIS provider
// (Enable Banking, GoCardless) actually backs a connection attempt is
// resolved at runtime against each provider's live directory (see
// connectionsModel.ts's resolveAisProvider()/AIS_PROVIDER_PREFERENCE), never
// guessed from this static catalogue. ING is not GoCardless; ING is a bank
// that Enable Banking or GoCardless might separately be able to reach.
export type InstitutionProvider = 'ais' | 'finapi' | 'paypal' | 'manual'
export type InstitutionKind = 'bank' | 'wallet' | 'broker' | 'card' | 'manual'

export interface Institution {
  id: string
  name: string
  bic?: string
  blz?: string
  provider: InstitutionProvider
  popular?: boolean
  kind: InstitutionKind
  aliases?: string[]
  accountTypeRequired?: boolean
  // Only used to compute the *initial* (blank-query) view of a live AIS
  // provider directory once this tile is chosen -- never sent to a provider
  // as a search query, and never used to validate/guess the institution id
  // that actually gets submitted (see connectionsModel.ts's
  // familyFilteredInstitutions()). A tile with several real ASPSPs behind it
  // (a cooperative banking group like Sparkasse or Volksbank/Raiffeisenbank)
  // lists the terms that identify that family in a live directory entry's
  // name or `group.name` (e.g. Enable Banking's ASPSPGroup.name); a tile for
  // one concrete bank lists that bank's own real, curated name so the
  // directory view opens already narrowed to it instead of showing the
  // entire country's bank list.
  directoryTerms?: string[]
}

export const commonInstitutions: Institution[] = [
  { id: 'sparkasse', name: 'Sparkasse', provider: 'ais', popular: true, kind: 'bank', aliases: ['Kreissparkasse', 'Stadtsparkasse'], directoryTerms: ['sparkasse'] },
  { id: 'volksbank', name: 'Volksbank / Raiffeisenbank', provider: 'ais', popular: true, kind: 'bank', aliases: ['VR Bank', 'Raiffeisen'], directoryTerms: ['volksbank', 'raiffeisenbank', 'vr bank'] },
  // directoryTerms deliberately excludes a bare "ing" term: German city names
  // ending "-ingen" (Reutlingen, Esslingen, Tübingen, ...) are common in
  // Sparkasse/Volksbank branch names, so a 3-letter substring would pull in
  // many unrelated banks -- the same noisy-list failure mode this field
  // exists to avoid. familyFilteredInstitutions() already falls back to the
  // full directory if "ing-diba" matches nothing, so nothing is hidden.
  { id: 'ing', name: 'ING', bic: 'INGDDEFFXXX', blz: '50010517', provider: 'ais', popular: true, kind: 'bank', aliases: ['ING-DiBa'], directoryTerms: ['ing-diba'] },
  { id: 'dkb', name: 'DKB', bic: 'BYLADEM1001', blz: '12030000', provider: 'ais', popular: true, kind: 'bank', aliases: ['Deutsche Kreditbank'], directoryTerms: ['dkb', 'deutsche kreditbank'] },
  { id: 'comdirect', name: 'Comdirect', bic: 'COBADEHDXXX', blz: '20041111', provider: 'ais', popular: true, kind: 'bank', directoryTerms: ['comdirect'] },
  { id: 'deutsche-bank', name: 'Deutsche Bank', bic: 'DEUTDEFFXXX', provider: 'ais', popular: true, kind: 'bank', directoryTerms: ['deutsche bank'] },
  { id: 'postbank', name: 'Postbank', bic: 'PBNKDEFFXXX', provider: 'ais', popular: true, kind: 'bank', directoryTerms: ['postbank'] },
  { id: 'commerzbank', name: 'Commerzbank', bic: 'COBADEFFXXX', provider: 'ais', popular: true, kind: 'bank', directoryTerms: ['commerzbank'] },
  { id: 'n26', name: 'N26', bic: 'NTSBDEB1XXX', provider: 'ais', popular: true, kind: 'bank', directoryTerms: ['n26'] },
  { id: 'hypovereinsbank', name: 'UniCredit Bank – HypoVereinsbank', bic: 'HYVEDEMMXXX', provider: 'ais', popular: true, kind: 'bank', aliases: ['HVB', 'Hypovereinsbank', 'UniCredit'], directoryTerms: ['hypovereinsbank', 'unicredit bank'] },
  { id: 'paypal', name: 'PayPal', provider: 'paypal', popular: true, kind: 'wallet', aliases: ['Wallet'] },
  { id: 'trade-republic', name: 'Trade Republic', provider: 'finapi', popular: true, kind: 'broker', accountTypeRequired: true, aliases: ['Depot', 'Broker'] },
  { id: 'credit-card', name: 'Kreditkarte manuell', provider: 'manual', kind: 'card', accountTypeRequired: true, aliases: ['Visa', 'Mastercard', 'Amex', 'American Express'] },
  { id: 'manual', name: 'Virtuelles / manuelles Konto', provider: 'manual', kind: 'manual', accountTypeRequired: true, aliases: ['Bargeld', 'Offline', 'Virtuell'] },
]

// Exported so connectionsModel.ts can apply the identical normalization to
// live provider-directory entries (name/BIC/group name) -- one definition of
// "forgiving" search for the whole institution-selection surface, not two
// that could quietly drift apart.
export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('de-DE')
}

function searchable(institution: Institution): string {
  return normalize([institution.name, institution.bic, institution.blz, ...(institution.aliases || [])].filter(Boolean).join(' '))
}

export interface InstitutionSearchOptions {
  kinds?: InstitutionKind[]
  providers?: InstitutionProvider[]
  popularOnly?: boolean
}

export function searchInstitutions(
  query: string,
  institutions = commonInstitutions,
  options: InstitutionSearchOptions = {},
): Institution[] {
  const normalized = normalize(query)
  const terms = normalized.split(' ').filter(Boolean)
  const kinds = options.kinds ? new Set(options.kinds) : null
  const providers = options.providers ? new Set(options.providers) : null

  return [...institutions]
    .filter((institution) => !kinds || kinds.has(institution.kind))
    .filter((institution) => !providers || providers.has(institution.provider))
    .filter((institution) => !options.popularOnly || institution.popular)
    .filter((institution) => {
      if (!terms.length) return true
      const haystack = searchable(institution)
      return terms.every((term) => haystack.includes(term))
    })
    .sort((left, right) => Number(Boolean(right.popular)) - Number(Boolean(left.popular)) || left.name.localeCompare(right.name, 'de-DE'))
}

export function institutionById(id: string, institutions = commonInstitutions): Institution | undefined {
  return institutions.find((institution) => institution.id === id)
}
