export type ConsentStatus = 'pending' | 'active' | 'expired' | 'revoked'

export interface BankConsent {
  id: string
  userId: string
  provider: string
  status: ConsentStatus
  expiresAt: string
  providerConnectionId?: string
  accountIds?: string[]
  tokenExpiresAt?: string
  encryptedAccessToken?: EncryptedSecret
  encryptedRefreshToken?: EncryptedSecret
  cursor?: string
  updatedAt: string
}

export interface EncryptedSecret { keyId: string; iv: string; ciphertext: string }
export interface TokenKey { id: string; rawKey: Uint8Array }
export interface OAuthStateClaims { userId: string; provider: string; redirectUri: string; nonce: string; expiresAt: number }

export interface ProviderAuthorizationSession {
  authorizationUrl: string
  connectionId: string
}

export interface ProviderConnectionResponse {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt: string
  consentExpiresAt: string
  accountIds: string[]
}

export interface ProviderTokenResponse {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt: string
}

export interface ProviderTransaction {
  id: string
  bookedAt: string
  amountCents: number
  currency: string
  description: string
  pending?: boolean
}

export interface ProviderSyncPage {
  transactions: ProviderTransaction[]
  nextCursor?: string
  completed: boolean
  openingBalanceCents?: number
  closingBalanceCents?: number
}

export interface BankProviderAdapter {
  name: string
  createAuthorization(input: { state: string; redirectUri: string; reference: string }): Promise<ProviderAuthorizationSession>
  completeAuthorization(input: { connectionId: string }): Promise<ProviderConnectionResponse>
  refreshTokens(refreshToken: string): Promise<ProviderTokenResponse>
  revoke(accessToken: string, connectionId?: string): Promise<void>
  fetchTransactions(input: { accessToken: string; accountIds: string[]; cursor?: string }): Promise<ProviderSyncPage>
}

export interface BankRuntimeRepository {
  getConsent(id: string): Promise<BankConsent | undefined>
  saveConsent(consent: BankConsent): Promise<void>
  hasWebhookEvent(eventId: string): Promise<boolean>
  commitWebhookEvent(eventId: string, occurredAt: string): Promise<boolean>
  commitSyncPage(input: {
    consentId: string
    expectedCursor?: string
    nextCursor?: string
    completed: boolean
    transactions: ProviderTransaction[]
  }): Promise<void>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}
async function importHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function issueOAuthState(claims: OAuthStateClaims, secret: Uint8Array): Promise<string> {
  if (!claims.userId || !claims.provider || !claims.redirectUri || !claims.nonce) throw new Error('OAuth state claims are incomplete.')
  const payload = bytesToBase64(encoder.encode(JSON.stringify(claims)))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await importHmacKey(secret), encoder.encode(payload)))
  return `${payload}.${bytesToBase64(signature)}`
}

export async function verifyOAuthState(
  token: string,
  secret: Uint8Array,
  expected: { userId: string; provider: string; redirectUri: string },
  now = Date.now(),
): Promise<OAuthStateClaims> {
  const [payload, signatureText, extra] = token.split('.')
  if (!payload || !signatureText || extra) throw new Error('Malformed OAuth state.')
  const supplied = base64ToBytes(signatureText)
  const expectedSignature = new Uint8Array(await crypto.subtle.sign('HMAC', await importHmacKey(secret), encoder.encode(payload)))
  if (!timingSafeEqual(supplied, expectedSignature)) throw new Error('Invalid OAuth state signature.')
  const claims = JSON.parse(decoder.decode(base64ToBytes(payload))) as OAuthStateClaims
  if (claims.expiresAt <= now) throw new Error('OAuth state expired.')
  if (claims.userId !== expected.userId || claims.provider !== expected.provider || claims.redirectUri !== expected.redirectUri) {
    throw new Error('OAuth state binding mismatch.')
  }
  return claims
}

export class AesGcmTokenVault {
  constructor(private readonly activeKey: TokenKey, private readonly previousKeys: readonly TokenKey[] = []) {}
  async encrypt(secret: string): Promise<EncryptedSecret> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await crypto.subtle.importKey('raw', this.activeKey.rawKey, 'AES-GCM', false, ['encrypt'])
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(secret)))
    return { keyId: this.activeKey.id, iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) }
  }
  async decrypt(secret: EncryptedSecret): Promise<string> {
    const material = [this.activeKey, ...this.previousKeys].find((candidate) => candidate.id === secret.keyId)
    if (!material) throw new Error('Unknown token encryption key.')
    const key = await crypto.subtle.importKey('raw', material.rawKey, 'AES-GCM', false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(secret.iv) }, key, base64ToBytes(secret.ciphertext))
    return decoder.decode(plaintext)
  }
  async rotate(secret: EncryptedSecret): Promise<EncryptedSecret> {
    if (secret.keyId === this.activeKey.id) return secret
    return this.encrypt(await this.decrypt(secret))
  }
}

export function validateWebhookTimestamp(occurredAt: string, now = Date.now(), replayWindowMs = 5 * 60_000): boolean {
  const timestamp = Date.parse(occurredAt)
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= replayWindowMs
}

export async function acceptWebhookOnce(
  repository: BankRuntimeRepository,
  event: { id: string; occurredAt: string; signatureValid: boolean },
  now = Date.now(),
): Promise<boolean> {
  if (!event.id || !event.signatureValid || !validateWebhookTimestamp(event.occurredAt, now)) return false
  if (await repository.hasWebhookEvent(event.id)) return false
  return repository.commitWebhookEvent(event.id, event.occurredAt)
}

export async function beginBankConnection(input: {
  consent: BankConsent
  state: string
  redirectUri: string
  provider: BankProviderAdapter
  repository: BankRuntimeRepository
  now?: Date
}): Promise<ProviderAuthorizationSession> {
  const session = await input.provider.createAuthorization({ state: input.state, redirectUri: input.redirectUri, reference: input.consent.id })
  await input.repository.saveConsent({
    ...input.consent,
    providerConnectionId: session.connectionId,
    updatedAt: (input.now ?? new Date()).toISOString(),
  })
  return session
}

export async function connectBank(input: {
  consentId: string
  provider: BankProviderAdapter
  repository: BankRuntimeRepository
  vault: AesGcmTokenVault
  now?: Date
}): Promise<BankConsent> {
  const existing = await input.repository.getConsent(input.consentId)
  if (!existing?.providerConnectionId) throw new Error('Bank authorization session is missing.')
  const connection = await input.provider.completeAuthorization({ connectionId: existing.providerConnectionId })
  const now = input.now ?? new Date()
  const consent: BankConsent = {
    ...existing,
    status: 'active',
    expiresAt: connection.consentExpiresAt,
    accountIds: connection.accountIds,
    tokenExpiresAt: connection.accessTokenExpiresAt,
    encryptedAccessToken: await input.vault.encrypt(connection.accessToken),
    encryptedRefreshToken: connection.refreshToken ? await input.vault.encrypt(connection.refreshToken) : undefined,
    updatedAt: now.toISOString(),
  }
  await input.repository.saveConsent(consent)
  return consent
}

async function validAccessToken(input: {
  consent: BankConsent
  provider: BankProviderAdapter
  repository: BankRuntimeRepository
  vault: AesGcmTokenVault
  now: Date
}): Promise<{ consent: BankConsent; accessToken: string }> {
  if (!input.consent.encryptedAccessToken) throw new Error('Provider access token is missing.')
  const tokenExpiry = Date.parse(input.consent.tokenExpiresAt ?? '')
  if (Number.isFinite(tokenExpiry) && tokenExpiry > input.now.getTime() + 60_000) {
    return { consent: input.consent, accessToken: await input.vault.decrypt(input.consent.encryptedAccessToken) }
  }
  if (!input.consent.encryptedRefreshToken) throw new Error('Provider access token expired and cannot be refreshed.')
  const refreshed = await input.provider.refreshTokens(await input.vault.decrypt(input.consent.encryptedRefreshToken))
  const consent: BankConsent = {
    ...input.consent,
    tokenExpiresAt: refreshed.accessTokenExpiresAt,
    encryptedAccessToken: await input.vault.encrypt(refreshed.accessToken),
    encryptedRefreshToken: refreshed.refreshToken
      ? await input.vault.encrypt(refreshed.refreshToken)
      : await input.vault.rotate(input.consent.encryptedRefreshToken),
    updatedAt: input.now.toISOString(),
  }
  await input.repository.saveConsent(consent)
  return { consent, accessToken: refreshed.accessToken }
}

export async function syncBankConnection(input: {
  consentId: string
  provider: BankProviderAdapter
  repository: BankRuntimeRepository
  vault: AesGcmTokenVault
  maxPages?: number
  now?: Date
}): Promise<{ imported: number; pages: number; completed: boolean }> {
  let consent = await input.repository.getConsent(input.consentId)
  if (!consent || consent.status !== 'active') throw new Error('Bank consent is not active.')
  const now = input.now ?? new Date()
  if (Date.parse(consent.expiresAt) <= now.getTime()) {
    await input.repository.saveConsent({ ...consent, status: 'expired', updatedAt: now.toISOString() })
    throw new Error('Bank consent expired.')
  }
  const token = await validAccessToken({ consent, provider: input.provider, repository: input.repository, vault: input.vault, now })
  consent = token.consent
  let cursor = consent.cursor
  let imported = 0
  const maxPages = input.maxPages ?? 100
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await input.provider.fetchTransactions({ accessToken: token.accessToken, accountIds: consent.accountIds ?? [], cursor })
    if (!page.completed && !page.nextCursor) throw new Error('Provider returned an incomplete page without a cursor.')
    if (!page.completed && page.nextCursor === cursor) throw new Error('Provider cursor did not advance.')
    if (page.nextCursor && cursor && page.nextCursor < cursor) throw new Error('Provider cursor moved backwards.')
    if (page.openingBalanceCents !== undefined && page.closingBalanceCents !== undefined) {
      const expected = page.openingBalanceCents + page.transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0)
      if (Math.abs(page.closingBalanceCents - expected) > 1) throw new Error('Provider balance reconciliation failed.')
    }
    await input.repository.commitSyncPage({
      consentId: consent.id,
      expectedCursor: cursor,
      nextCursor: page.nextCursor ?? cursor,
      completed: page.completed,
      transactions: page.transactions,
    })
    imported += page.transactions.length
    cursor = page.nextCursor ?? cursor
    if (page.completed) return { imported, pages: pageNumber, completed: true }
  }
  throw new Error('Bank sync exceeded the page safety limit.')
}

export async function disconnectBank(input: {
  consentId: string
  provider: BankProviderAdapter
  repository: BankRuntimeRepository
  vault: AesGcmTokenVault
  now?: Date
}): Promise<void> {
  const consent = await input.repository.getConsent(input.consentId)
  if (!consent) return
  if (consent.encryptedAccessToken) {
    await input.provider.revoke(await input.vault.decrypt(consent.encryptedAccessToken), consent.providerConnectionId)
  }
  await input.repository.saveConsent({
    ...consent,
    status: 'revoked',
    encryptedAccessToken: undefined,
    encryptedRefreshToken: undefined,
    tokenExpiresAt: undefined,
    cursor: undefined,
    updatedAt: (input.now ?? new Date()).toISOString(),
  })
}
