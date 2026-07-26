import type { BankProviderAdapter, ProviderSyncPage, ProviderTokenResponse, ProviderTransaction } from './bankRuntime'

interface HttpResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface GoCardlessProviderConfig {
  baseUrl?: string
  secretId: string
  secretKey: string
  institutionId: string
  requisitionId: string
  accountId: string
  fetcher?: (url: string, init?: RequestInit) => Promise<HttpResponse>
}

type JsonObject = Record<string, unknown>

function object(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${context} response.`)
  return value as JsonObject
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${field}.`)
  return value
}

function amountToCents(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Invalid transaction amount.')
  return Math.round(parsed * 100)
}

function normalizeTransaction(value: unknown): ProviderTransaction {
  const transaction = object(value, 'transaction')
  const transactionAmount = object(transaction.transactionAmount, 'transaction amount')
  return {
    id: text(transaction.transactionId ?? transaction.internalTransactionId, 'transaction identifier'),
    bookedAt: text(transaction.bookingDate ?? transaction.valueDate, 'booking date'),
    amountCents: amountToCents(transactionAmount.amount),
    currency: text(transactionAmount.currency, 'transaction currency'),
    description: String(transaction.remittanceInformationUnstructured ?? transaction.creditorName ?? transaction.debtorName ?? 'Bank transaction'),
    pending: false,
  }
}

export class GoCardlessBankProvider implements BankProviderAdapter {
  readonly name = 'gocardless-bank-account-data'
  private readonly baseUrl: string
  private readonly fetcher: (url: string, init?: RequestInit) => Promise<HttpResponse>
  private token?: { access: string; expiresAt: number }

  constructor(private readonly config: GoCardlessProviderConfig) {
    this.baseUrl = config.baseUrl ?? 'https://bankaccountdata.gocardless.com/api/v2'
    this.fetcher = config.fetcher ?? fetch
  }

  buildAuthorizationUrl(input: { state: string; redirectUri: string }): string {
    const url = new URL(`${this.baseUrl}/requisitions/${encodeURIComponent(this.config.requisitionId)}/`)
    url.searchParams.set('state', input.state)
    url.searchParams.set('redirect', input.redirectUri)
    return url.toString()
  }

  async exchangeAuthorizationCode(): Promise<ProviderTokenResponse> {
    const token = await this.getApiToken(true)
    return {
      accessToken: token,
      expiresAt: new Date(Date.now() + 23 * 60 * 60_000).toISOString(),
    }
  }

  async refreshTokens(): Promise<ProviderTokenResponse> {
    const token = await this.getApiToken(true)
    return {
      accessToken: token,
      expiresAt: new Date(Date.now() + 23 * 60 * 60_000).toISOString(),
    }
  }

  async revoke(): Promise<void> {
    this.token = undefined
  }

  async fetchTransactions(input: { accessToken: string; cursor?: string }): Promise<ProviderSyncPage> {
    const endpoint = new URL(`${this.baseUrl}/accounts/${encodeURIComponent(this.config.accountId)}/transactions/`)
    if (input.cursor) endpoint.searchParams.set('date_from', input.cursor)
    const response = await this.fetcher(endpoint.toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`GoCardless transaction request failed with HTTP ${response.status}.`)
    const body = object(await response.json(), 'transactions')
    const transactions = object(body.transactions, 'transactions collection')
    const booked = Array.isArray(transactions.booked) ? transactions.booked.map(normalizeTransaction) : []
    const pending = Array.isArray(transactions.pending)
      ? transactions.pending.map((entry) => ({ ...normalizeTransaction(entry), pending: true }))
      : []
    const all = [...booked, ...pending]
    const latestDate = all.reduce<string | undefined>((latest, transaction) =>
      !latest || transaction.bookedAt > latest ? transaction.bookedAt : latest, input.cursor)
    return { transactions: all, nextCursor: undefined, completed: true, ...(latestDate ? {} : {}) }
  }

  private async getApiToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.access
    const response = await this.fetcher(`${this.baseUrl}/token/new/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret_id: this.config.secretId, secret_key: this.config.secretKey }),
    })
    if (!response.ok) throw new Error(`GoCardless token request failed with HTTP ${response.status}.`)
    const body = object(await response.json(), 'token')
    const access = text(body.access, 'access token')
    const expires = typeof body.access_expires === 'number' ? body.access_expires : 86_400
    this.token = { access, expiresAt: Date.now() + expires * 1000 }
    return access
  }
}
