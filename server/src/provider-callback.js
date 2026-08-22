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
