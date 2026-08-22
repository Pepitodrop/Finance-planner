import type { ConnectorAccountType, ConnectorConnection, ConnectorProvider, ProviderDescriptor, ProviderInstitution } from '../../connectors'
import { consentDaysRemaining } from '../../connectors'
import { commonInstitutions, institutionById, normalize, searchInstitutions, type Institution, type InstitutionKind } from '../../institutions'

export type InstitutionCategory = 'popular' | InstitutionKind
export type SetupStep = 1 | 2 | 3

export const CATEGORY_OPTIONS: Array<{ id: InstitutionCategory; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'bank', label: 'Banks' },
  { id: 'wallet', label: 'PayPal' },
  { id: 'broker', label: 'Investments' },
  { id: 'card', label: 'Cards' },
  { id: 'manual', label: 'Manual' },
]

export const ACCOUNT_TYPE_OPTIONS: Array<{ id: ConnectorAccountType; label: string; description: string }> = [
  { id: 'checking', label: 'Checking account', description: 'Daily transactions and cash access' },
  { id: 'savings', label: 'Savings account', description: 'Save for goals and emergencies' },
  { id: 'credit-card', label: 'Credit card', description: 'Track spending and manage payments' },
  { id: 'investment', label: 'Investment account', description: 'Build wealth over time' },
]

export function filterInstitutions(searchTerm: string, category: InstitutionCategory, institutions: Institution[] = commonInstitutions): Institution[] {
  return searchInstitutions(searchTerm, institutions, category === 'popular' ? { popularOnly: true } : { kinds: [category] })
}

export function defaultAccountTypeForInstitution(institution: Institution): ConnectorAccountType {
  if (institution.kind === 'card') return 'credit-card'
  if (institution.kind === 'broker') return 'investment'
  return 'checking'
}

export function nextSetupStepAfterInstitution(institution: Institution): SetupStep {
  return institution.accountTypeRequired ? 2 : 3
}

export function previousSetupStepFromConfirmation(institution: Institution | undefined): SetupStep {
  return institution?.accountTypeRequired ? 2 : 1
}

export type ConnectionAttentionReason = 'provider-error' | 'consent-expired' | 'consent-expiring-soon' | null

export function connectionAttentionReason(connection: ConnectorConnection, now = Date.now()): ConnectionAttentionReason {
  if (connection.status === 'error') return 'provider-error'
  const days = consentDaysRemaining(connection, now)
  if (days !== null && days < 0) return 'consent-expired'
  if (days !== null && days <= 7) return 'consent-expiring-soon'
  return null
}

export function connectionNeedsAttention(connection: ConnectorConnection, now = Date.now()): boolean {
  return connectionAttentionReason(connection, now) !== null
}

export const ATTENTION_REASON_COPY: Record<Exclude<ConnectionAttentionReason, null>, { title: string; description: string }> = {
  'provider-error': { title: 'Provider error', description: 'The provider reported a problem while updating this connection.' },
  'consent-expired': { title: 'Consent expired', description: 'This can happen when consent has expired or the data provider returned an error.' },
  'consent-expiring-soon': { title: 'Consent expiring soon', description: 'Reauthorize soon to avoid an interruption in updates.' },
}

export interface AccountSelectionSummary { selectedCount: number; totalCount: number }
export function summarizeAccountSelection(discoveredAccountIds: string[], selectedAccountIds: ReadonlySet<string>): AccountSelectionSummary {
  const total = new Set(discoveredAccountIds)
  const selectedCount = discoveredAccountIds.filter((id) => selectedAccountIds.has(id)).length
  return { selectedCount, totalCount: total.size }
}

export const MAX_STATEMENT_FILE_BYTES = 5 * 1024 * 1024

export function parseEuroToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

export interface ManualAccountInput {
  name: string
  accountType: ConnectorAccountType
  balanceInput: string
  creditLimitInput: string
}

export interface ManualAccountValidationResult {
  error?: string
  balanceCents: number
  creditLimitCents?: number
}

export function validateManualAccount({ name, accountType, balanceInput, creditLimitInput }: ManualAccountInput): ManualAccountValidationResult {
  if (!name.trim()) return { error: 'Enter an account name.', balanceCents: 0 }

  const balanceCents = parseEuroToCents(balanceInput)
  if (balanceCents === null || !Number.isFinite(balanceCents)) return { error: 'Enter a valid current balance.', balanceCents: 0 }

  if (accountType !== 'credit-card') return { balanceCents }

  if (!creditLimitInput.trim()) return { balanceCents }
  const creditLimitCents = parseEuroToCents(creditLimitInput)
  if (creditLimitCents === null || !Number.isFinite(creditLimitCents)) return { error: 'Enter a valid credit limit, or leave it empty.', balanceCents: 0 }
  if (creditLimitCents < 0) return { error: 'Credit limit cannot be negative.', balanceCents: 0 }
  return { balanceCents, creditLimitCents }
}

// Explicit lifecycle for the one GET /api/connectors call ConnectionsPage
// makes per mount. There is deliberately no "unknown, assume available"
// state: until a successful response names a provider as available and
// configured, every external provider fails closed.
export type ProviderStatus =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; providers: ProviderDescriptor[] }

export interface ProviderAvailability { unavailable: boolean; reason?: string }

// Enable Banking first, GoCardless second -- resolved transparently before
// any bank-specific network call, never mid-attempt. This is the single
// source of truth for "which concrete AIS provider backs an 'ais' bank right
// now"; nothing else hard-codes this order.
export const AIS_PROVIDER_PREFERENCE: ConnectorProvider[] = ['enablebanking', 'gocardless']

// Picks the first AIS provider that is both available and configured, in
// preference order. Returns null when neither is usable (including while
// status is still loading or failed) -- callers fail closed on null exactly
// like institutionAvailability() already does for every other provider.
export function resolveAisProvider(providerStatus: ProviderStatus): ConnectorProvider | null {
  if (providerStatus.status !== 'ready') return null
  for (const id of AIS_PROVIDER_PREFERENCE) {
    const descriptor = providerStatus.providers.find((provider) => provider.id === id)
    if (descriptor?.available && descriptor.configured) return id
  }
  return null
}

// Backend-authoritative: an institution is only ever shown as connectable
// once its backing provider reports both available and configured. finAPI
// (an explicit unavailable placeholder), an unconfigured GoCardless/PayPal,
// and a provider descriptor missing from a successful response must never
// masquerade as a normal, clickable institution -- and neither may a
// provider whose status simply hasn't loaded yet, or failed to load. A bank
// with the 'ais' logical provider is available as soon as *any* preferred
// AIS provider resolves -- which concrete one is a runtime detail resolved
// separately (see resolveAisProvider()), not baked into this result.
export function institutionAvailability(institution: Pick<Institution, 'provider'>, providerStatus: ProviderStatus): ProviderAvailability {
  if (institution.provider === 'manual') return { unavailable: false }
  if (providerStatus.status === 'loading') return { unavailable: true, reason: 'Checking availability…' }
  if (providerStatus.status === 'error') return { unavailable: true, reason: 'Availability could not be checked.' }
  if (institution.provider === 'ais') {
    if (resolveAisProvider(providerStatus)) return { unavailable: false }
    // Neither preferred provider resolved -- surface whichever one carries a
    // specific, actionable descriptor.reason (the same field the generic
    // branch below already prefers over its own default message) rather
    // than always collapsing to the generic fallback, so a genuinely
    // diagnosable cause (e.g. a specific config problem) isn't hidden.
    const reason = providerStatus.status === 'ready'
      ? AIS_PROVIDER_PREFERENCE.map((id) => providerStatus.providers.find((provider) => provider.id === id)?.reason).find(Boolean)
      : undefined
    return { unavailable: true, reason: reason || 'Bank connections are not available right now.' }
  }
  const descriptor = providerStatus.providers.find((provider) => provider.id === institution.provider)
  if (!descriptor) return { unavailable: true, reason: 'This provider is not available.' }
  if (!descriptor.available) return { unavailable: true, reason: descriptor.reason || `${descriptor.displayName} is not available right now.` }
  if (!descriptor.configured) return { unavailable: true, reason: `${descriptor.displayName} is not configured yet.` }
  return { unavailable: false }
}

export function providerDescriptorFor(providerId: ConnectorProvider, providerStatus: ProviderStatus): ProviderDescriptor | undefined {
  return providerStatus.status === 'ready' ? providerStatus.providers.find((provider) => provider.id === providerId) : undefined
}

export function institutionIcon(institution: Institution): 'bank' | 'wallet' | 'broker' | 'card' | 'manual' {
  if (institution.kind === 'wallet') return 'wallet'
  if (institution.kind === 'broker') return 'broker'
  if (institution.kind === 'card') return 'card'
  if (institution.kind === 'manual') return 'manual'
  return 'bank'
}

function liveInstitutionHaystack(candidate: ProviderInstitution): string {
  return normalize([candidate.name, candidate.bic, candidate.group?.name].filter(Boolean).join(' '))
}

// The *initial* (blank-query) view of a live AIS directory once a picker
// tile has been chosen. A tile with `directoryTerms` (every 'ais' tile has
// them -- see institutions.ts) narrows the huge country-wide directory down
// to the real ASPSPs belonging to that bank/family, checked against each
// candidate's name/BIC/group.name so it works whether or not the resolved
// provider actually exposes `group` (Enable Banking does; GoCardless
// doesn't -- a concrete bank's own name still matches directly). If the
// narrowed result is empty -- the terms genuinely matched nothing in this
// country's directory -- falls back to the full directory rather than
// asserting the bank is unsupported when the provider data hasn't proven
// that (see "never imply the user's real bank is unsupported" in the
// Connections empty-state contract).
export function familyFilteredInstitutions(institution: Pick<Institution, 'directoryTerms'>, liveInstitutions: ProviderInstitution[]): ProviderInstitution[] {
  const terms = institution.directoryTerms
  if (!terms || terms.length === 0) return liveInstitutions
  const filtered = liveInstitutions.filter((candidate) => {
    const haystack = liveInstitutionHaystack(candidate)
    return terms.some((term) => haystack.includes(normalize(term)))
  })
  return filtered.length > 0 ? filtered : liveInstitutions
}

// Companion to familyFilteredInstitutions(): true once the tile's own
// directoryTerms matched at least one real directory entry, false when it
// silently fell back to the whole, unnarrowed country directory (no
// directoryTerms at all, or a country/provider gap where the family
// genuinely isn't present in what's loaded). The resolution step uses this
// to tell the user their bank's family wasn't found under this provider
// instead of quietly showing an unrelated full list under the tile's name --
// see the "never imply the user's real bank is unsupported" empty-state
// contract, which applies just as much to a silent scope-widening as to a
// blank result.
export function familyFilterNarrowed(institution: Pick<Institution, 'directoryTerms'>, liveInstitutions: ProviderInstitution[]): boolean {
  const terms = institution.directoryTerms
  if (!terms || terms.length === 0) return false
  return liveInstitutions.some((candidate) => {
    const haystack = liveInstitutionHaystack(candidate)
    return terms.some((term) => haystack.includes(normalize(term)))
  })
}

// Forgiving, non-fuzzy search over a live AIS directory: normalized,
// tokenized, every term must appear somewhere in name/BIC/group.name --
// same shape as searchInstitutions() over the static catalogue, so search
// behaves consistently whether the results come from Finance Planner's own
// picker or a live provider directory. Never edit-distance/fuzzy: a
// near-miss must not silently surface the wrong bank.
export function searchLiveInstitutions(liveInstitutions: ProviderInstitution[], query: string): ProviderInstitution[] {
  const terms = normalize(query).split(' ').filter(Boolean)
  if (!terms.length) return liveInstitutions
  return liveInstitutions.filter((candidate) => {
    const haystack = liveInstitutionHaystack(candidate)
    return terms.every((term) => haystack.includes(term))
  })
}

// What the institution-resolution step actually renders: a blank query
// shows the family-scoped view (immediate, no typing required, mirroring
// the "many concrete branches immediately visible" structure); a non-blank
// query searches the *entire* loaded directory, not just the family-scoped
// subset -- typing a real bank name that happens to sit outside the chosen
// family must still find it rather than hiding a genuine provider result.
export function visibleLiveInstitutions(institution: Pick<Institution, 'directoryTerms'>, liveInstitutions: ProviderInstitution[], query: string): ProviderInstitution[] {
  const trimmed = query.trim()
  if (!trimmed) return familyFilteredInstitutions(institution, liveInstitutions)
  return searchLiveInstitutions(liveInstitutions, trimmed)
}

// A minimal, valid Institution built from a live provider-directory result
// picked directly at the top-level "Choose your institution" search (see
// ConnectionsPage's searchLiveDirectory()) -- lets a user who typed a
// concrete bank Finance Planner's static catalogue doesn't list reach the
// same account-type/confirmation steps as a catalogue tile would, without
// inventing any catalogue entry for it. `kind: 'bank'` and no
// `accountTypeRequired` match every other real-bank catalogue tile.
//
// Called with two different shapes of `match`, both valid, deliberately:
//  1. a real ProviderInstitution the user tapped in the resolution step
//     (id/name from the live directory) -- the common case.
//  2. `searchLiveDirectory()`'s own placeholder `{ id: 'live-search', name:
//     searchTerm }` when a resolution attempt is *starting*, before the
//     directory has even loaded and before anything has been tapped -- this
//     only ever drives local UI framing (the "Find your X" heading, the
//     manual-account name hint); it is never the value that reaches
//     startConnector(). See connectorContext(): for every 'ais' institution,
//     including a synthetic one, the submitted institutionId always comes
//     from `resolvedProviderInstitution`, set only once a real directory row
//     is tapped (finalizeInstitutionResolution()) -- never from this id.
export function syntheticAisInstitution(match: Pick<ProviderInstitution, 'id' | 'name'>): Institution {
  return { id: `live:${match.id}`, name: match.name, provider: 'ais', kind: 'bank' }
}

export { institutionById }
