export const CONNECTOR_RETURN_ATTEMPT_PARAM = 'fp_connection_attempt'

const CHANNEL_NAME = 'finance-planner-connector-return-v1'
const PENDING_STORAGE_KEY = 'finance-planner-connector-pending-v1'
const RETURN_STORAGE_PREFIX = 'finance-planner-connector-return-v1:'
const ATTEMPT_MAX_AGE_MS = 20 * 60 * 1000

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
    try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch {}
    return null
  }
}

function parseSignal(value: unknown): ConnectorReturnSignal | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ConnectorReturnSignal>
  if (candidate.type !== 'finance-planner:connector-return' || !validAttemptId(candidate.attemptId)) return null
  if (candidate.provider !== undefined && (typeof candidate.provider !== 'string' || !candidate.provider)) return null
  if (candidate.error !== undefined && (typeof candidate.error !== 'string' || !candidate.error)) return null
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
  const popup = window.open('about:blank', `finance-planner-provider-${attemptId}`, 'popup,width=720,height=820,resizable=yes,scrollbars=yes')
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
    try { popup.close() } catch {}
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

export function abandonConnectorPopupAttempt(attempt: ConnectorPopupAttempt | null): void {
  if (!attempt) return
  const pending = readPendingAttempt()
  if (pending?.attemptId === attempt.attemptId) {
    try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch {}
  }
  try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`) } catch {}
  try { attempt.popup.close() } catch {}
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
 */
export function publishConnectorReturnFromPopup(): boolean {
  const signal = signalFromCurrentUrl()
  if (!signal) return false

  try {
    localStorage.setItem(`${RETURN_STORAGE_PREFIX}${signal.attemptId}`, JSON.stringify(signal))
  } catch {}

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME)
      channel.postMessage(signal)
      channel.close()
    } catch {}
  }

  const root = document.getElementById('root')
  if (root) root.textContent = 'Bank authorization completed. This window can close.'
  window.setTimeout(() => { try { window.close() } catch {} }, 0)
  return true
}

export function acceptConnectorReturnSignal(signal: ConnectorReturnSignal): ConnectorReturnSignal | null {
  const pending = readPendingAttempt()
  if (!pending || pending.attemptId !== signal.attemptId) return null
  if (signal.provider && signal.provider !== pending.provider) return null

  try { sessionStorage.removeItem(PENDING_STORAGE_KEY) } catch {}
  try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${signal.attemptId}`) } catch {}
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
    try { localStorage.removeItem(`${RETURN_STORAGE_PREFIX}${pending.attemptId}`) } catch {}
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
    } catch {}
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
