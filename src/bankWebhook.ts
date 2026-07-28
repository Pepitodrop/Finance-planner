import type { BankConsent, BankRuntimeRepository } from './bankRuntime'
import { acceptWebhookOnce } from './bankRuntime'

const encoder = new TextEncoder()

export type BankWebhookType = 'transactions.available' | 'consent.expired' | 'consent.revoked'

export interface BankWebhookEvent {
  id: string
  type: BankWebhookType
  occurredAt: string
  provider: string
  connectionId: string
}

export interface BankWebhookRepository extends BankRuntimeRepository {
  findConsentByProviderConnection(provider: string, connectionId: string): Promise<BankConsent | undefined>
}

export interface BankWebhookResult {
  accepted: boolean
  action: 'ignored' | 'sync-scheduled' | 'consent-expired' | 'consent-revoked'
  consentId?: string
}

function fromHex(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return undefined
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export async function verifyBankWebhookSignature(rawBody: string, signatureHex: string, secret: Uint8Array): Promise<boolean> {
  const supplied = fromHex(signatureHex)
  if (!supplied) return false
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)))
  return timingSafeEqual(supplied, expected)
}

export function parseBankWebhook(rawBody: string): BankWebhookEvent {
  const event = JSON.parse(rawBody) as Partial<BankWebhookEvent>
  if (!event.id || !event.occurredAt || !event.provider || !event.connectionId) throw new Error('Bank webhook is incomplete.')
  if (!['transactions.available', 'consent.expired', 'consent.revoked'].includes(event.type ?? '')) throw new Error('Unsupported bank webhook type.')
  return event as BankWebhookEvent
}

export async function processBankWebhook(input: {
  rawBody: string
  signatureHex: string
  secret: Uint8Array
  repository: BankWebhookRepository
  scheduleSync: (consentId: string, eventId: string) => Promise<void>
  now?: Date
}): Promise<BankWebhookResult> {
  const signatureValid = await verifyBankWebhookSignature(input.rawBody, input.signatureHex, input.secret)
  if (!signatureValid) return { accepted: false, action: 'ignored' }

  let event: BankWebhookEvent
  try { event = parseBankWebhook(input.rawBody) } catch { return { accepted: false, action: 'ignored' } }

  const accepted = await acceptWebhookOnce(input.repository, {
    id: event.id,
    occurredAt: event.occurredAt,
    signatureValid,
  }, (input.now ?? new Date()).getTime())
  if (!accepted) return { accepted: false, action: 'ignored' }

  const consent = await input.repository.findConsentByProviderConnection(event.provider, event.connectionId)
  if (!consent) return { accepted: true, action: 'ignored' }

  const updatedAt = (input.now ?? new Date()).toISOString()
  if (event.type === 'consent.expired') {
    await input.repository.saveConsent({ ...consent, status: 'expired', updatedAt })
    return { accepted: true, action: 'consent-expired', consentId: consent.id }
  }
  if (event.type === 'consent.revoked') {
    await input.repository.saveConsent({
      ...consent,
      status: 'revoked',
      encryptedAccessToken: undefined,
      encryptedRefreshToken: undefined,
      tokenExpiresAt: undefined,
      cursor: undefined,
      updatedAt,
    })
    return { accepted: true, action: 'consent-revoked', consentId: consent.id }
  }

  if (consent.status !== 'active') return { accepted: true, action: 'ignored', consentId: consent.id }
  await input.scheduleSync(consent.id, event.id)
  return { accepted: true, action: 'sync-scheduled', consentId: consent.id }
}
