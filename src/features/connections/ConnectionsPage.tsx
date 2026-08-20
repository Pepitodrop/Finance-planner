import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileText,
  FileUp,
  Info,
  Landmark,
  Link2,
  Lock,
  Pencil,
  PiggyBank,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  Undo2,
  Unplug,
  Wallet,
  X,
} from 'lucide-react'
import {
  applySyncPreview,
  buildSyncPreview,
  consentDaysRemaining,
  disconnectConnector,
  fetchProviderInstitutions,
  fetchProviderStatus,
  selectSyncPreviewAccounts,
  startConnector,
  synchronizeConnections,
  type ConnectorAccountType,
  type ConnectorConnection,
  type ConnectorProvider,
  type ConnectorStartContext,
  type ProviderDescriptor,
  type ProviderInstitution,
  type SyncPreview,
} from '../../connectors'
import { institutionLettermark, institutionLogoUrl } from '../../institution-logos'
import { normalizeManualCreditCard } from '../../manualCreditCard'
import { applyStatementImport, buildStatementPreview, parseStatement, type StatementPreview } from '../../statementImport'
import type { Account, AppState } from '../../types'
import { useDialog } from '../../app/useDialog'
import {
  ACCOUNT_TYPE_OPTIONS,
  ATTENTION_REASON_COPY,
  CATEGORY_OPTIONS,
  AIS_PROVIDER_PREFERENCE,
  MAX_STATEMENT_FILE_BYTES,
  connectionAttentionReason,
  connectionNeedsAttention,
  defaultAccountTypeForInstitution,
  filterInstitutions,
  institutionAvailability,
  institutionById,
  institutionIcon,
  nextSetupStepAfterInstitution,
  previousSetupStepFromConfirmation,
  providerDescriptorFor,
  resolveAisProvider,
  summarizeAccountSelection,
  validateManualAccount,
  type InstitutionCategory,
  type ProviderStatus,
  type SetupStep,
} from './connectionsModel'
import type { Institution } from '../../institutions'
import { ACCEPTANCE_CONNECTIONS, ACCEPTANCE_PROVIDER_STATUS_PAYPAL_UNCONFIGURED, ACCEPTANCE_PROVIDER_STATUS_UNAVAILABLE, ACCEPTANCE_STATEMENT_PREVIEW, ACCEPTANCE_SYNC_PREVIEWS, type ConnectionsAcceptanceMode } from './connectionsAcceptanceFixtures'

interface ConnectionsPageProps { state: AppState; onApply: (state: AppState) => void; acceptanceMode?: ConnectionsAcceptanceMode }
type Screen = 'overview' | 'checking' | 'sync-selection' | 'attention' | 'statement-preview'

// Acceptance modes that inject their own deterministic providerStatus (see
// the acceptanceMode effect below) instead of relying on the real fetch.
const PROVIDER_STATUS_FIXTURE_MODES = new Set<ConnectionsAcceptanceMode | undefined>(['paypal-confirmation', 'provider-unavailable', 'paypal-unconfigured'])

// Fixed, application-owned copy for a provider-return `?error=` code. Never
// render the free-text `error_description` query param verbatim -- see the
// callback-handling effect below.
const CALLBACK_ERROR_COPY: Record<string, string> = {
  invalid_state: 'It may have expired or already been used.',
  access_denied: 'The provider reported that authorization was not granted.',
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function InstitutionMark({ id, name, size = 20 }: { id: string; name: string; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const logoUrl = institutionLogoUrl(id)
  if (logoUrl && !imageFailed) {
    return <span className="connections-mark connections-mark--logo">
      <img src={logoUrl} alt="" width={size} height={size} loading="lazy" onError={() => setImageFailed(true)}/>
    </span>
  }
  const { letters, color } = institutionLettermark(id, name)
  return <span className="connections-mark connections-mark--lettermark" style={{ '--connections-mark-color': color } as CSSProperties} aria-hidden="true">{letters}</span>
}

function InstitutionIcon({ institution, size = 20 }: { institution: { id?: string; name?: string; kind: string }; size?: number }) {
  const kind = institutionIcon(institution as Parameters<typeof institutionIcon>[0])
  if (kind === 'card') return <CreditCard size={size}/>
  if (kind === 'manual') return <Pencil size={size}/>
  if (institution.id && institution.name) return <InstitutionMark id={institution.id} name={institution.name} size={size}/>
  if (kind === 'wallet') return <Wallet size={size}/>
  if (kind === 'broker') return <TrendingUp size={size}/>
  return <Landmark size={size}/>
}

export function ConnectionsPage({ state, onApply, acceptanceMode }: ConnectionsPageProps) {
  const [screen, setScreen] = useState<Screen>('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [connections, setConnections] = useState<ConnectorConnection[]>([])
  const [previews, setPreviews] = useState<SyncPreview[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [statementPreview, setStatementPreview] = useState<StatementPreview | null>(null)
  const [statementFileName, setStatementFileName] = useState('')
  const [rollbackState, setRollbackState] = useState<AppState | null>(null)

  const [setupOpen, setSetupOpen] = useState(false)
  const [setupStep, setSetupStep] = useState<SetupStep>(1)
  const [setupError, setSetupError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [category, setCategory] = useState<InstitutionCategory>('popular')
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null)
  const [accountType, setAccountType] = useState<ConnectorAccountType>('checking')
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ status: 'loading' })

  const [resolvingInstitution, setResolvingInstitution] = useState<Institution | null>(null)
  // The concrete AIS provider (Enable Banking or GoCardless) this resolution
  // attempt is searching against -- fixed once resolution begins (see
  // chooseInstitution()) and only ever changed by the explicit "try another
  // connection method" fallback action, never automatically. This is what
  // actually flows into fetchProviderInstitutions()/startConnector(), not
  // the institution's provider-agnostic 'ais' tag.
  const [resolvingProvider, setResolvingProvider] = useState<ConnectorProvider | null>(null)
  const [resolvedProviderInstitution, setResolvedProviderInstitution] = useState<ProviderInstitution | null>(null)
  const [liveInstitutionQuery, setLiveInstitutionQuery] = useState('')
  const [liveInstitutions, setLiveInstitutions] = useState<ProviderInstitution[] | null>(null)
  const [liveInstitutionsLoading, setLiveInstitutionsLoading] = useState(false)
  const [liveInstitutionsError, setLiveInstitutionsError] = useState('')

  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualAccountType, setManualAccountType] = useState<ConnectorAccountType>('checking')
  const [manualBalance, setManualBalance] = useState('')
  const [manualLimit, setManualLimit] = useState('')
  const [manualError, setManualError] = useState('')

  const [attentionProvider, setAttentionProvider] = useState<ConnectorProvider | null>(null)
  const [attentionError, setAttentionError] = useState('')
  const [disconnectConfirming, setDisconnectConfirming] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true' || !acceptanceMode) return
    if (acceptanceMode === 'empty') { setScreen('overview'); setConnections([]); return }
    if (acceptanceMode === 'populated') { setScreen('overview'); setConnections(ACCEPTANCE_CONNECTIONS); return }
    if (acceptanceMode === 'institution-selector') { setConnections(ACCEPTANCE_CONNECTIONS); setSetupStep(1); setCategory('popular'); setSearchTerm(''); setSetupOpen(true); return }
    if (acceptanceMode === 'institution-search') { setConnections(ACCEPTANCE_CONNECTIONS); setSetupStep(1); setCategory('popular'); setSearchTerm('bank'); setSetupOpen(true); return }
    if (acceptanceMode === 'account-type') { setSelectedInstitutionId('ing'); setAccountType('checking'); setSetupStep(2); setSetupOpen(true); return }
    // 'ing' is an 'ais' institution -- bypassing chooseInstitution() here
    // means resolvingProvider must be set explicitly too, or effectiveProvider()
    // returns undefined and "Continue securely" silently does nothing.
    if (acceptanceMode === 'bank-confirmation') { setSelectedInstitutionId('ing'); setResolvingProvider('gocardless'); setResolvedProviderInstitution({ id: 'INGDDEFF_INGDDEFFXXX', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }); setSetupStep(3); setSetupOpen(true); return }
    if (acceptanceMode === 'paypal-confirmation') { setSelectedInstitutionId('paypal'); setProviderStatus({ status: 'ready', providers: [{ id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: true, mode: 'owner' }] }); setSetupStep(3); setSetupOpen(true); return }
    if (acceptanceMode === 'checking') { setScreen('checking'); return }
    if (acceptanceMode === 'sync-selection') {
      setPreviews(ACCEPTANCE_SYNC_PREVIEWS)
      setSelectedAccountIds(new Set(ACCEPTANCE_SYNC_PREVIEWS.flatMap((preview) => preview.accountsToCreate.map((account) => account.id))))
      setScreen('sync-selection')
      return
    }
    if (acceptanceMode === 'attention') { setConnections(ACCEPTANCE_CONNECTIONS); setAttentionProvider('finapi'); setScreen('attention'); return }
    if (acceptanceMode === 'manual') { setManualOpen(true); return }
    if (acceptanceMode === 'statement-preview') { setStatementFileName('finance_statement_march.csv'); setStatementPreview(ACCEPTANCE_STATEMENT_PREVIEW); setScreen('statement-preview'); return }
    if (acceptanceMode === 'provider-unavailable') { setConnections(ACCEPTANCE_CONNECTIONS); setProviderStatus({ status: 'ready', providers: ACCEPTANCE_PROVIDER_STATUS_UNAVAILABLE }); setSetupStep(1); setCategory('popular'); setSearchTerm(''); setSetupOpen(true); return }
    if (acceptanceMode === 'paypal-unconfigured') { setSelectedInstitutionId('paypal'); setProviderStatus({ status: 'ready', providers: ACCEPTANCE_PROVIDER_STATUS_PAYPAL_UNCONFIGURED }); setSetupStep(3); setSetupOpen(true) }
  }, [acceptanceMode])

  // Provider status gates whether an external (gocardless/paypal/finapi)
  // institution can be selected at all -- it is load-bearing, not advisory,
  // so it fails closed: 'loading' and 'error' both make every external
  // provider non-selectable (see institutionAvailability()). Exposed so the
  // "Retry" action in the setup dialog can call it again after a failure.
  // Generation counter: only the most recently issued call may commit state,
  // regardless of settlement order. Closes the "stale response arrives after
  // a newer response" race (a slow mount-time fetch resolving after a faster
  // Retry, or vice versa) independent of any UI-level mitigation -- the
  // Retry button already can't be double-clicked in practice (it only
  // renders while status === 'error', so clicking it flips to 'loading' and
  // the button itself unmounts before a second click could ever land), but
  // the counter is the actual correctness guarantee, not the button.
  const providerStatusGeneration = useRef(0)
  const loadProviderStatus = useCallback(() => {
    const generation = (providerStatusGeneration.current += 1)
    setProviderStatus({ status: 'loading' })
    let cancelled = false
    void (async () => {
      try {
        const providers = await fetchProviderStatus()
        if (!cancelled && providerStatusGeneration.current === generation) setProviderStatus({ status: 'ready', providers })
      } catch {
        if (!cancelled && providerStatusGeneration.current === generation) setProviderStatus({ status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // A couple of acceptance fixtures (paypal-confirmation, provider-unavailable)
    // set their own deterministic providerStatus above; the real fetch below
    // would otherwise race it and overwrite it once the network call resolves.
    if (import.meta.env.VITE_ACCEPTANCE_FIXTURES === 'true' && PROVIDER_STATUS_FIXTURE_MODES.has(acceptanceMode)) return
    return loadProviderStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount; a fresh acceptanceMode always gets a fresh mount (see the `key` prop where ConnectionsPage is used)
  }, [])

  const loadLiveInstitutions = useCallback(async (provider: ConnectorProvider, options: { force?: boolean } = {}) => {
    // `liveInstitutions` is the whole per-country directory (filtered
    // client-side, see filteredLiveInstitutions below), so an empty array is
    // a legitimate "already fetched, nothing there" result -- and arrays are
    // truthy in JS, so `!liveInstitutions` alone would never catch that
    // case. `force` exists for the one case where reusing it would be wrong
    // regardless of emptiness: switching resolvingProvider via the explicit
    // fallback action, where a stale result from the *previous* provider
    // must never be shown as if it belonged to the new one.
    if (!options.force && (liveInstitutions || liveInstitutionsLoading)) return
    setLiveInstitutionsLoading(true)
    try {
      const institutions = await fetchProviderInstitutions(provider, 'DE')
      setLiveInstitutions(institutions)
    } catch (reason) {
      setLiveInstitutionsError(reason instanceof Error ? reason.message : 'The bank directory could not be loaded.')
    } finally {
      setLiveInstitutionsLoading(false)
    }
  }, [liveInstitutions, liveInstitutionsLoading])

  // Derived from AIS_PROVIDER_PREFERENCE (the single source of truth for
  // provider order) rather than hardcoded literals, so both the fallback
  // trigger below and its availability gate stay correct if that list's
  // order or membership ever changes.
  const [aisPrimaryProvider, aisFallbackProvider] = AIS_PROVIDER_PREFERENCE

  // User-initiated only, never automatic: switches the current resolution
  // attempt from the preferred provider to the explicit fallback and
  // re-searches with the same query. Only offered when a real fallback
  // exists (see InstitutionResolutionStep's gocardlessFallbackAvailable
  // prop) and only before startConnector() has been called -- once that
  // fires the page navigates away, so there is no code path that could
  // change the provider mid-consent.
  const useGoCardlessFallback = () => {
    if (!aisFallbackProvider) return
    setResolvingProvider(aisFallbackProvider)
    setLiveInstitutions(null)
    setLiveInstitutionsError('')
    void loadLiveInstitutions(aisFallbackProvider, { force: true })
  }

  const filteredLiveInstitutions = useMemo(() => {
    if (!liveInstitutions) return []
    const query = liveInstitutionQuery.trim().toLocaleLowerCase('de-DE')
    if (!query) return liveInstitutions
    return liveInstitutions.filter((institution) => institution.name.toLocaleLowerCase('de-DE').includes(query) || institution.bic?.toLocaleLowerCase('de-DE').includes(query))
  }, [liveInstitutions, liveInstitutionQuery])

  // A real, independently-available fallback exists only when the fallback
  // provider itself reports available+configured -- offering the fallback
  // button when there is nothing to fall back to would be a dead end. Only
  // relevant while actively resolving through the preferred provider.
  const gocardlessFallbackAvailable = resolvingProvider === aisPrimaryProvider && Boolean(aisFallbackProvider) && Boolean(providerDescriptorFor(aisFallbackProvider, providerStatus)?.available && providerDescriptorFor(aisFallbackProvider, providerStatus)?.configured)

  const selectedInstitution = selectedInstitutionId ? institutionById(selectedInstitutionId) : undefined
  const filteredInstitutions = useMemo(() => filterInstitutions(searchTerm, category), [searchTerm, category])
  const discoveredAccounts = useMemo(() => previews.flatMap((preview) => preview.accountsToCreate), [previews])
  const selection = summarizeAccountSelection(discoveredAccounts.map((account) => account.id), selectedAccountIds)
  const selectedPreviews = useMemo(() => previews.map((preview) => selectSyncPreviewAccounts(preview, selectedAccountIds)), [previews, selectedAccountIds])
  const summary = useMemo(() => selectedPreviews.reduce((result, preview) => ({
    transactions: result.transactions + preview.transactionsToImport.length,
    duplicates: result.duplicates + preview.duplicateCount,
    pending: result.pending + preview.pendingCount,
    qualityTotal: result.qualityTotal + preview.quality.score,
  }), { transactions: 0, duplicates: 0, pending: 0, qualityTotal: 0 }), [selectedPreviews])
  const averageQuality = selectedPreviews.length ? Math.round(summary.qualityTotal / selectedPreviews.length) : 0
  const qualityWarnings = [...new Set(selectedPreviews.flatMap((preview) => preview.quality.warnings))]
  const attentionConnection = attentionProvider ? connections.find((connection) => connection.provider === attentionProvider) : undefined
  const attentionReason = attentionConnection ? connectionAttentionReason(attentionConnection) : null

  const synchronize = useCallback(async (isProviderReturn = false) => {
    setBusy(true)
    setError('')
    setPreviews([])
    setSelectedAccountIds(new Set())
    if (isProviderReturn) setScreen('checking')
    try {
      const payloads = await synchronizeConnections()
      setConnections(payloads.map((payload) => payload.connection))
      const successful = payloads.filter((payload) => payload.connection.status !== 'error')
      const next = successful.map((payload) => buildSyncPreview(state, payload))
      const failed = payloads.filter((payload) => payload.connection.status === 'error')
      const discovered = next.flatMap((preview) => preview.accountsToCreate)
      setPreviews(next)
      setSelectedAccountIds(new Set(discovered.map((account) => account.id)))
      if (discovered.length) {
        setScreen('sync-selection')
      } else {
        setScreen('overview')
        setMessage(failed.length ? `No connection could be updated successfully. ${failed.length} connection(s) need attention.` : 'No new accounts were found.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Synchronization failed.')
      setScreen('overview')
    } finally {
      setBusy(false)
    }
  }, [state])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const providerParam = params.get('provider')
    const errorCode = params.get('error')
    const callbackCompleted = params.has('code') || params.has('state')
    if (!providerParam && !errorCode && !callbackCompleted) return

    const cleanUrl = new URL(window.location.href)
    for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'institution']) cleanUrl.searchParams.delete(key)
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)

    if (errorCode) {
      // Fixed, application-owned copy keyed by error code only -- never
      // render the free-text error_description query param verbatim. It
      // comes straight from the current URL, so an attacker-crafted link to
      // this app's own origin could otherwise make the trusted error banner
      // display arbitrary text (phishing-adjacent), even though React
      // escapes it (no XSS, just misleading UI content).
      setError(`The connection was not completed: ${CALLBACK_ERROR_COPY[errorCode] ?? 'Please try again.'}`)
      return
    }

    setMessage('Returned from provider. Checking your connection and loading available accounts.')
    void synchronize(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the initial callback URL only
  }, [])

  // Reports failures to the caller's own error channel: the setup modal and
  // the attention (reconnect) screen each surface their own provider-start
  // errors in place, rather than sharing a single banner that a modal can
  // visually hide (see connections-setup-modal error handling below).
  const startProvider = async (provider: ConnectorProvider, context: ConnectorStartContext, onError: (message: string) => void) => {
    setBusy(true)
    onError('')
    try {
      await startConnector(provider, context)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'The connection could not be started.')
      setBusy(false)
    }
  }

  const connectorContext = (): ConnectorStartContext => {
    if (!selectedInstitution) return {}
    if (selectedInstitution.provider === 'ais') {
      return { institutionId: resolvedProviderInstitution?.id, institutionName: resolvedProviderInstitution?.name, accountType }
    }
    return { institutionId: selectedInstitution.id, institutionName: selectedInstitution.name, accountType }
  }

  // The concrete provider a start()/reconnect attempt actually targets. For
  // an 'ais' (provider-agnostic bank) institution this is whichever provider
  // resolution fixed for the current attempt (resolvingProvider) -- never
  // re-derived from providerStatus at confirm time, so a status change after
  // resolution began can never retarget an in-flight attempt. For every
  // other institution the tile's own provider id already is the real one.
  const effectiveProvider = (): ConnectorProvider | undefined => {
    if (!selectedInstitution) return undefined
    if (selectedInstitution.provider === 'ais') return resolvingProvider ?? undefined
    if (selectedInstitution.provider === 'manual') return undefined
    return selectedInstitution.provider
  }

  const refreshAll = () => void synchronize(false)

  const disconnect = async (provider: ConnectorProvider) => {
    setBusy(true)
    setAttentionError('')
    try {
      const result = await disconnectConnector(provider)
      setConnections((current) => current.filter((connection) => connection.provider !== provider))
      setMessage(
        result.providerRevokeReason === 'provider_error'
          ? "The connection was removed from Finance Planner, but we couldn't confirm the provider revoked access on their side. Transactions already imported remain in Finance Planner."
          : 'The connection was disconnected. Transactions already imported remain in Finance Planner.',
      )
      setDisconnectConfirming(false)
      setAttentionProvider(null)
      setScreen('overview')
    } catch (reason) {
      setAttentionError(reason instanceof Error ? reason.message : 'The connection could not be disconnected.')
    } finally {
      setBusy(false)
    }
  }

  const openSetup = () => {
    setSetupStep(1)
    setSearchTerm('')
    setCategory('popular')
    setSelectedInstitutionId(null)
    setAccountType('checking')
    setResolvingInstitution(null)
    setResolvedProviderInstitution(null)
    setSetupError('')
    setSetupOpen(true)
  }
  const closeSetup = useCallback(() => { if (!busy) { setSetupOpen(false); setSetupError('') } }, [busy])

  const openManualAccount = (hintedType: ConnectorAccountType = 'checking', hintedName = '') => {
    setManualName(hintedName)
    setManualAccountType(hintedType)
    setManualBalance('')
    setManualLimit('')
    setManualError('')
    setSetupOpen(false)
    setManualOpen(true)
  }
  const closeManualAccount = useCallback(() => { if (!busy) setManualOpen(false) }, [busy])

  const cancelInstitutionResolution = () => {
    setResolvingInstitution(null)
    setResolvingProvider(null)
    setSelectedInstitutionId(null)
    setResolvedProviderInstitution(null)
  }

  const finalizeInstitutionResolution = (match: ProviderInstitution) => {
    if (!resolvingInstitution) return
    setResolvedProviderInstitution(match)
    setSetupStep(nextSetupStepAfterInstitution(resolvingInstitution))
    setResolvingInstitution(null)
  }

  const chooseInstitution = (id: string) => {
    const institution = institutionById(id)
    if (!institution) return
    if (institutionAvailability(institution, providerStatus).unavailable) return
    setSetupError('')
    if (institution.provider === 'manual') {
      openManualAccount(defaultAccountTypeForInstitution(institution), institution.name === 'Virtuelles / manuelles Konto' ? '' : institution.name)
      return
    }
    setSelectedInstitutionId(id)
    setAccountType(defaultAccountTypeForInstitution(institution))
    // Always clear a previous resolution here, not just when re-entering the
    // 'ais' branch below -- otherwise picking a bank, resolving it, going
    // back, and choosing a different institution left the old resolved name
    // in state and it rendered as a stale, unrelated subtitle on the new
    // institution's account-type/confirmation steps.
    setResolvedProviderInstitution(null)
    if (institution.provider === 'ais') {
      // Enable Banking first, GoCardless second -- resolved once, here,
      // transparently, before any bank-specific network call (see
      // resolveAisProvider()). institutionAvailability() already guarantees
      // this is non-null by the time chooseInstitution can be reached for an
      // 'ais' institution. Fixed for the rest of this attempt: only the
      // explicit "try another connection method" fallback action can change
      // it, and only before startConnector() is ever called.
      const resolved = resolveAisProvider(providerStatus)
      if (!resolved) return
      // A directory from a previous resolution attempt against a different
      // provider (e.g. a prior fallback switch) must never be reused here --
      // the real institution catalogue that provider offers, not our static
      // picker entries, is the only thing that can be validated server-side,
      // and a generic entry like "Sparkasse" or "Volksbank / Raiffeisenbank"
      // cannot be mapped to one unique bank without guessing.
      const providerChanged = resolvingProvider !== resolved
      if (providerChanged) { setLiveInstitutions(null); setLiveInstitutionsError('') }
      setResolvingProvider(resolved)
      setResolvingInstitution(institution)
      setLiveInstitutionQuery(institution.name)
      // force: true when the resolved provider changed since the last
      // resolution -- liveInstitutions may still hold a truthy (even if
      // empty) result from the *previous* provider at this point (state
      // updates above haven't committed yet within this closure), and that
      // must never be reused as if it belonged to the new provider.
      void loadLiveInstitutions(resolved, { force: providerChanged })
      return
    }
    setSetupStep(nextSetupStepAfterInstitution(institution))
  }

  const saveManualAccount = async () => {
    const result = validateManualAccount({ name: manualName, accountType: manualAccountType, balanceInput: manualBalance, creditLimitInput: manualLimit })
    if (result.error) { setManualError(result.error); return }
    const id = `manual:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`
    const name = manualName.trim()
    if (manualAccountType === 'credit-card') {
      setBusy(true)
      setManualError('')
      try {
        // Amount owed, ledger balance, and available credit come from the
        // authoritative server-side COBOL banking core rather than local JS
        // arithmetic -- no local fallback calculation is stored if it fails.
        const normalized = await normalizeManualCreditCard({ providerBalanceCents: result.balanceCents, creditLimitCents: result.creditLimitCents })
        const account: Account = { id, name, type: 'credit-card', balanceCents: normalized.ledgerBalanceCents, currency: 'EUR', creditCard: { amountOwedCents: normalized.amountOwedCents, creditLimitCents: result.creditLimitCents, availableCreditCents: normalized.availableCreditCents, pendingAmountCents: normalized.pendingAmountCents } }
        onApply({ ...state, accounts: [...state.accounts, account] })
        setManualOpen(false)
        setMessage(`${name} was added as a manual account.`)
      } catch (reason) {
        setManualError(reason instanceof Error ? reason.message : 'The credit-card calculation failed.')
      } finally {
        setBusy(false)
      }
      return
    }
    const account: Account = { id, name, type: manualAccountType, balanceCents: result.balanceCents, currency: 'EUR' }
    onApply({ ...state, accounts: [...state.accounts, account] })
    setManualOpen(false)
    setMessage(`${account.name} was added as a manual account.`)
  }

  const toggleAccount = (accountId: string) => setSelectedAccountIds((current) => {
    const next = new Set(current)
    if (next.has(accountId)) next.delete(accountId); else next.add(accountId)
    return next
  })

  const cancelSync = () => {
    setPreviews([])
    setSelectedAccountIds(new Set())
    setScreen('overview')
  }

  const importPreview = () => {
    if (!selection.selectedCount) return
    setRollbackState(state)
    onApply(selectedPreviews.reduce((current, preview) => applySyncPreview(current, preview), state))
    const transactionCount = summary.transactions
    setPreviews([])
    setSelectedAccountIds(new Set())
    setScreen('overview')
    setMessage(`${transactionCount} transaction(s) and ${selection.selectedCount} selected account(s) were imported.`)
  }

  const readStatement = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setMessage('')
    setStatementPreview(null)
    try {
      if (file.size > MAX_STATEMENT_FILE_BYTES) throw new Error('The file is larger than 5 MB.')
      const parsed = parseStatement(await file.text(), file.name)
      setStatementFileName(file.name)
      setStatementPreview(buildStatementPreview(state, parsed))
      setScreen('statement-preview')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The statement could not be read.')
    }
  }
  const importStatement = () => {
    if (!statementPreview) return
    setRollbackState(state)
    onApply(applyStatementImport(state, statementPreview))
    setMessage(`${statementPreview.transactions.length} transaction(s) imported; ${statementPreview.duplicates} duplicate(s) skipped.`)
    setStatementPreview(null)
    setScreen('overview')
  }
  const cancelStatement = () => { setStatementPreview(null); setScreen('overview') }
  const rollback = () => { if (!rollbackState) return; onApply(rollbackState); setRollbackState(null); setMessage('The last import was fully reversed.') }

  const openAttention = (provider: ConnectorProvider) => { setAttentionProvider(provider); setDisconnectConfirming(false); setAttentionError(''); setScreen('attention') }
  const closeAttention = () => { setAttentionProvider(null); setDisconnectConfirming(false); setAttentionError(''); setScreen('overview') }

  const setupDialogRef = useDialog<HTMLDivElement>({ open: setupOpen, onClose: closeSetup })
  const manualDialogRef = useDialog<HTMLDivElement>({ open: manualOpen, onClose: closeManualAccount })

  return <section className="connections-feature" lang="en" data-connections-ready="true" aria-labelledby="connections-title">
    {screen === 'overview' && <OverviewScreen
      connections={connections}
      busy={busy}
      onConnect={openSetup}
      onRefresh={refreshAll}
      onOpenAttention={openAttention}
      onOpenManual={() => openManualAccount()}
      onImportStatement={() => fileInputRef.current?.click()}
    />}

    {screen === 'checking' && <CheckingScreen/>}

    {screen === 'sync-selection' && <SyncSelectionScreen
      accounts={discoveredAccounts}
      selectedAccountIds={selectedAccountIds}
      onToggle={toggleAccount}
      selection={selection}
      transactionsAvailable={summary.transactions}
      duplicates={summary.duplicates}
      pending={summary.pending}
      quality={averageQuality}
      warnings={qualityWarnings}
      onCancel={cancelSync}
      onImport={importPreview}
    />}

    {screen === 'attention' && attentionConnection && <AttentionScreen
      connection={attentionConnection}
      reason={attentionReason}
      busy={busy}
      confirming={disconnectConfirming}
      error={attentionError}
      onBack={closeAttention}
      onReconnect={() => void startProvider(attentionConnection.provider, { institutionId: attentionConnection.institutionId }, setAttentionError)}
      onDisconnectRequest={() => setDisconnectConfirming(true)}
      onDisconnectCancel={() => setDisconnectConfirming(false)}
      onDisconnectConfirm={() => void disconnect(attentionConnection.provider)}
    />}

    {screen === 'statement-preview' && statementPreview && <StatementPreviewScreen
      preview={statementPreview}
      fileName={statementFileName}
      onCancel={cancelStatement}
      onChooseAnother={() => { setStatementPreview(null); setScreen('overview'); fileInputRef.current?.click() }}
      onImport={importStatement}
    />}

    <label className="connections-hidden-file">
      <input ref={fileInputRef} type="file" accept=".csv,.xml,.camt,text/csv,application/xml,text/xml" onChange={readStatement}/>
    </label>

    {rollbackState && screen === 'overview' && <button type="button" className="secondary connections-rollback" onClick={rollback}><RotateCcw size={17}/>Undo last import</button>}
    {message && screen === 'overview' && <p className="status-message success-message" role="status">{message}</p>}
    {error && screen === 'overview' && <p className="status-message error-message" role="alert">{error}</p>}

    {setupOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSetup() }}>
      <section className="modal connections-setup-modal" role="dialog" aria-modal="true" aria-labelledby="connections-setup-title" ref={setupDialogRef} lang="en">
        {/* Content renders before the header in DOM order (visually reordered via CSS) so the
            dialog's initial-focus logic lands on the first useful control (e.g. the search field)
            instead of racing against native autoFocus, which fires during commit, before the
            dialog's own effect can capture "focus before open" for later restoration. */}
        <div className="connections-setup-content">
          {setupStep === 1 && (resolvingInstitution
            ? <InstitutionResolutionStep
                institution={resolvingInstitution}
                query={liveInstitutionQuery}
                onQuery={setLiveInstitutionQuery}
                results={filteredLiveInstitutions}
                loading={liveInstitutionsLoading}
                error={liveInstitutionsError}
                onBack={cancelInstitutionResolution}
                onChoose={finalizeInstitutionResolution}
                gocardlessFallbackAvailable={gocardlessFallbackAvailable}
                onUseGoCardlessFallback={useGoCardlessFallback}
              />
            : <InstitutionStep
                searchTerm={searchTerm}
                onSearch={setSearchTerm}
                category={category}
                onCategory={setCategory}
                institutions={filteredInstitutions}
                providerStatus={providerStatus}
                onRetryProviderStatus={loadProviderStatus}
                onChoose={chooseInstitution}
              />)}

          {setupStep === 2 && selectedInstitution && <AccountTypeStep
            institution={selectedInstitution}
            resolvedInstitutionName={resolvedProviderInstitution?.name}
            accountType={accountType}
            onChoose={(next) => { setAccountType(next); setSetupStep(3) }}
          />}

          {setupStep === 3 && selectedInstitution && <RedirectConfirmationStep
            institution={selectedInstitution}
            resolvedInstitutionName={resolvedProviderInstitution?.name}
            busy={busy}
            error={setupError}
            providerDescriptor={(() => { const provider = effectiveProvider(); return provider ? providerDescriptorFor(provider, providerStatus) : undefined })()}
            onCancel={closeSetup}
            onConfirm={() => { const provider = effectiveProvider(); if (provider) void startProvider(provider, connectorContext(), setSetupError) }}
          />}
        </div>

        <div className="connections-setup-header">
          <button type="button" className="connections-icon-button" aria-label="Back" disabled={(setupStep === 1 && !resolvingInstitution) || busy} onClick={() => {
            setSetupError('')
            if (setupStep === 1 && resolvingInstitution) { cancelInstitutionResolution(); return }
            setSetupStep(setupStep === 3 ? previousSetupStepFromConfirmation(selectedInstitution) : 1)
          }}><ArrowLeft size={18}/></button>
          <p className="connections-step-label">Step {setupStep} of 3</p>
          <button type="button" className="connections-icon-button" aria-label="Close" disabled={busy} onClick={closeSetup}><X size={18}/></button>
        </div>
        <div className="connections-setup-progress" aria-hidden="true"><span className="active"/><span className={setupStep >= 2 ? 'active' : ''}/><span className={setupStep === 3 ? 'active' : ''}/></div>
      </section>
    </div>}

    {manualOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeManualAccount() }}>
      <section className="modal connections-manual-modal" role="dialog" aria-modal="true" aria-labelledby="connections-manual-title" ref={manualDialogRef} lang="en">
        <div className="connections-manual-handle" aria-hidden="true"/>
        <div className="connections-setup-header">
          <button type="button" className="connections-icon-button" aria-label="Back" disabled={busy} onClick={closeManualAccount}><ArrowLeft size={18}/></button>
          <h2 id="connections-manual-title">Add manual account</h2>
          <span/>
        </div>
        <label className="connections-field"><span>Account name</span><input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Everyday credit card"/></label>
        <label className="connections-field"><span>Account type</span>
          <select value={manualAccountType} onChange={(event) => setManualAccountType(event.target.value as ConnectorAccountType)}>
            {ACCOUNT_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="connections-field"><span>Current balance</span><div className="connections-currency-input"><input inputMode="decimal" value={manualBalance} onChange={(event) => setManualBalance(event.target.value)} placeholder="0.00"/><span>EUR</span></div></label>
        {manualAccountType === 'credit-card' && <label className="connections-field"><span>Credit limit (optional)</span><div className="connections-currency-input"><input inputMode="decimal" value={manualLimit} onChange={(event) => setManualLimit(event.target.value)} placeholder="0.00"/><span>EUR</span></div></label>}
        <label className="connections-field"><span>Currency</span><div className="connections-currency-input connections-currency-locked"><span>EUR &ndash; Euro</span><Lock size={16}/></div></label>
        <div className="connections-privacy-box"><ShieldCheck size={17}/><span>Finance Planner never requests card number, expiry, CVC, PIN or login credentials.</span></div>
        {manualError && <p className="status-message error-message" role="alert">{manualError}</p>}
        <div className="connections-modal-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void saveManualAccount()}>{busy && manualAccountType === 'credit-card' ? 'Calculating…' : 'Save account'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={closeManualAccount}>Cancel</button>
        </div>
      </section>
    </div>}
  </section>
}

interface OverviewScreenProps {
  connections: ConnectorConnection[]
  busy: boolean
  onConnect: () => void
  onRefresh: () => void
  onOpenAttention: (provider: ConnectorProvider) => void
  onOpenManual: () => void
  onImportStatement: () => void
}

function OverviewScreen({ connections, busy, onConnect, onRefresh, onOpenAttention, onOpenManual, onImportStatement }: OverviewScreenProps) {
  if (connections.length === 0) return <div className="connections-empty">
    <header className="connections-header"><h2 id="connections-title">Connections</h2><p>Securely connect your financial accounts.</p></header>
    <div className="connections-empty-hero">
      <div className="connections-empty-icon"><ShieldCheck size={26}/></div>
      <h2>Connect your financial accounts</h2>
      <p>Finance Planner redirects to official provider sites and does not request your online-banking password.</p>
      <button type="button" className="primary" onClick={onConnect}><Link2 size={17}/> Connect an account</button>
    </div>
    <button type="button" className="connections-option-row" onClick={onOpenManual}><span className="connections-option-icon"><Landmark size={19}/></span><span><strong>Add a manual account</strong><small>Track balances and transactions manually</small></span><ChevronRight size={18}/></button>
    <button type="button" className="connections-option-row" onClick={onImportStatement}><span className="connections-option-icon"><FileText size={19}/></span><span><strong>Import a statement</strong><small>Upload a file from your provider</small></span><ChevronRight size={18}/></button>
    <div className="connections-trust">
      <p className="connections-trust-title">Why you can trust Finance Planner</p>
      <div className="connections-trust-row"><ShieldCheck size={18}/><div><strong>Redirect-based setup</strong><span>We redirect you to official provider sites using secure connections.</span></div></div>
      <div className="connections-trust-row"><RefreshCw size={18}/><div><strong>Reversible connection</strong><span>You can disconnect at any time. You&apos;re always in control.</span></div></div>
      <div className="connections-trust-row"><Info size={18}/><div><strong>Provider availability may vary</strong><span>Not all providers are available in every country or region.</span></div></div>
    </div>
  </div>

  return <div className="connections-overview">
    <header className="connections-header"><div><h2 id="connections-title">Connections</h2><p>Manage your connected accounts and data sources.</p></div></header>
    <div className="connections-actions">
      <button type="button" className="primary" onClick={onConnect}><Link2 size={17}/> Connect account</button>
      <button type="button" className="secondary" disabled={busy} onClick={onRefresh}><RefreshCw size={17}/> {busy ? 'Refreshing…' : 'Refresh all'}</button>
    </div>
    <p className="connections-section-label">Connected accounts</p>
    <div className="connections-list">
      {connections.map((connection) => {
        const needsAttention = connectionNeedsAttention(connection)
        const days = consentDaysRemaining(connection)
        const reason = connectionAttentionReason(connection)
        const detail = needsAttention
          ? (connection.error || (reason && ATTENTION_REASON_COPY[reason].title) || 'Reauthorization required')
          : connection.lastSyncAt
            ? `Last sync: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(connection.lastSyncAt))}`
            : days !== null ? `Consent valid until ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(connection.consentExpiresAt as string))}` : 'Connected'
        const rowContent = <>
          <span className="connections-row-icon">{connection.provider === 'paypal' ? <Wallet size={19}/> : <Landmark size={19}/>}</span>
          <span className="connections-row-body">
            <strong>{connection.displayName}</strong>
            <span className={needsAttention ? 'connections-status connections-status--attention' : 'connections-status connections-status--ok'}>{needsAttention ? 'Connection needs attention' : 'Connected'}</span>
            <small>{detail}</small>
          </span>
          <span className={needsAttention ? 'connections-badge connections-badge--attention' : 'connections-badge connections-badge--ok'} aria-hidden="true">{needsAttention ? <AlertTriangle size={16}/> : <CheckCircle2 size={16}/>}</span>
          {needsAttention && <ChevronRight size={18} aria-hidden="true"/>}
        </>
        // Every connection opens the manage/attention screen -- a healthy
        // connection needs a way to reach Disconnect too, not just a broken
        // one (previously only needsAttention rows were clickable, so a
        // working connection had no Disconnect path anywhere in the UI).
        return <button type="button" key={connection.id} className={needsAttention ? 'connections-row connections-row--attention' : 'connections-row'} onClick={() => onOpenAttention(connection.provider)}>{rowContent}{!needsAttention && <ChevronRight size={18} aria-hidden="true"/>}</button>
      })}
    </div>
    <p className="connections-section-label">Other options</p>
    <button type="button" className="connections-option-row" onClick={onOpenManual}><span className="connections-option-icon"><Landmark size={19}/></span><span><strong>Manual account</strong><small>Add an account manually</small></span><ChevronRight size={18}/></button>
    <button type="button" className="connections-option-row" onClick={onImportStatement}><span className="connections-option-icon"><FileText size={19}/></span><span><strong>Statement import</strong><small>Import transactions from a statement</small></span><ChevronRight size={18}/></button>
  </div>
}

function CheckingScreen() {
  return <div className="connections-checking" role="status" aria-live="polite">
    <div className="connections-checking-spinner" aria-hidden="true"/>
    <h2>Checking your connection</h2>
    <p>We&apos;re confirming what your provider returned and loading available accounts. This does not mean your data has been imported yet.</p>
  </div>
}

interface InstitutionStepProps {
  searchTerm: string
  onSearch: (value: string) => void
  category: InstitutionCategory
  onCategory: (category: InstitutionCategory) => void
  institutions: ReturnType<typeof filterInstitutions>
  providerStatus: ProviderStatus
  onRetryProviderStatus: () => void
  onChoose: (id: string) => void
}

function InstitutionStep({ searchTerm, onSearch, category, onCategory, institutions, providerStatus, onRetryProviderStatus, onChoose }: InstitutionStepProps) {
  return <>
    <h2 id="connections-setup-title" className="connections-setup-title">Choose your institution</h2>
    {providerStatus.status === 'error' && <p className="status-message error-message" role="alert">
      We couldn&apos;t check which providers are available right now. Manual accounts are unaffected.
      <button type="button" className="connections-text-button connections-retry-button" onClick={onRetryProviderStatus}>Retry</button>
    </p>}
    <label className="connections-search"><Search size={18}/><input value={searchTerm} onChange={(event) => onSearch(event.target.value)} placeholder="Search institutions"/>{searchTerm && <button type="button" aria-label="Clear search" onClick={() => onSearch('')}><X size={16}/></button>}</label>
    <div className="connections-categories" role="tablist" aria-label="Institution category">
      {CATEGORY_OPTIONS.map((option) => <button type="button" role="tab" aria-selected={category === option.id} key={option.id} className={category === option.id ? 'active' : ''} onClick={() => onCategory(option.id)}>{option.label}</button>)}
    </div>
    <div className="connections-institution-list">
      {institutions.map((institution) => {
        const availability = institutionAvailability(institution, providerStatus)
        return <button type="button" key={institution.id} className="connections-institution-row" disabled={availability.unavailable} aria-disabled={availability.unavailable} onClick={() => onChoose(institution.id)}>
          <span className="connections-row-icon"><InstitutionIcon institution={institution}/></span>
          <span className="connections-institution-name">
            {institution.name}
            {availability.unavailable && <small className="connections-unavailable-badge">{availability.reason}</small>}
          </span>
          {!availability.unavailable && <ChevronRight size={18}/>}
        </button>
      })}
      {institutions.length === 0 && <p className="connections-empty-copy">No institution matches your search. Try a different name, BIC or bank code, or use a manual account.</p>}
    </div>
    <p className="connections-footnote"><Info size={15}/> Provider availability depends on your institution and region.</p>
  </>
}

interface InstitutionResolutionStepProps {
  institution: Institution
  query: string
  onQuery: (value: string) => void
  results: ProviderInstitution[]
  loading: boolean
  error: string
  onBack: () => void
  onChoose: (match: ProviderInstitution) => void
  gocardlessFallbackAvailable: boolean
  onUseGoCardlessFallback: () => void
}

function InstitutionResolutionStep({ institution, query, onQuery, results, loading, error, onBack, onChoose, gocardlessFallbackAvailable, onUseGoCardlessFallback }: InstitutionResolutionStepProps) {
  // Never names the aggregator to the user -- bank-centric copy throughout,
  // matching how the rest of the picker never says "GoCardless"/"Enable
  // Banking" either. The fallback affordance below is the one place a
  // provider switch is ever user-visible, and even there it's phrased as a
  // connection method, not a brand name.
  const showFallback = gocardlessFallbackAvailable && !loading && (error || results.length === 0)
  return <>
    <button type="button" className="connections-back connections-live-search-back" onClick={onBack}><ArrowLeft size={18}/> All institutions</button>
    <h2 id="connections-setup-title" className="connections-setup-title">Find your {institution.name} branch</h2>
    <p className="connections-setup-subtitle">Finance Planner connects to the exact bank on file — never a guess. Search and select it below.</p>
    <label className="connections-search connections-live-search"><Search size={18}/><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by bank name or BIC"/>{query && <button type="button" aria-label="Clear search" onClick={() => onQuery('')}><X size={16}/></button>}</label>
    <div className="connections-institution-list" aria-live="polite">
      {loading && <p className="connections-empty-copy">Loading banks…</p>}
      {!loading && error && <p className="status-message error-message" role="alert">{error}</p>}
      {!loading && !error && results.map((match) => <button type="button" key={match.id} className="connections-institution-row" onClick={() => onChoose(match)}>
        <span className="connections-row-icon"><InstitutionMark id={match.id} name={match.name} size={20}/></span>
        <span className="connections-institution-name">{match.name}{match.bic && <small className="connections-institution-bic">{match.bic}</small>}</span>
        <ChevronRight size={18}/>
      </button>)}
      {!loading && !error && results.length === 0 && <p className="connections-empty-copy">No bank matches your search. Try a different name or BIC.</p>}
    </div>
    {showFallback && <p className="status-message connections-fallback-message">
      Connection through the preferred bank interface is currently unavailable.{' '}
      <button type="button" className="connections-text-button connections-retry-button" onClick={onUseGoCardlessFallback}>Try another connection method</button>
    </p>}
  </>
}

interface AccountTypeStepProps {
  institution: { id: string; name: string; kind: string }
  resolvedInstitutionName?: string
  accountType: ConnectorAccountType
  onChoose: (accountType: ConnectorAccountType) => void
}

function AccountTypeStep({ institution, resolvedInstitutionName, accountType, onChoose }: AccountTypeStepProps) {
  return <>
    <div className="connections-institution-banner">
      <span className="connections-row-icon"><InstitutionIcon institution={institution}/></span>
      <span className="connections-row-body"><strong>{institution.name}</strong>{resolvedInstitutionName && resolvedInstitutionName !== institution.name && <small>{resolvedInstitutionName}</small>}</span>
    </div>
    <h2 id="connections-setup-title" className="connections-setup-title">What would you like to connect?</h2>
    <p className="connections-setup-subtitle">Choose the type of account you want to add from this institution.</p>
    <div className="connections-account-type-list" role="radiogroup" aria-label="Account type">
      {ACCOUNT_TYPE_OPTIONS.map((option) => {
        const Icon = option.id === 'savings' ? PiggyBank : option.id === 'credit-card' ? CreditCard : option.id === 'investment' ? TrendingUp : Wallet
        const selected = accountType === option.id
        return <button type="button" key={option.id} role="radio" aria-checked={selected} className={`connections-account-type-row${selected ? ' connections-account-type-row--selected' : ''}`} onClick={() => onChoose(option.id)}>
          <span className="connections-row-icon"><Icon size={19}/></span>
          <span><strong>{option.label}</strong><small>{option.description}</small></span>
          <span className={`connections-radio${selected ? ' connections-radio--checked' : ''}`} aria-hidden="true">{selected && <CheckCircle2 size={18}/>}</span>
        </button>
      })}
    </div>
    <p className="connections-footnote"><Info size={15}/> Available types depend on the institution.</p>
  </>
}

interface RedirectConfirmationStepProps {
  institution: { id: string; name: string; provider: string; kind: string }
  resolvedInstitutionName?: string
  busy: boolean
  error: string
  providerDescriptor?: ProviderDescriptor
  onCancel: () => void
  onConfirm: () => void
}

function RedirectConfirmationStep({ institution, resolvedInstitutionName, busy, error, providerDescriptor, onCancel, onConfirm }: RedirectConfirmationStepProps) {
  if (institution.provider === 'paypal') {
    const mode = providerDescriptor?.mode
    const unavailable = providerDescriptor ? !providerDescriptor.available || !providerDescriptor.configured : false
    if (unavailable) return <div className="connections-confirmation connections-confirmation--paypal">
      <div className="connections-confirmation-avatar"><InstitutionMark id="paypal" name="PayPal" size={34}/></div>
      <p className="connections-confirmation-provider-name">PayPal</p>
      <h2 id="connections-setup-title" className="connections-setup-title">PayPal isn&apos;t available right now</h2>
      <p className="connections-setup-subtitle">{providerDescriptor?.reason || 'This deployment has not configured PayPal yet.'}</p>
      <div className="connections-modal-actions"><button type="button" className="secondary" onClick={onCancel}>Close</button></div>
    </div>

    // Owner mode uses the deployment owner's own configured PayPal reporting
    // credentials -- there is no third-party PayPal login here, so the copy
    // must say that plainly instead of the generic "redirected to PayPal to
    // authenticate" claim, which would misrepresent what actually happens.
    const ownerMode = mode === 'owner'
    return <div className="connections-confirmation connections-confirmation--paypal">
      <div className="connections-confirmation-avatar"><InstitutionMark id="paypal" name="PayPal" size={34}/></div>
      <p className="connections-confirmation-provider-name">PayPal{ownerMode ? ' · Owner connection' : ''}</p>
      <h2 id="connections-setup-title" className="connections-setup-title">{ownerMode ? 'Continue with the owner PayPal connection' : 'Continue to PayPal'}</h2>
      <p className="connections-setup-subtitle">{ownerMode
        ? 'This uses the deployment owner’s configured PayPal reporting connection. Only an authorized Finance Planner owner user can access it — it does not open a PayPal login for your own account.'
        : 'You’ll be redirected to PayPal’s hosted onboarding to authorize your own PayPal account.'}</p>
      <ul className="connections-confirmation-list">
        {ownerMode ? <>
          <li><ShieldCheck size={19}/><span>No PayPal login happens in this flow; access is scoped to the deployment&apos;s configured owner account.</span></li>
          <li><Info size={19}/><span>The data we can access depends on what PayPal&apos;s reporting API supports.</span></li>
        </> : <>
          <li><ShieldCheck size={19}/><span>Authentication happens on PayPal&apos;s site. Finance Planner does not receive your PayPal password.</span></li>
          <li><Undo2 size={19}/><span>After you authorize, you&apos;ll return here automatically.</span></li>
        </>}
      </ul>
      <div className="connections-scope-box">
        <p className="connections-scope-title">Scope</p>
        <div className="connections-scope-row"><CreditCard size={17}/><span>Account information</span><span className="connections-scope-status"><BadgeCheck size={16}/> As supported</span></div>
        <div className="connections-scope-row"><Banknote size={17}/><span>Transactions</span><span className="connections-scope-status"><BadgeCheck size={16}/> As supported</span></div>
      </div>
      {error && <p className="status-message error-message" role="alert">{error}</p>}
      <div className="connections-modal-actions">
        <button type="button" className="primary" disabled={busy} onClick={onConfirm}>{busy ? 'Preparing redirect…' : ownerMode ? 'Continue with owner connection' : 'Continue to PayPal'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <p className="connections-footnote">Provider availability and supported data types may change without notice and are subject to each provider&apos;s terms.</p>
    </div>
  }

  return <div className="connections-confirmation">
    <div className="connections-institution-banner">
      <span className="connections-row-icon"><InstitutionIcon institution={institution}/></span>
      <span className="connections-row-body"><strong>{institution.name}</strong>{resolvedInstitutionName && resolvedInstitutionName !== institution.name && <small>{resolvedInstitutionName}</small>}</span>
    </div>
    <h2 id="connections-setup-title" className="connections-setup-title">Continue to your provider</h2>
    <ul className="connections-confirmation-list">
      <li><ShieldCheck size={19}/><span>Authentication will take place on your provider&apos;s official site.<br/><span className="connections-muted">Finance Planner does not receive your online-banking password.</span></span></li>
      <li><Undo2 size={19}/><span>Once complete, you&apos;ll be returned to Finance Planner.</span></li>
    </ul>
    <div className="connections-scope-box">
      <p className="connections-scope-title">What you&apos;re allowing</p>
      <div className="connections-scope-row"><CreditCard size={17}/><span>Account information</span></div>
      <div className="connections-scope-row"><TrendingUp size={17}/><span>Balances</span></div>
      <div className="connections-scope-row"><FileText size={17}/><span>Transactions</span></div>
      <p className="connections-scope-footnote">Only as supported and consented.</p>
    </div>
    {error && <p className="status-message error-message" role="alert">{error}</p>}
    <div className="connections-modal-actions">
      <button type="button" className="primary" disabled={busy} onClick={onConfirm}>{busy ? 'Preparing redirect…' : 'Continue securely'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    <p className="connections-footnote">Provider availability depends on institution. Finance Planner never stores your credentials.</p>
  </div>
}

interface SyncSelectionScreenProps {
  accounts: Account[]
  selectedAccountIds: Set<string>
  onToggle: (accountId: string) => void
  selection: { selectedCount: number; totalCount: number }
  transactionsAvailable: number
  duplicates: number
  pending: number
  quality: number
  warnings: string[]
  onCancel: () => void
  onImport: () => void
}

function SyncSelectionScreen({ accounts, selectedAccountIds, onToggle, selection, transactionsAvailable, duplicates, pending, quality, warnings, onCancel, onImport }: SyncSelectionScreenProps) {
  return <div className="connections-sync-screen">
    <header className="connections-subpage-header"><button type="button" className="connections-back" onClick={onCancel}><ArrowLeft size={18}/> Back</button><h2>Choose accounts</h2></header>
    <p className="connections-setup-subtitle">We discovered the following accounts. Select the ones you want to import.</p>
    <div className="connections-account-select-list">
      {accounts.map((account) => <label className="connections-account-select-row" key={account.id}>
        <input type="checkbox" checked={selectedAccountIds.has(account.id)} onChange={() => onToggle(account.id)}/>
        <span className="connections-row-icon">{account.type === 'credit-card' ? <CreditCard size={18}/> : <Landmark size={18}/>}</span>
        <span><strong>{account.name}</strong><small>{account.type === 'credit-card' ? 'Credit card' : account.type === 'savings' ? 'Savings' : account.type === 'investment' ? 'Investment' : 'Checking'}</small></span>
        <span className="connections-account-select-balance"><strong>{formatEuro(account.type === 'credit-card' && account.creditCard ? -account.creditCard.amountOwedCents : account.balanceCents)}</strong><small>Current balance</small></span>
      </label>)}
      {accounts.length === 0 && <p className="connections-empty-copy">No accounts were discovered for the accounts you selected.</p>}
    </div>
    <div className="connections-summary-box">
      <p className="connections-scope-title">Summary</p>
      <div className="connections-summary-row"><span>Accounts selected</span><strong>{selection.selectedCount} of {selection.totalCount}</strong></div>
      <div className="connections-summary-row"><span>Transactions available</span><strong>{transactionsAvailable}</strong></div>
      <div className="connections-summary-row"><span>Duplicates skipped</span><strong>{duplicates}</strong></div>
      <div className="connections-summary-row"><span>Pending excluded</span><strong>{pending}</strong></div>
      <div className="connections-summary-row"><span>Import quality</span><strong>{selection.selectedCount ? `${quality}%` : '—'}</strong></div>
      {warnings.length > 0 && <p className="connections-scope-footnote">{warnings.join(' ')}</p>}
    </div>
    <div className="connections-info-box"><Info size={17}/><span>Balances are for review only and may change. No data has been added yet.</span></div>
    <div className="connections-modal-actions connections-modal-actions--page">
      <button type="button" className="primary" disabled={!selection.selectedCount} onClick={onImport}>Import selected accounts</button>
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </div>
  </div>
}

interface AttentionScreenProps {
  connection: ConnectorConnection
  reason: ReturnType<typeof connectionAttentionReason>
  busy: boolean
  confirming: boolean
  error: string
  onBack: () => void
  onReconnect: () => void
  onDisconnectRequest: () => void
  onDisconnectCancel: () => void
  onDisconnectConfirm: () => void
}

function AttentionScreen({ connection, reason, busy, confirming, error, onBack, onReconnect, onDisconnectRequest, onDisconnectCancel, onDisconnectConfirm }: AttentionScreenProps) {
  const copy = reason ? ATTENTION_REASON_COPY[reason] : null
  return <div className="connections-attention-screen">
    <header className="connections-subpage-header"><button type="button" className="connections-back" onClick={onBack}><ArrowLeft size={18}/> Back</button><h2>Connections</h2></header>
    {reason
      ? <>
        <div className="connections-attention-icon"><AlertTriangle size={28}/></div>
        <h2 className="connections-attention-title">Connection needs attention</h2>
        <p className="connections-setup-subtitle connections-center">We&apos;re having trouble maintaining this connection. Please reconnect to keep your data up to date.</p>
      </>
      : <>
        <div className="connections-attention-icon"><CheckCircle2 size={28}/></div>
        <h2 className="connections-attention-title">Manage connection</h2>
        <p className="connections-setup-subtitle connections-center">This connection is working normally. You can reconnect it or disconnect it below.</p>
      </>}
    <div className="connections-row connections-row--static"><span className="connections-row-icon">{connection.provider === 'paypal' ? <Wallet size={19}/> : <Landmark size={19}/>}</span><span className="connections-row-body"><strong>{connection.displayName}</strong></span></div>

    {copy && <section className="connections-reason-section" aria-labelledby="connections-reason-title">
      <p id="connections-reason-title" className="connections-section-label">Reason</p>
      <div className="connections-reason-card"><RefreshCw size={19}/><div><strong>{copy.title}</strong><span>{copy.description}</span></div></div>
    </section>}
    <p className="connections-setup-subtitle">Your previously imported transactions will remain in Finance Planner unless you explicitly remove this account through a supported workflow.</p>
    {error && <p className="status-message error-message" role="alert">{error}</p>}

    {!confirming ? <div className="connections-modal-actions connections-modal-actions--page">
      <button type="button" className="primary" disabled={busy} onClick={onReconnect}><RefreshCw size={17}/> Reconnect</button>
      <button type="button" className="connections-destructive-button" disabled={busy} onClick={onDisconnectRequest}><Unplug size={17}/> Disconnect</button>
    </div> : <div className="connections-confirm-disconnect" role="alertdialog" aria-labelledby="connections-disconnect-confirm-title">
      <p id="connections-disconnect-confirm-title"><strong>Disconnect {connection.displayName}?</strong> Transactions already imported will stay in Finance Planner; only the live connection is removed.</p>
      <div className="connections-modal-actions">
        <button type="button" className="connections-destructive-button" disabled={busy} onClick={onDisconnectConfirm}>{busy ? 'Disconnecting…' : 'Yes, disconnect'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onDisconnectCancel}>Cancel</button>
      </div>
    </div>}
    <p className="connections-footnote">Connection availability and data access are provided by our approved partners and may change at any time.</p>
  </div>
}

interface StatementPreviewScreenProps {
  preview: StatementPreview
  fileName: string
  onCancel: () => void
  onChooseAnother: () => void
  onImport: () => void
}

function StatementPreviewScreen({ preview, fileName, onCancel, onChooseAnother, onImport }: StatementPreviewScreenProps) {
  const reviewRequired = preview.rejected > 0 || preview.transactions.some((transaction) => transaction.category === 'Unkategorisiert')
  return <div className="connections-statement-screen">
    <header className="connections-subpage-header"><button type="button" className="connections-back" onClick={onCancel}><ArrowLeft size={18}/> Back</button><h2>Statement import preview</h2></header>
    <div className="connections-file-card"><span className="connections-row-icon"><FileUp size={19}/></span><div><strong>{fileName || `${preview.format.toUpperCase()} statement`}</strong><small>Supported format: CSV / CAMT</small></div></div>
    <div className="connections-institution-banner"><span className="connections-row-icon"><Landmark size={18}/></span><strong>{preview.account.name}</strong></div>
    <div className="connections-stat-row">
      <div className="connections-stat"><span>Detected transactions</span><strong>{preview.transactions.length}</strong></div>
      <div className="connections-stat"><span>Duplicates</span><strong>{preview.duplicates}</strong></div>
      <div className="connections-stat"><span>Rejected rows</span><strong className={preview.rejected ? 'connections-stat-warning' : ''}>{preview.rejected}</strong></div>
      {reviewRequired && <span className="connections-review-pill">Review required</span>}
    </div>
    <p className="connections-section-label">Preview (first {Math.min(3, preview.transactions.length)} of {preview.transactions.length} transactions)</p>
    <table className="connections-preview-table">
      <thead><tr><th>Date</th><th>Description</th><th>Amount (EUR)</th></tr></thead>
      <tbody>{preview.transactions.slice(0, 3).map((transaction) => <tr key={transaction.id}><td>{transaction.date}</td><td>{transaction.description}</td><td className={transaction.type === 'income' ? 'connections-amount-income' : 'connections-amount-expense'}>{transaction.type === 'income' ? '+' : '-'}{formatEuro(transaction.amountCents)}</td></tr>)}</tbody>
    </table>
    <div className="connections-info-box"><Info size={17}/><span><strong>Review before you import.</strong> Please review the transactions above. Importing happens only after your confirmation.</span></div>
    <div className="connections-modal-actions connections-modal-actions--page">
      <button type="button" className="primary" disabled={!preview.transactions.length} onClick={onImport}><FileUp size={16}/> Import reviewed transactions</button>
      <button type="button" className="secondary" onClick={onChooseAnother}>Choose another file</button>
      <button type="button" className="connections-text-button" onClick={onCancel}>Cancel</button>
    </div>
  </div>
}
