import type {
  BankProviderAdapter,
  ProviderAuthorizationSession,
  ProviderConnectionResponse,
  ProviderSyncPage,
  ProviderTokenResponse,
  ProviderTransaction,
} from './bankRuntime'

interface HttpResponse { ok: boolean; status: number; json(): Promise<unknown> }

export interface GoCardlessProviderConfig {
  baseUrl?: string
  secretId: string
  secretKey: string
  institutionId: string
  accessValidForDays?: number
  userLanguage?: string
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
function normalizeTransaction(value: unknown, pending: boolean): ProviderTransaction {
  const transaction = object(value, 'transaction')
  const transactionAmount = object(transaction.transactionAmount, 'transaction amount')
  const bookedAt = text(transaction.bookingDate ?? transaction.bookingDateTime ?? transaction.valueDate, 'booking date')
  const identifier = transaction.transactionId ?? transaction.internalTransactionId
    ?? `${bookedAt}:${String(transactionAmount.amount)}:${String(transaction.remittanceInformationUnstructured ?? '')}`
  return {
    id: text(identifier, 'transaction identifier'),
    bookedAt: bookedAt.slice(0, 10),
    amountCents: amountToCents(transactionAmount.amount),
    currency: text(transactionAmount.currency, 'transaction currency'),
    description: String(transaction.remittanceInformationUnstructured ?? transaction.creditorName ?? transaction.debtorName ?? 'Bank transaction'),
    pending,
  }
}

export class GoCardlessBankProvider implements BankProviderAdapter {
  readonly name = 'gocardless-bank-account-data'
  private readonly baseUrl: string
  private readonly fetcher: (url: string, init?: RequestInit) => Promise<HttpResponse>
  private token?: { access: string; refresh: string; accessExpiresAt: number; refreshExpiresAt: number }

  constructor(private readonly config: GoCardlessProviderConfig) {
    this.baseUrl = config.baseUrl ?? 'https://bankaccountdata.gocardless.com/api/v2'
    this.fetcher = config.fetcher ?? fetch
  }

  async createAuthorization(input: { state: string; redirectUri: string; reference: string }): Promise<ProviderAuthorizationSession> {
    const accessToken = await this.getAccessToken()
    const redirect = new URL(input.redirectUri)
    redirect.searchParams.set('state', input.state)
    const response = await this.fetcher(`${this.baseUrl}/requisitions/`, {
      method: 'POST',
      headers: this.headers(accessToken, true),
      body: JSON.stringify({
        redirect: redirect.toString(),
        institution_id: this.config.institutionId,
        reference: input.reference,
        user_language: this.config.userLanguage ?? 'EN',
      }),
    })
    if (!response.ok) throw new Error(`GoCardless requisition creation failed with HTTP ${response.status}.`)
    const body = object(await response.json(), 'requisition')
    return { authorizationUrl: text(body.link, 'authorization link'), connectionId: text(body.id, 'requisition id') }
  }

  async completeAuthorization(input: { connectionId: string }): Promise<ProviderConnectionResponse> {
    const accessToken = await this.getAccessToken()
    const response = await this.fetcher(`${this.baseUrl}/requisitions/${encodeURIComponent(input.connectionId)}/`, {
      headers: this.headers(accessToken),
    })
    if (!response.ok) throw new Error(`GoCardless requisition lookup failed with HTTP ${response.status}.`)
    const body = object(await response.json(), 'requisition')
    const status = text(body.status, 'requisition status')
    if (status !== 'LN') throw new Error(`GoCardless requisition is not linked (status ${status}).`)
    const accountIds = Array.isArray(body.accounts) ? body.accounts.map((id) => text(id, 'account id')) : []
    if (accountIds.length === 0) throw new Error('GoCardless requisition has no linked accounts.')
    const token = this.token
    if (!token) throw new Error('GoCardless API token is unavailable.')
    return {
      accessToken: token.access,
      refreshToken: token.refresh,
      accessTokenExpiresAt: new Date(token.accessExpiresAt).toISOString(),
      consentExpiresAt: new Date(Date.now() + (this.config.accessValidForDays ?? 90) * 86_400_000).toISOString(),
      accountIds,
    }
  }

  async refreshTokens(refreshToken: string): Promise<ProviderTokenResponse> {
    const response = await this.fetcher(`${this.baseUrl}/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    })
    if (!response.ok) throw new Error(`GoCardless token refresh failed with HTTP ${response.status}.`)
    const body = object(await response.json(), 'token refresh')
    const access = text(body.access, 'access token')
    const expires = typeof body.access_expires === 'number' ? body.access_expires : 86_400
    const accessExpiresAt = Date.now() + expires * 1000
    if (this.token?.refresh === refreshToken) this.token = { ...this.token, access, accessExpiresAt }
    return { accessToken: access, accessTokenExpiresAt: new Date(accessExpiresAt).toISOString() }
  }

  async revoke(_accessToken: string, connectionId?: string): Promise<void> {
    if (connectionId) {
      const accessToken = await this.getAccessToken()
      const response = await this.fetcher(`${this.baseUrl}/requisitions/${encodeURIComponent(connectionId)}/`, {
        method: 'DELETE', headers: this.headers(accessToken),
      })
      if (!response.ok && response.status !== 404) throw new Error(`GoCardless requisition deletion failed with HTTP ${response.status}.`)
    }
  }

  async fetchTransactions(input: { accessToken: string; accountIds: string[]; cursor?: string }): Promise<ProviderSyncPage> {
    if (input.accountIds.length === 0) throw new Error('No linked GoCardless accounts are available.')
    const all: ProviderTransaction[] = []
    for (const accountId of input.accountIds) {
      const endpoint = new URL(`${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/transactions/`)
      if (input.cursor) endpoint.searchParams.set('date_from', input.cursor)
      const response = await this.fetcher(endpoint.toString(), { headers: this.headers(input.accessToken) })
      if (!response.ok) throw new Error(`GoCardless transaction request failed with HTTP ${response.status}.`)
      const body = object(await response.json(), 'transactions')
      const transactions = object(body.transactions, 'transactions collection')
      const booked = Array.isArray(transactions.booked) ? transactions.booked.map((entry) => normalizeTransaction(entry, false)) : []
      const pending = Array.isArray(transactions.pending) ? transactions.pending.map((entry) => normalizeTransaction(entry, true)) : []
      all.push(...booked, ...pending)
    }
    const latestDate = all.reduce<string | undefined>((latest, transaction) =>
      !latest || transaction.bookedAt > latest ? transaction.bookedAt : latest, input.cursor)
    return { transactions: all, nextCursor: latestDate, completed: true }
  }

  private headers(accessToken: string, json = false): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) }
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.accessExpiresAt > Date.now() + 60_000) return this.token.access
    if (this.token && this.token.refreshExpiresAt > Date.now() + 60_000) {
      const refreshed = await this.refreshTokens(this.token.refresh)
      return refreshed.accessToken
    }
    const response = await this.fetcher(`${this.baseUrl}/token/new/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret_id: this.config.secretId, secret_key: this.config.secretKey }),
    })
    if (!response.ok) throw new Error(`GoCardless token request failed with HTTP ${response.status}.`)
    const body = object(await response.json(), 'token')
    const access = text(body.access, 'access token')
    const refresh = text(body.refresh, 'refresh token')
    const accessExpires = typeof body.access_expires === 'number' ? body.access_expires : 86_400
    const refreshExpires = typeof body.refresh_expires === 'number' ? body.refresh_expires : 2_592_000
    this.token = {
      access,
      refresh,
      accessExpiresAt: Date.now() + accessExpires * 1000,
      refreshExpiresAt: Date.now() + refreshExpires * 1000,
    }
    return access
  }
}
