export interface PasskeyAccount {
  id: string
  email: string
  displayName?: string
  lastUsedAt?: string
}

type JsonObject = Record<string, unknown>

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message || `Passkey-Anfrage fehlgeschlagen (${response.status}).`)
  return payload
}

function credentialToJson(credential: PublicKeyCredential): JsonObject {
  const response = credential.response
  const base: JsonObject = { id: credential.id, rawId: encodeBase64Url(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults() }
  if (response instanceof AuthenticatorAttestationResponse) {
    return { ...base, response: { clientDataJSON: encodeBase64Url(response.clientDataJSON), attestationObject: encodeBase64Url(response.attestationObject), transports: response.getTransports?.() || [] } }
  }
  if (response instanceof AuthenticatorAssertionResponse) {
    return { ...base, response: { clientDataJSON: encodeBase64Url(response.clientDataJSON), authenticatorData: encodeBase64Url(response.authenticatorData), signature: encodeBase64Url(response.signature), userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null } }
  }
  throw new Error('Nicht unterstützte Passkey-Antwort.')
}

function creationOptions(input: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...input,
    challenge: decodeBase64Url(input.challenge),
    user: { ...input.user, id: decodeBase64Url(input.user.id) },
    excludeCredentials: input.excludeCredentials?.map((credential) => ({ ...credential, id: decodeBase64Url(credential.id) })),
  }
}

function requestOptions(input: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...input,
    challenge: decodeBase64Url(input.challenge),
    allowCredentials: input.allowCredentials?.map((credential) => ({ ...credential, id: decodeBase64Url(credential.id) })),
  }
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials)
}

export async function enrollPasskey(label?: string): Promise<void> {
  if (!passkeysSupported()) throw new Error('Passkeys werden auf diesem Gerät oder in diesem Kontext nicht unterstützt.')
  const options = await request<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkeys/register/options', { method: 'POST', body: JSON.stringify({ label }) })
  const credential = await navigator.credentials.create({ publicKey: creationOptions(options) })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey-Einrichtung wurde abgebrochen.')
  await request('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify({ credential: credentialToJson(credential), label }) })
}

export async function authenticateWithPasskey(email?: string): Promise<PasskeyAccount> {
  if (!passkeysSupported()) throw new Error('Passkeys werden auf diesem Gerät oder in diesem Kontext nicht unterstützt.')
  const options = await request<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkeys/authenticate/options', { method: 'POST', body: JSON.stringify({ email }) })
  const credential = await navigator.credentials.get({ publicKey: requestOptions(options), mediation: email ? 'required' : 'optional' })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey-Anmeldung wurde abgebrochen.')
  return request<PasskeyAccount>('/api/auth/passkeys/authenticate/verify', { method: 'POST', body: JSON.stringify({ credential: credentialToJson(credential) }) })
}

export async function listKnownAccounts(): Promise<PasskeyAccount[]> {
  const result = await request<{ accounts?: PasskeyAccount[] }>('/api/auth/accounts')
  return Array.isArray(result.accounts) ? result.accounts : []
}

export async function switchAccount(accountId: string): Promise<PasskeyAccount> {
  return request<PasskeyAccount>('/api/auth/accounts/switch', { method: 'POST', body: JSON.stringify({ accountId }) })
}

interface PublicKeyCredentialDescriptorJSON extends Omit<PublicKeyCredentialDescriptor, 'id'> { id: string }
interface PublicKeyCredentialUserEntityJSON extends Omit<PublicKeyCredentialUserEntity, 'id'> { id: string }
interface PublicKeyCredentialCreationOptionsJSON extends Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> { challenge: string; user: PublicKeyCredentialUserEntityJSON; excludeCredentials?: PublicKeyCredentialDescriptorJSON[] }
interface PublicKeyCredentialRequestOptionsJSON extends Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> { challenge: string; allowCredentials?: PublicKeyCredentialDescriptorJSON[] }
