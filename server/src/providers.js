const GC_BASE = 'https://bankaccountdata.gocardless.com/api/v2'
const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com'
const PAYPAL_LIVE = 'https://api-m.paypal.com'

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`${response.status} ${body.detail ?? body.error_description ?? body.error ?? 'Provider request failed'}`)
  return body
}

export async function gocardlessToken(env) {
  return jsonFetch(`${GC_BASE}/token/new/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: env.GOCARDLESS_SECRET_ID, secret_key: env.GOCARDLESS_SECRET_KEY }),
  })
}

export async function startGoCardless({ env, state, redirectUri, country = 'DE' }) {
  if (!env.GOCARDLESS_SECRET_ID || !env.GOCARDLESS_SECRET_KEY) throw new Error('GoCardless credentials are not configured.')
  const token = await gocardlessToken(env)
  const institutions = await jsonFetch(`${GC_BASE}/institutions/?country=${encodeURIComponent(country)}`, { headers: { Authorization: `Bearer ${token.access}` } })
  const institutionId = env.GOCARDLESS_INSTITUTION_ID || institutions[0]?.id
  if (!institutionId) throw new Error('No GoCardless institution is available for this country.')
  const agreement = await jsonFetch(`${GC_BASE}/agreements/enduser/`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ institution_id: institutionId, max_historical_days: 90, access_valid_for_days: 90, access_scope: ['balances', 'details', 'transactions'] }),
  })
  const requisition = await jsonFetch(`${GC_BASE}/requisitions/`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect: redirectUri, institution_id: institutionId, agreement: agreement.id, reference: state, user_language: 'DE' }),
  })
  return { redirectUrl: requisition.link, credential: { requisitionId: requisition.id, token, institutionId } }
}

export async function syncGoCardless(credential, env) {
  let token = credential.token
  if (!token?.access || (token.access_expires && token.access_expires < 120)) token = await gocardlessToken(env)
  const requisition = await jsonFetch(`${GC_BASE}/requisitions/${credential.requisitionId}/`, { headers: { Authorization: `Bearer ${token.access}` } })
  const accounts = []
  const transactions = []
  for (const accountId of requisition.accounts ?? []) {
    const [details, balances, tx] = await Promise.all([
      jsonFetch(`${GC_BASE}/accounts/${accountId}/details/`, { headers: { Authorization: `Bearer ${token.access}` } }),
      jsonFetch(`${GC_BASE}/accounts/${accountId}/balances/`, { headers: { Authorization: `Bearer ${token.access}` } }),
      jsonFetch(`${GC_BASE}/accounts/${accountId}/transactions/`, { headers: { Authorization: `Bearer ${token.access}` } }),
    ])
    const account = details.account ?? {}
    const balance = balances.balances?.find((item) => item.balanceAmount?.currency === 'EUR')?.balanceAmount?.amount ?? '0'
    accounts.push({ externalId: accountId, name: account.name || account.product || account.iban || 'Bankkonto', type: 'checking', balanceCents: Math.round(Number(balance) * 100), currency: 'EUR' })
    for (const [pending, rows] of [[false, tx.transactions?.booked ?? []], [true, tx.transactions?.pending ?? []]]) {
      for (const item of rows) {
        if (item.transactionAmount?.currency !== 'EUR') continue
        transactions.push({
          externalId: item.transactionId || `${accountId}:${item.bookingDate || item.valueDate}:${item.transactionAmount.amount}:${item.remittanceInformationUnstructured || ''}`,
          externalAccountId: accountId,
          description: item.creditorName || item.debtorName || item.remittanceInformationUnstructured || item.additionalInformation || 'Banktransaktion',
          amountCents: Math.round(Number(item.transactionAmount.amount) * 100), currency: 'EUR',
          bookingDate: item.bookingDate || item.valueDate || new Date().toISOString().slice(0, 10), pending,
        })
      }
    }
  }
  return { accounts, transactions, credential: { ...credential, token }, consentExpiresAt: requisition.status === 'LN' ? undefined : null }
}

async function paypalAccessToken(env) {
  const base = env.PAYPAL_ENV === 'live' ? PAYPAL_LIVE : PAYPAL_SANDBOX
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const token = await jsonFetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  return { base, token }
}

export async function startPayPal({ env, state, redirectUri }) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal credentials are not configured.')
  if (!env.PAYPAL_PARTNER_MERCHANT_ID) {
    return { redirectUrl: `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}connector=paypal&state=${encodeURIComponent(state)}`, credential: { mode: 'owner-reporting' } }
  }
  const base = env.PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com'
  const url = new URL(`${base}/bizsignup/partner/entry`)
  url.searchParams.set('partnerId', env.PAYPAL_PARTNER_MERCHANT_ID)
  url.searchParams.set('returnToPartnerUrl', redirectUri)
  url.searchParams.set('partnerClientId', env.PAYPAL_CLIENT_ID)
  url.searchParams.set('state', state)
  return { redirectUrl: url.toString(), credential: { mode: 'partner', pending: true } }
}

export async function syncPayPal(credential, env) {
  const { base, token } = await paypalAccessToken(env)
  const end = new Date()
  const start = new Date(end.getTime() - 31 * 86400000)
  const url = new URL(`${base}/v1/reporting/transactions`)
  url.searchParams.set('start_date', start.toISOString())
  url.searchParams.set('end_date', end.toISOString())
  url.searchParams.set('fields', 'all')
  url.searchParams.set('page_size', '500')
  const report = await jsonFetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } })
  let balanceCents = 0
  const transactions = []
  for (const row of report.transaction_details ?? []) {
    const info = row.transaction_info ?? {}
    if (info.transaction_amount?.currency_code !== 'EUR') continue
    const amountCents = Math.round(Number(info.transaction_amount.value) * 100)
    balanceCents += amountCents
    transactions.push({ externalId: info.transaction_id, externalAccountId: 'paypal-eur', description: info.transaction_subject || info.transaction_note || info.transaction_event_code || 'PayPal', amountCents, currency: 'EUR', bookingDate: String(info.transaction_initiation_date || '').slice(0, 10), pending: info.transaction_status === 'P' })
  }
  return { accounts: [{ externalId: 'paypal-eur', name: 'PayPal EUR', type: 'cash', balanceCents, currency: 'EUR' }], transactions, credential }
}
