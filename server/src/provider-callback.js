// Small, provider-agnostic callback helpers kept separate from server.js so
// the security-sensitive decision rules can be unit-tested directly.

/**
 * A callback only completes an OAuth/PSD2-style attempt when the provider
 * actually returned either an authorization code or an OAuth error. The
 * Enable Banking Auth Flow widget can cause navigation to the registered
 * callback URL without either signal; such an auxiliary navigation must not
 * consume the single-use nonce or show a misleading "invalid state" error.
 */
export function callbackHasCompletionSignal(url) {
  const code = String(url?.searchParams?.get?.('code') || '').trim()
  const error = String(url?.searchParams?.get?.('error') || '').trim()
  return Boolean(code || error)
}

/**
 * A second callback after successful finalization may be treated as an
 * idempotent success only when the already-persisted connection is proven to
 * belong to the exact same cryptographically-verified attempt. The consent id
 * and redirect URI are both claims inside Finance Planner's signed state.
 * connectedAt proves finalization completed; merely having an older working
 * connection for the same provider is never enough.
 */
export function completedConnectionMatchesState(stored, state, provider) {
  if (!stored || !state || !provider) return false
  return Boolean(
    stored.connectedAt
      && stored.consentId === state.consentId
      && stored.redirectUri === state.redirectUri
      && state.provider === provider,
  )
}

const DEFAULT_WAIT_MAX_MS = 20_000
const DEFAULT_WAIT_POLL_INTERVAL_MS = 150

/**
 * Bounded wait for a concurrent duplicate callback whose claim attempt
 * observed { status: 'in_progress' } -- i.e. shared Postgres (or, for
 * non-Postgres deployments, the equivalent in-memory) state already proved
 * this exact verified attempt (same nonce_hash + consent_id + user_id +
 * provider + redirect_uri) is being completed elsewhere. This must never be
 * invoked for any other reason -- it is not a generic "retry on missing
 * nonce" mechanism, and does not fire for an unrelated/expired/mismatched
 * callback (those resolve immediately via claimPendingConnectionSetup()'s
 * 'not_found' status instead).
 *
 * Polls store.pendingConnectionSetupExists() (read-only, never claims)
 * until the row disappears -- meaning the claimer released it, either after
 * a successful finalizeConnection() or after a failed completeCallback()/
 * finalizeConnection() -- or until maxWaitMs elapses. Either way, the
 * *caller* is responsible for determining the actual outcome afterward via
 * the existing completedConnectionMatchesState() check against the
 * now-possibly-finalized connection; this function only reports whether the
 * wait ended because the claim resolved or because time ran out (both
 * collapse to the same 'not_found' signal for the caller, since the
 * distinction "resolved to failure" vs "gave up waiting" already produces
 * the same outcome: fail closed the same way the pre-fix code always did
 * for a callback with nothing to show for it).
 */
export async function waitForPendingConnectionCompletion({
  store,
  state,
  maxWaitMs = DEFAULT_WAIT_MAX_MS,
  pollIntervalMs = DEFAULT_WAIT_POLL_INTERVAL_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const exists = await store.pendingConnectionSetupExists({
      nonce: state.nonce, consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, now: Date.now(),
    })
    if (!exists) return { status: 'not_found' }
  }
  return { status: 'not_found' }
}

/**
 * The full provider-callback completion algorithm, extracted from
 * server.js's route handler so the exactly-once/concurrent-duplicate
 * behavior this module exists to guarantee can be exercised directly with
 * mocked store/providerAdapter dependencies, rather than only through
 * source-text assertions against server.js. Takes an already-verified
 * `state` (server.js's verifyState() call happens before this) and the raw
 * `code` query parameter; returns a plain outcome for the caller to turn
 * into an HTTP redirect -- this function has no knowledge of HTTP at all.
 *
 * Security invariants preserved from the pre-fix single-step design (see
 * claimPendingConnectionSetup()'s doc comment for the race this replaces):
 * - providerAdapter.completeCallback() (the provider code-for-session
 *   exchange) runs at most once per nonce -- only the 'claimed' branch ever
 *   calls it, and claiming is exactly-once by construction.
 * - The remote provider network call never runs inside a store transaction
 *   -- claimPendingConnectionSetup() and releasePendingConnectionSetup()
 *   are each a single short local operation; completeCallback() runs
 *   entirely between them, un-transacted.
 * - A concurrent duplicate for the exact same verified attempt (proven by
 *   matching nonce_hash + consent_id + user_id + provider + redirect_uri,
 *   never merely "same user + same provider") waits for or observes the
 *   claimer's real outcome via completedConnectionMatchesState() -- it never
 *   fabricates success, and never re-runs completeCallback() itself.
 * - An unrelated, expired, or mismatched callback still fails closed via
 *   the unchanged completedConnectionMatchesState() replay check.
 */
export async function completeConnectorCallback({
  store,
  providerAdapter,
  state,
  code,
  now = () => new Date(),
  log = () => {},
  wait = waitForPendingConnectionCompletion,
}) {
  const claimInput = { nonce: state.nonce, consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, now: Date.now() }
  let claim = await store.claimPendingConnectionSetup(claimInput)
  log({ event: 'connector_callback_claim', provider: state.provider, result: claim.status })

  if (claim.status === 'in_progress') {
    const waitStart = Date.now()
    claim = await wait({ store, state })
    log({ event: 'connector_callback_wait', provider: state.provider, durationMs: Date.now() - waitStart, result: claim.status })
  }

  if (claim.status !== 'claimed') {
    // Covers three distinct cases uniformly, all correctly resolved by the
    // same check: a genuinely unrelated/expired/mismatched nonce; a
    // duplicate whose matching claim has already finished (success or
    // failure); and a duplicate that waited out the bound above without
    // ever observing a resolution. In every case, whether this callback is
    // a success or a failure depends only on whether a connection matching
    // this EXACT verified attempt is now actually persisted -- never on
    // "did we personally see a positive signal."
    let replayed = false
    try {
      const stored = await store.get(state.sub, state.provider)
      replayed = completedConnectionMatchesState(stored, state, state.provider)
    } catch { /* fails closed below */ }
    return replayed ? { outcome: 'success' } : { outcome: 'error', errorCode: 'invalid_state' }
  }

  let completed
  try {
    completed = await providerAdapter.completeCallback({ code, pending: claim.connection })
  } catch (error) {
    await store.releasePendingConnectionSetup({ nonce: state.nonce, claimToken: claim.claimToken }).catch(() => {})
    log({ event: 'connector_callback_failed', provider: state.provider, stage: 'exchange' })
    return { outcome: 'error', errorCode: error?.code === 'authorization_denied' ? 'access_denied' : 'invalid_state' }
  }

  try {
    await store.finalizeConnection({ userId: state.sub, provider: state.provider, connection: completed, connectedAt: now().toISOString() })
  } catch {
    // completeCallback() already succeeded -- for a provider like Enable
    // Banking, a real session/consent now exists at their end with zero
    // local trace of it. Best-effort ask the provider to revoke what it just
    // created rather than leaving it permanently orphaned; never lets a
    // revoke failure change the error the caller sees.
    try { await providerAdapter.disconnect(completed) } catch { /* best-effort */ }
    await store.releasePendingConnectionSetup({ nonce: state.nonce, claimToken: claim.claimToken }).catch(() => {})
    log({ event: 'connector_callback_failed', provider: state.provider, stage: 'finalize' })
    return { outcome: 'error', errorCode: 'invalid_state' }
  }

  await store.releasePendingConnectionSetup({ nonce: state.nonce, claimToken: claim.claimToken }).catch(() => {})
  log({ event: 'connector_callback_completed', provider: state.provider })
  return { outcome: 'success' }
}
