export const CONNECTOR_RETURN_ATTEMPT_PARAM = 'fp_connection_attempt'

const CHANNEL_NAME = 'finance-planner-connector-return-v1'
const PENDING_STORAGE_KEY = 'finance-planner-connector-pending-v1'
const RETURN_STORAGE_PREFIX = 'finance-planner-connector-return-v1:'
const ATTEMPT_MAX_AGE_MS = 20 * 60 * 1000
// Popup-context proof (added 2026-08-25, PR #154 review): a same-origin
// browsing context created via window.open() receives a ONE-TIME CLONE of
// the opener's sessionStorage at creation time (distinct from localStorage,
// which is origin-wide and continuously shared) -- see
// beginConnectorPopupAttempt() for how this key is written immediately
// before window.open() and removed from the opener immediately after, so
// only the freshly-created popup's own sessionStorage retains it. sessionStorage
// itself stays scoped per (browsing context, origin), so the popup keeps its
// own Finance-Planner-origin storage area, marker included, intact across
// its round trip through the cross-origin provider. See
// publishConnectorReturnFromPopup() for how this proves a returning
// document is genuinely that popup, not merely a tab carrying a
// similar-looking URL.
const POPUP_ORIGIN_MARKER_KEY = 'finance-planner-connector-popup-origin-v1'

export interface ConnectorReturnSignal {
  type: 'finance-planner:connector-return'
  attemptId: string
  provider?: string
  error?: string
}

interface PendingConnectorAttempt {
  attemptId: string
  provider: string
  createdAt: number
}

export interface ConnectorPopupAttempt extends PendingConnectorAttempt {
  popup: Window
}

function validAttemptId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}

// The bridge's whole security story rests on "only bounded callback
// metadata crosses this boundary" -- provider must be one of Finance
// Planner's own known connector ids (never an arbitrary/attacker-chosen
// string) and error must look like a short machine error code, never
// free text, HTML, a URL, or anything else that could carry
// error_description-shaped or injected content.
const VALID_PROVIDERS = new Set(['enablebanking', 'gocardless', 'finapi', 'paypal'])
function validProvider(value: unknown): value is string {
  return typeof value === 'string' && VALID_PROVIDERS.has(value)
}
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
function validErrorCode(value: unknown): value is string {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value)
}

function createAttemptId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function readPendingAttempt(): PendingConnectorAttempt | null {
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingConnectorAttempt>
    if (!validAttemptId(parsed.attemptId) || typeof parsed.provider !== 'string' || !parsed.provider || !Number.isFinite(parsed.createdAt)) {
      sessionStorage.removeItem(PENDING_STORAGE_KEY)
      return null
    }
    if (Date.now() - Number(parsed.createdAt) > ATTEMPT_MAX_AGE_MS) {
      sessionStorage.removeItem(PENDING_STORAGE_KEY)
      localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${parsed.attemptId}`)
      return null
    }
    return { attemptId: parsed.attemptId, provider: parsed.provider, createdAt: Number(parsed.createdAt) }
  } catch {
    try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch { /* best-effort */ }
    return null
  }
}

function parseSignal(value: unknown): ConnectorReturnSignal | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ConnectorReturnSignal>
  if (candidate.type !== 'finance-planner:connector-return' || !validAttemptId(candidate.attemptId)) return null
  if (candidate.provider !== undefined && !validProvider(candidate.provider)) return null
  if (candidate.error !== undefined && !validErrorCode(candidate.error)) return null
  if (!candidate.provider && !candidate.error) return null
  return {
    type: 'finance-planner:connector-return',
    attemptId: candidate.attemptId,
    ...(candidate.provider ? { provider: candidate.provider } : {}),
    ...(candidate.error ? { error: candidate.error } : {}),
  }
}

export function beginConnectorPopupAttempt(provider: string): ConnectorPopupAttempt {
  const normalizedProvider = String(provider || '').trim()
  if (!normalizedProvider) throw new Error('A connector provider is required.')
  const attemptId = createAttemptId()
  // Written immediately before window.open() so the new browsing context's
  // one-time sessionStorage clone picks it up, then removed from THIS tab
  // right after -- see POPUP_ORIGIN_MARKER_KEY above. Best-effort: if this
  // write fails, the popup simply won't carry the marker, and its return is
  // then treated like any other non-popup page load (fails closed, never a
  // false positive) -- it does not block opening the popup itself.
  try { sessionStorage.setItem(POPUP_ORIGIN_MARKER_KEY, attemptId) } catch { /* best-effort */ }
  const popup = window.open('about:blank', `finance-planner-provider-${attemptId}`, 'popup,width=720,height=820,resizable=yes,scrollbars=yes')
  try { sessionStorage.removeItem(POPUP_ORIGIN_MARKER_KEY) } catch { /* best-effort */ }
  // Never silently fall back to same-tab navigation. Same-tab provider
  // redirects unload the SPA and intentionally destroy the memory-only vault
  // key, which is exactly the re-unlock regression this bridge exists to
  // avoid. A blocked popup is therefore a visible/retryable start failure,
  // before /start is contacted and before an OAuth nonce is created.
  if (!popup) throw new Error('Bank authorization needs a separate secure window. Allow pop-ups for Finance Planner and try again.')

  const pending: PendingConnectorAttempt = { attemptId, provider: normalizedProvider, createdAt: Date.now() }
  // The original tab must be able to prove that a later popup return belongs
  // to an attempt it actually started. If sessionStorage is unavailable we
  // fail closed and do not contact the provider at all; otherwise a random
  // same-origin page carrying fp_connection_attempt could be accepted without
  // a durable tab-local binding. No password/key/provider token is stored --
  // this record is only a high-entropy attempt id, provider id and timestamp.
  try {
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending))
  } catch {
    try { popup.close() } catch { /* best-effort */ }
    throw new Error('Bank authorization could not create a secure return binding in this browser. Check site-storage permissions and try again.')
  }

  try {
    popup.document.title = 'Finance Planner — Bank authorization'
    popup.document.body.textContent = 'Preparing secure bank authorization…'
  } catch {
    // about:blank may already have navigated or a hardened browser may block
    // document access; the popup itself is still valid and can be navigated.
  }
  return { ...pending, popup }
}

export function navigateConnectorPopup(attempt: ConnectorPopupAttempt, redirectUrl: string): void {
  const target = new URL(redirectUrl)
  if (target.protocol !== 'https:') throw new Error('The connector did not return a secure redirect address.')
  attempt.popup.location.replace(target.toString())
}

// Called on an explicit, synchronous user action (Cancel, Back, closing the
// setup dialog, switching institutions, or a manual "Try again") -- unlike
// clearPendingConnectorAttempt() on logout, this always runs deterministically
// and immediately, with no network round trip to race against. It closes
// the real popup window and removes this tab's own bridge records
// (sessionStorage binding + any already-buffered localStorage return), but
// -- same caveat as logout -- it has no server-side effect. If the provider
// popup had already progressed far enough to reach Finance Planner's own
// callback route before this runs, that callback still finalizes server-side
// (bound to the signed `state` from `/start`, independent of this
// client-side bridge); this function can only prevent that popup's return
// signal from being accepted by *this tab* afterward, not un-do a
// server-side connection that already completed.
export function abandonConnectorPopupAttempt(attempt: ConnectorPopupAttempt | null): void {
  if (!attempt) return
  const pending = readPendingAttempt()
  if (pending?.attemptId === attempt.attemptId) {
    try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch { /* best-effort */ }
  }
  try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`) } catch { /* best-effort */ }
  try { attempt.popup.close() } catch { /* best-effort */ }
}

// Called on logout (AuthGate.tsx), not on a vault lock. A lock is meant to
// be momentary for the SAME already-authenticated user -- an in-flight
// popup attempt should survive it, and already does (the pending record
// lives in sessionStorage/localStorage, entirely outside React state, so a
// lock/unlock cycle never touches it). Logout is the actual trust boundary:
// without this, a stale attemptId left behind by a previous session could
// be silently accepted by whichever different user next logs into the same
// browser tab (acceptConnectorReturnSignal()/takeBufferedConnectorReturn()
// only check attemptId/provider, never which account is currently
// authenticated -- that binding is enforced server-side, via the signed
// state's own `sub` claim, not by this client-side bridge). Removes both the
// tab-local pending-attempt binding and any already-buffered localStorage
// return record for that same attempt, so nothing readable survives logout
// for a later session to stumble across -- read-then-delete, not a blind
// removeItem, since the buffered record is keyed by attemptId, not by a
// fixed name. Best-effort throughout: readPendingAttempt() already never
// throws, and a browser with unavailable storage must still let logout
// complete.
export function clearPendingConnectorAttempt(): void {
  const pending = readPendingAttempt()
  if (pending) {
    try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${pending.attemptId}`) } catch { /* best-effort */ }
  }
  try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch { /* best-effort */ }
}

function signalFromCurrentUrl(): ConnectorReturnSignal | null {
  const url = new URL(window.location.href)
  const attemptId = url.searchParams.get(CONNECTOR_RETURN_ATTEMPT_PARAM)
  if (!validAttemptId(attemptId)) return null
  const provider = url.searchParams.get('provider') || undefined
  const error = url.searchParams.get('error') || undefined
  return parseSignal({ type: 'finance-planner:connector-return', attemptId, provider, error })
}

/**
 * Called before React mounts. A provider popup returning to Finance Planner
 * publishes only fixed callback metadata to the already-open original tab,
 * then closes. No vault password, derived key, financial data, provider code,
 * signed state, token, or free-text error_description is ever transferred.
 *
 * Fixed 2026-08-25 (PR #154 review): a syntactically valid
 * fp_connection_attempt + provider/error in the URL alone used to be enough
 * to short-circuit bootstrap into this transport screen -- which a crafted
 * link to Finance Planner's own origin (opened in an ordinary tab, not a
 * popup) could also satisfy, stranding that tab on "Bank authorization
 * completed" instead of mounting the app. The ORIGINAL tab would still
 * reject a mismatched attemptId later (see acceptConnectorReturnSignal()),
 * so this was never a cross-user data leak -- but it could disrupt a normal
 * tab. Now also requires POPUP_ORIGIN_MARKER_KEY's sessionStorage value to
 * exactly match the URL's attemptId: only the popup Finance Planner itself
 * opened for this exact attempt ever has it (see
 * beginConnectorPopupAttempt()), so a normal tab -- including the original
 * Finance Planner tab, which never receives this marker either -- always
 * falls through to mounting the app normally instead.
 */
export function publishConnectorReturnFromPopup(): boolean {
  const signal = signalFromCurrentUrl()
  if (!signal) return false

  let marker: string | null = null
  try { marker = sessionStorage.getItem(POPUP_ORIGIN_MARKER_KEY) } catch { marker = null }
  if (marker !== signal.attemptId) return false
  try { sessionStorage.removeItem(POPUP_ORIGIN_MARKER_KEY) } catch { /* best-effort */ }

  try {
    localStorage.setItem(`${RETURN_STORAGE_PREFIX}${signal.attemptId}`, JSON.stringify(signal))
  } catch { /* best-effort */ }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME)
      channel.postMessage(signal)
      channel.close()
    } catch { /* best-effort */ }
  }

  const root = document.getElementById('root')
  if (root) root.textContent = 'Bank authorization completed. This window can close.'
  window.setTimeout(() => { try { window.close() } catch { /* best-effort */ } }, 0)
  return true
}

export function acceptConnectorReturnSignal(signal: ConnectorReturnSignal): ConnectorReturnSignal | null {
  const pending = readPendingAttempt()
  if (!pending || pending.attemptId !== signal.attemptId) return null
  if (signal.provider && signal.provider !== pending.provider) return null

  try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch { /* best-effort */ }
  try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${signal.attemptId}`) } catch { /* best-effort */ }
  return signal
}

export function takeBufferedConnectorReturn(): ConnectorReturnSignal | null {
  const pending = readPendingAttempt()
  if (!pending) return null
  try {
    const raw = localStorage.getItem(`${RETURN_STORAGE_PREFIX}${pending.attemptId}`)
    if (!raw) return null
    const signal = parseSignal(JSON.parse(raw))
    return signal ? acceptConnectorReturnSignal(signal) : null
  } catch {
    try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${pending.attemptId}`) } catch { /* best-effort */ }
    return null
  }
}

export function subscribeConnectorReturns(listener: (signal: ConnectorReturnSignal) => void): () => void {
  let channel: BroadcastChannel | null = null
  const onBroadcast = (event: MessageEvent<unknown>) => {
    const signal = parseSignal(event.data)
    if (signal) listener(signal)
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.addEventListener('message', onBroadcast)
    } catch { channel = null }
  }

  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(RETURN_STORAGE_PREFIX) || !event.newValue) return
    try {
      const signal = parseSignal(JSON.parse(event.newValue))
      if (signal) listener(signal)
    } catch { /* best-effort */ }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener('storage', onStorage)
    if (channel) {
      channel.removeEventListener('message', onBroadcast)
      channel.close()
    }
  }
}
