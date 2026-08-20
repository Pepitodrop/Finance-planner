import { createPrivateKey, createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ISSUER = 'enablebanking.com'
const AUDIENCE = 'api.enablebanking.com'
const JWT_TTL_SECONDS = 3600

class EnableBankingConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EnableBankingConfigError'
    this.code = 'enablebanking_key_invalid'
  }
}

// Presence-only check, matching GoCardlessProvider.isConfigured()'s pattern
// -- cheap enough to call on every describe(), real validation happens on
// first actual use (see resolvePrivateKey()) rather than here.
export function isEnableBankingConfigured(env) {
  if (!env.ENABLE_BANKING_APPLICATION_ID) return false
  return Boolean(env.ENABLE_BANKING_PRIVATE_KEY_FILE || env.ENABLE_BANKING_PRIVATE_KEY)
}

// File takes precedence when both are set -- matches the production-preferred
// posture the env var names imply. Never includes key material in any thrown
// error: only the config problem (missing/unreadable/malformed), never the PEM.
//
// Cached by config (file path, or the raw PEM content itself when no file is
// set -- already resident in `env`, so this adds no new exposure): a sync()
// call can invoke signEnableBankingJwt() dozens of times (once per account
// balance fetch, once per transaction page), and re-running a blocking
// readFileSync()+PEM-parse that many times on Node's single event-loop
// thread was a real, self-inflicted latency/availability cost, not just
// wasted CPU. The one capability this trades away is picking up a rotated
// key file's new content without a process restart -- an accepted tradeoff
// for an application-level credential that doesn't rotate live in practice.
const resolvedKeyCache = new Map()
function resolvePrivateKey(env) {
  const filePath = env.ENABLE_BANKING_PRIVATE_KEY_FILE
  const cacheKey = filePath ? `file:${filePath}` : `raw:${env.ENABLE_BANKING_PRIVATE_KEY || ''}`
  const cached = resolvedKeyCache.get(cacheKey)
  if (cached) return cached

  const source = filePath
    ? { label: 'ENABLE_BANKING_PRIVATE_KEY_FILE', pem: (() => {
        try {
          return readFileSync(filePath, 'utf8')
        } catch {
          throw new EnableBankingConfigError('ENABLE_BANKING_PRIVATE_KEY_FILE could not be read.')
        }
      })() }
    : { label: 'ENABLE_BANKING_PRIVATE_KEY', pem: env.ENABLE_BANKING_PRIVATE_KEY }
  if (!source.pem) throw new EnableBankingConfigError('No Enable Banking private key is configured.')
  let key
  try {
    key = createPrivateKey(source.pem)
  } catch {
    throw new EnableBankingConfigError(`${source.label} is not a valid private key.`)
  }
  resolvedKeyCache.set(cacheKey, key)
  return key
}

// RS256 by hand: header.payload signed with RSASSA-PKCS1-v1_5/SHA-256, which
// is exactly what crypto.sign('RSA-SHA256', ...) produces against a plain RSA
// key (not RSA-PSS) -- no jsonwebtoken/jwa dependency needed for this one
// application-level JWT. The signature itself is always freshly computed per
// call (only key *resolution* is cached, above) -- RSA signing is cheap
// synchronous crypto, and a fresh iat/exp per call avoids any stale-token-
// window class of bug for negligible cost.
export function signEnableBankingJwt(env) {
  const applicationId = String(env.ENABLE_BANKING_APPLICATION_ID || '').trim()
  if (!applicationId) throw new EnableBankingConfigError('ENABLE_BANKING_APPLICATION_ID is not configured.')
  const privateKey = resolvePrivateKey(env)

  const iat = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'RS256', kid: applicationId }
  const payload = { iss: ISSUER, aud: AUDIENCE, iat, exp: iat + JWT_TTL_SECONDS }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

export { EnableBankingConfigError }
