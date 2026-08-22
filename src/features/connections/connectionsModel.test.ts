import { describe, expect, it } from 'vitest'
import type { ConnectorConnection, ProviderDescriptor, ProviderInstitution } from '../../connectors'
import { institutionById as catalogueInstitutionById } from '../../institutions'
import {
  AIS_PROVIDER_PREFERENCE,
  connectionAttentionReason,
  connectionNeedsAttention,
  defaultAccountTypeForInstitution,
  familyFilterNarrowed,
  familyFilteredInstitutions,
  filterInstitutions,
  institutionAvailability,
  institutionById,
  nextSetupStepAfterInstitution,
  previousSetupStepFromConfirmation,
  providerDescriptorFor,
  resolveAisProvider,
  searchLiveInstitutions,
  summarizeAccountSelection,
  syntheticAisInstitution,
  validateManualAccount,
  visibleLiveInstitutions,
  type ProviderStatus,
} from './connectionsModel'

function readyStatus(providers: ProviderDescriptor[]): ProviderStatus { return { status: 'ready', providers } }

const ENABLEBANKING_READY: ProviderDescriptor = { id: 'enablebanking', displayName: 'Bank connection', kind: 'psd2-account-information', available: true, configured: true }
const GOCARDLESS_READY: ProviderDescriptor = { id: 'gocardless', displayName: 'Bank (GoCardless)', kind: 'psd2-account-information', available: true, configured: true }
const FINAPI_UNAVAILABLE: ProviderDescriptor = { id: 'finapi', displayName: 'Bank (finAPI)', kind: 'unavailable', available: false, configured: false, reason: 'finAPI adapter is not configured.' }
const PAYPAL_UNCONFIGURED: ProviderDescriptor = { id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: false }

describe('resolveAisProvider', () => {
  it('prefers Enable Banking when both Enable Banking and GoCardless are available and configured', () => {
    expect(resolveAisProvider(readyStatus([ENABLEBANKING_READY, GOCARDLESS_READY]))).toBe('enablebanking')
  })

  it('falls back to GoCardless when Enable Banking is unconfigured', () => {
    expect(resolveAisProvider(readyStatus([{ ...ENABLEBANKING_READY, configured: false }, GOCARDLESS_READY]))).toBe('gocardless')
  })

  it('falls back to GoCardless when Enable Banking is unavailable', () => {
    expect(resolveAisProvider(readyStatus([{ ...ENABLEBANKING_READY, available: false }, GOCARDLESS_READY]))).toBe('gocardless')
  })

  it('falls back to GoCardless when Enable Banking is entirely missing from the response', () => {
    expect(resolveAisProvider(readyStatus([GOCARDLESS_READY]))).toBe('gocardless')
  })

  it('returns null when neither AIS provider is available -- never guesses, never silently uses PayPal/finAPI', () => {
    expect(resolveAisProvider(readyStatus([FINAPI_UNAVAILABLE, PAYPAL_UNCONFIGURED]))).toBeNull()
  })

  it('returns null while status is loading, never optimistically resolving a provider', () => {
    expect(resolveAisProvider({ status: 'loading' })).toBeNull()
  })

  it('returns null when status failed to load', () => {
    expect(resolveAisProvider({ status: 'error' })).toBeNull()
  })

  it('always resolves in the same fixed preference order regardless of array order in the response', () => {
    expect(resolveAisProvider(readyStatus([GOCARDLESS_READY, ENABLEBANKING_READY]))).toBe('enablebanking')
    expect(AIS_PROVIDER_PREFERENCE).toEqual(['enablebanking', 'gocardless'])
  })
})

describe('institutionAvailability', () => {
  const loading: ProviderStatus = { status: 'loading' }
  const errored: ProviderStatus = { status: 'error' }
  const ready: ProviderStatus = readyStatus([ENABLEBANKING_READY, GOCARDLESS_READY, FINAPI_UNAVAILABLE, PAYPAL_UNCONFIGURED])

  it('is always available for manual institutions regardless of provider status', () => {
    expect(institutionAvailability({ provider: 'manual' }, loading).unavailable).toBe(false)
    expect(institutionAvailability({ provider: 'manual' }, errored).unavailable).toBe(false)
    expect(institutionAvailability({ provider: 'manual' }, ready).unavailable).toBe(false)
  })

  it('fails closed for an "ais" (bank) institution while status is loading, never optimistically available', () => {
    expect(institutionAvailability({ provider: 'ais' }, loading)).toEqual({ unavailable: true, reason: 'Checking availability…' })
  })

  it('fails closed for an "ais" institution when status failed to load', () => {
    expect(institutionAvailability({ provider: 'ais' }, errored)).toEqual({ unavailable: true, reason: 'Availability could not be checked.' })
  })

  it('is available once Enable Banking resolves', () => {
    expect(institutionAvailability({ provider: 'ais' }, ready)).toEqual({ unavailable: false })
  })

  it('is available via the GoCardless fallback when Enable Banking alone is unusable', () => {
    const fallbackOnly = readyStatus([{ ...ENABLEBANKING_READY, configured: false }, GOCARDLESS_READY])
    expect(institutionAvailability({ provider: 'ais' }, fallbackOnly)).toEqual({ unavailable: false })
  })

  it('marks an "ais" institution unavailable, never defaulting to available, when neither AIS provider resolves', () => {
    const neitherAvailable = readyStatus([{ ...ENABLEBANKING_READY, available: false }, { ...GOCARDLESS_READY, available: false }])
    expect(institutionAvailability({ provider: 'ais' }, neitherAvailable)).toEqual({ unavailable: true, reason: 'Bank connections are not available right now.' })
  })

  it('surfaces a specific descriptor reason for an unavailable "ais" institution when one exists, instead of always collapsing to the generic message', () => {
    const withReason = readyStatus([
      { ...ENABLEBANKING_READY, available: false, reason: 'Enable Banking application credentials are invalid.' },
      { ...GOCARDLESS_READY, available: false },
    ])
    expect(institutionAvailability({ provider: 'ais' }, withReason)).toEqual({ unavailable: true, reason: 'Enable Banking application credentials are invalid.' })
  })

  it('prefers the preferred provider\'s reason over the fallback provider\'s when both carry one', () => {
    const bothHaveReasons = readyStatus([
      { ...ENABLEBANKING_READY, available: false, reason: 'Enable Banking reason' },
      { ...GOCARDLESS_READY, available: false, reason: 'GoCardless reason' },
    ])
    expect(institutionAvailability({ provider: 'ais' }, bothHaveReasons)).toEqual({ unavailable: true, reason: 'Enable Banking reason' })
  })

  it('marks an explicitly unavailable provider (finAPI) as unavailable with its reason, never as a normal selectable institution', () => {
    expect(institutionAvailability({ provider: 'finapi' }, ready)).toEqual({ unavailable: true, reason: 'finAPI adapter is not configured.' })
  })

  it('marks an available-but-unconfigured provider as unavailable', () => {
    expect(institutionAvailability({ provider: 'paypal' }, ready)).toEqual({ unavailable: true, reason: 'PayPal is not configured yet.' })
  })
})

describe('providerDescriptorFor', () => {
  const providers: ProviderDescriptor[] = [{ id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: true, mode: 'owner' }]

  it('returns undefined while loading or on error, never a stale/guessed descriptor', () => {
    expect(providerDescriptorFor('paypal', { status: 'loading' })).toBeUndefined()
    expect(providerDescriptorFor('paypal', { status: 'error' })).toBeUndefined()
  })

  it('returns the matching descriptor once ready', () => {
    expect(providerDescriptorFor('paypal', { status: 'ready', providers })?.mode).toBe('owner')
  })

  it('returns undefined for a provider missing from a successful response', () => {
    expect(providerDescriptorFor('gocardless', { status: 'ready', providers })).toBeUndefined()
  })
})

describe('filterInstitutions', () => {
  it('filters by category, mapping "popular" to popularOnly', () => {
    expect(filterInstitutions('', 'popular').every((institution) => institution.popular)).toBe(true)
    expect(filterInstitutions('', 'wallet').map((institution) => institution.id)).toEqual(['paypal'])
    expect(filterInstitutions('', 'manual').map((institution) => institution.id)).toEqual(['manual'])
    expect(filterInstitutions('', 'card').map((institution) => institution.id)).toEqual(['credit-card'])
  })

  it('supports search combined with a category', () => {
    expect(filterInstitutions('ing', 'bank').map((institution) => institution.id)).toEqual(['ing'])
    expect(filterInstitutions('paypal', 'bank')).toEqual([])
  })

  it('finds institutions with unusually long names without truncating the underlying data', () => {
    const hypo = institutionById('hypovereinsbank')
    expect(hypo?.name).toBe('UniCredit Bank – HypoVereinsbank')
    expect(filterInstitutions('hvb', 'popular').map((institution) => institution.id)).toContain('hypovereinsbank')
  })
})

describe('defaultAccountTypeForInstitution', () => {
  it('defaults card institutions to credit-card and brokers to investment', () => {
    expect(defaultAccountTypeForInstitution({ kind: 'card' } as never)).toBe('credit-card')
    expect(defaultAccountTypeForInstitution({ kind: 'broker' } as never)).toBe('investment')
    expect(defaultAccountTypeForInstitution({ kind: 'bank' } as never)).toBe('checking')
    expect(defaultAccountTypeForInstitution({ kind: 'wallet' } as never)).toBe('checking')
  })
})

describe('setup step transitions', () => {
  it('sends account-type-required institutions to step 2, others straight to step 3', () => {
    expect(nextSetupStepAfterInstitution({ accountTypeRequired: true } as never)).toBe(2)
    expect(nextSetupStepAfterInstitution({ accountTypeRequired: false } as never)).toBe(3)
    expect(nextSetupStepAfterInstitution({} as never)).toBe(3)
  })

  it('returns to step 2 from confirmation only when the institution required an account-type step', () => {
    expect(previousSetupStepFromConfirmation({ accountTypeRequired: true } as never)).toBe(2)
    expect(previousSetupStepFromConfirmation({ accountTypeRequired: false } as never)).toBe(1)
    expect(previousSetupStepFromConfirmation(undefined)).toBe(1)
  })
})

describe('connectionAttentionReason', () => {
  const base: ConnectorConnection = { id: 'c', provider: 'gocardless', displayName: 'Test bank', status: 'connected' }
  const now = Date.parse('2026-08-05T00:00:00.000Z')

  it('flags a provider error regardless of consent expiry', () => {
    expect(connectionAttentionReason({ ...base, status: 'error' }, now)).toBe('provider-error')
  })
  it('flags expired consent', () => {
    expect(connectionAttentionReason({ ...base, consentExpiresAt: '2026-08-01T00:00:00.000Z' }, now)).toBe('consent-expired')
  })
  it('flags consent expiring within 7 days', () => {
    expect(connectionAttentionReason({ ...base, consentExpiresAt: '2026-08-10T00:00:00.000Z' }, now)).toBe('consent-expiring-soon')
  })
  it('reports no attention needed for a healthy connection', () => {
    expect(connectionAttentionReason({ ...base, consentExpiresAt: '2026-12-01T00:00:00.000Z' }, now)).toBeNull()
    expect(connectionNeedsAttention({ ...base, consentExpiresAt: '2026-12-01T00:00:00.000Z' }, now)).toBe(false)
  })
})

describe('summarizeAccountSelection', () => {
  it('reconciles selected count against only the currently discovered accounts', () => {
    const summary = summarizeAccountSelection(['a', 'b', 'c'], new Set(['a', 'c', 'stale-id-not-discovered']))
    expect(summary).toEqual({ selectedCount: 2, totalCount: 3 })
  })
  it('reports zero selected when nothing is checked', () => {
    expect(summarizeAccountSelection(['a', 'b'], new Set())).toEqual({ selectedCount: 0, totalCount: 2 })
  })
})

describe('validateManualAccount', () => {
  it('requires a non-empty name', () => {
    const result = validateManualAccount({ name: '  ', accountType: 'checking', balanceInput: '10', creditLimitInput: '' })
    expect(result.error).toBe('Enter an account name.')
  })

  it('requires a finite current balance', () => {
    const result = validateManualAccount({ name: 'Cash', accountType: 'checking', balanceInput: 'not-a-number', creditLimitInput: '' })
    expect(result.error).toMatch(/current balance/)
  })

  it('accepts a valid checking account without a credit limit field', () => {
    const result = validateManualAccount({ name: 'Everyday', accountType: 'checking', balanceInput: '1234.56', creditLimitInput: '' })
    expect(result).toEqual({ balanceCents: 123_456 })
  })

  it('leaves the credit limit optional for credit cards', () => {
    const result = validateManualAccount({ name: 'Visa', accountType: 'credit-card', balanceInput: '250,75', creditLimitInput: '' })
    expect(result).toEqual({ balanceCents: 25_075 })
  })

  it('rejects a negative credit limit', () => {
    const result = validateManualAccount({ name: 'Visa', accountType: 'credit-card', balanceInput: '100', creditLimitInput: '-50' })
    expect(result.error).toBe('Credit limit cannot be negative.')
  })

  it('parses a valid credit limit for credit cards', () => {
    const result = validateManualAccount({ name: 'Visa', accountType: 'credit-card', balanceInput: '250.75', creditLimitInput: '3000' })
    expect(result).toEqual({ balanceCents: 25_075, creditLimitCents: 300_000 })
  })

  it('never produces a non-finite balance', () => {
    const result = validateManualAccount({ name: 'Cash', accountType: 'checking', balanceInput: 'Infinity', creditLimitInput: '' })
    expect(result.error).toMatch(/current balance/)
  })
})

// Regression coverage for the reported defect: choosing "Volksbank /
// Raiffeisenbank" opened a branch search prefilled with that entire literal
// label, which never matches a real ASPSP name ("Volksbank Demmin",
// "Raiffeisenbank Grävenwiesbach", ...) -- see institutions.ts's
// directoryTerms and ConnectionsPage.tsx's chooseInstitution().
describe('familyFilteredInstitutions (bank-family -> live directory, never a literal label search)', () => {
  const volksbank = catalogueInstitutionById('volksbank')!
  const sparkasse = catalogueInstitutionById('sparkasse')!

  const DIRECTORY: ProviderInstitution[] = [
    { id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin', country: 'DE' },
    { id: 'DE:Raiffeisenbank Grävenwiesbach', name: 'Raiffeisenbank Grävenwiesbach', country: 'DE' },
    // Only reachable via Enable Banking's `group.name` -- the bank's own
    // name shares no keyword with the family at all.
    { id: 'DE:Semper Bank AG', name: 'Semper Bank AG', country: 'DE', group: { name: 'Volksbanken Raiffeisenbanken' } },
    { id: 'DE:Aachener Sparkasse', name: 'Aachener Sparkasse', country: 'DE' },
    { id: 'DE:ING-DiBa', name: 'ING-DiBa', country: 'DE' },
  ]

  it('never searches for the literal multi-word picker label -- it matches real branch names by keyword', () => {
    const results = familyFilteredInstitutions(volksbank, DIRECTORY)
    expect(results.map((institution) => institution.id)).toEqual(
      expect.arrayContaining(['DE:Volksbank Demmin', 'DE:Raiffeisenbank Grävenwiesbach']),
    )
    expect(results.map((institution) => institution.id)).not.toContain('DE:Aachener Sparkasse')
    expect(results.map((institution) => institution.id)).not.toContain('DE:ING-DiBa')
  })

  it('matches a cooperative-network member through Enable Banking group.name even when its own name shares no keyword', () => {
    const results = familyFilteredInstitutions(volksbank, DIRECTORY)
    expect(results.map((institution) => institution.id)).toContain('DE:Semper Bank AG')
  })

  it('narrows to a different family independently', () => {
    const results = familyFilteredInstitutions(sparkasse, DIRECTORY)
    expect(results.map((institution) => institution.id)).toEqual(['DE:Aachener Sparkasse'])
  })

  it('falls back to the full directory, never an unsupported dead end, when the family terms match nothing in this country', () => {
    const results = familyFilteredInstitutions(volksbank, [{ id: 'DE:ING-DiBa', name: 'ING-DiBa', country: 'DE' }])
    expect(results).toEqual([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', country: 'DE' }])
  })

  it('returns the full directory unchanged for an institution with no directoryTerms', () => {
    expect(familyFilteredInstitutions({}, DIRECTORY)).toBe(DIRECTORY)
  })
})

describe('familyFilterNarrowed (signals a silent full-directory fallback instead of hiding it)', () => {
  const volksbank = catalogueInstitutionById('volksbank')!
  const sparkasse = catalogueInstitutionById('sparkasse')!

  it('is true once at least one real entry matched the family terms', () => {
    const directory: ProviderInstitution[] = [{ id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin', country: 'DE' }]
    expect(familyFilterNarrowed(volksbank, directory)).toBe(true)
  })

  it('is false when the terms matched nothing -- the caller fell back to the unnarrowed directory', () => {
    const directory: ProviderInstitution[] = [{ id: 'DE:ING-DiBa', name: 'ING-DiBa', country: 'DE' }]
    expect(familyFilterNarrowed(sparkasse, directory)).toBe(false)
  })

  it('is false for an institution with no directoryTerms -- nothing to narrow, so nothing to signal', () => {
    expect(familyFilterNarrowed({}, [{ id: 'DE:ING-DiBa', name: 'ING-DiBa', country: 'DE' }])).toBe(false)
  })
})

describe('searchLiveInstitutions (forgiving, non-fuzzy live-directory search)', () => {
  const DIRECTORY: ProviderInstitution[] = [
    { id: 'DE:Sparkasse KoelnBonn', name: 'Sparkasse KoelnBonn', country: 'DE', bic: 'COKSDE33' },
    { id: 'DE:Volksbank Wolfenbüttel', name: 'Volksbank Wolfenbüttel', country: 'DE' },
    { id: 'DE:Aachener Sparkasse', name: 'Aachener Sparkasse', country: 'DE', bic: 'AACSDE33' },
  ]

  it('matches by BIC', () => {
    expect(searchLiveInstitutions(DIRECTORY, 'AACSDE33').map((i) => i.id)).toEqual(['DE:Aachener Sparkasse'])
  })

  it('is forgiving of case and diacritics (typing an ASCII "u" still finds a name spelled with "ü")', () => {
    expect(searchLiveInstitutions(DIRECTORY, 'koeln').map((i) => i.id)).toEqual(['DE:Sparkasse KoelnBonn'])
    expect(searchLiveInstitutions(DIRECTORY, 'WOLFENBUTTEL').map((i) => i.id)).toEqual(['DE:Volksbank Wolfenbüttel'])
  })

  it('requires every search term to match, never a near-miss that could select the wrong bank', () => {
    expect(searchLiveInstitutions(DIRECTORY, 'aachener koeln')).toEqual([])
  })

  it('a blank query returns every institution unfiltered', () => {
    expect(searchLiveInstitutions(DIRECTORY, '   ')).toBe(DIRECTORY)
  })
})

describe('visibleLiveInstitutions (what the resolution step actually renders)', () => {
  const volksbank = catalogueInstitutionById('volksbank')!
  const DIRECTORY: ProviderInstitution[] = [
    { id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin', country: 'DE' },
    { id: 'DE:Aachener Sparkasse', name: 'Aachener Sparkasse', country: 'DE' },
  ]

  it('a blank query shows the family-scoped view immediately, with no typing required', () => {
    expect(visibleLiveInstitutions(volksbank, DIRECTORY, '').map((i) => i.id)).toEqual(['DE:Volksbank Demmin'])
  })

  it('a typed query searches the whole loaded directory, not just the family-scoped subset -- a real result outside the family must never be hidden', () => {
    expect(visibleLiveInstitutions(volksbank, DIRECTORY, 'Aachener').map((i) => i.id)).toEqual(['DE:Aachener Sparkasse'])
  })
})

describe('syntheticAisInstitution (top-level live-directory search result -> a valid Institution)', () => {
  it('builds a real-bank-shaped Institution from a live match, never claiming a required account type it cannot know', () => {
    const match: ProviderInstitution = { id: 'DE:Berliner Volksbank', name: 'Berliner Volksbank', country: 'DE' }
    const institution = syntheticAisInstitution(match)
    expect(institution).toEqual({ id: 'live:DE:Berliner Volksbank', name: 'Berliner Volksbank', provider: 'ais', kind: 'bank' })
    expect(nextSetupStepAfterInstitution(institution)).toBe(3)
  })

  // ConnectionsPage's searchLiveDirectory() calls this with its own
  // placeholder { id: 'live-search', name: searchTerm } while a resolution
  // attempt is starting, before any real directory row has been tapped --
  // only {id, name} are required, no other ProviderInstitution field.
  it('also accepts a bare {id, name} placeholder, since only those two fields drive local UI framing before a real match is tapped', () => {
    const institution = syntheticAisInstitution({ id: 'live-search', name: 'Berliner Volksbank' })
    expect(institution).toEqual({ id: 'live:live-search', name: 'Berliner Volksbank', provider: 'ais', kind: 'bank' })
  })
})
