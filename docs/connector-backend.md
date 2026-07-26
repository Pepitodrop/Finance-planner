# Connector backend contract

The browser application never receives provider client secrets, PSD2 certificates, bank credentials, access tokens, or refresh tokens. Those values belong in a server-side secret manager.

## Browser endpoints

### `POST /api/connectors/:provider/start`

Supported providers: `gocardless`, `finapi`, `paypal`.

Request:

```json
{
  "redirectUri": "https://app.example.de/",
  "country": "DE"
}
```

Response:

```json
{
  "redirectUrl": "https://provider.example/consent/..."
}
```

The backend must bind the flow to the authenticated application session, generate and validate an anti-CSRF state value, allow-list redirect origins, and store provider tokens encrypted at rest.

### `POST /api/connectors/sync`

Response:

```json
{
  "connections": [
    {
      "connection": {
        "id": "connection-id",
        "provider": "gocardless",
        "displayName": "Example Bank",
        "status": "connected",
        "lastSyncAt": "2026-07-26T16:00:00.000Z",
        "consentExpiresAt": "2026-10-24T16:00:00.000Z"
      },
      "accounts": [
        {
          "externalId": "provider-account-id",
          "name": "Girokonto",
          "type": "checking",
          "balanceCents": 125000,
          "currency": "EUR"
        }
      ],
      "transactions": [
        {
          "externalId": "provider-transaction-id",
          "externalAccountId": "provider-account-id",
          "description": "Kartenzahlung Händler",
          "amountCents": -1299,
          "currency": "EUR",
          "bookingDate": "2026-07-25",
          "pending": false
        }
      ]
    }
  ]
}
```

Amounts are signed integer cents at the connector boundary. Positive values are income; negative values are expenses. The web client converts them to its unsigned amount plus transaction-type representation.

## GoCardless Bank Account Data

Server flow:

1. Exchange `secret_id` and `secret_key` for provider tokens.
2. List institutions for the selected country.
3. Create an end-user agreement and requisition.
4. Redirect the user to the bank-hosted consent flow.
5. Resolve the requisition after callback.
6. Fetch account details, balances, booked transactions, and pending transactions.
7. Renew consent when it expires.

## finAPI

Use finAPI only from the backend. Store client credentials and user/access tokens in a secret manager or encrypted database. Map finAPI accounts and transactions into the common response contract above.

## PayPal

The PayPal Transaction Search API uses OAuth 2.0 and is intended for PayPal Business reporting. Third-party account access requires the relevant PayPal partner arrangement. The backend exchanges the client ID and client secret for an access token and pages through `/v1/reporting/transactions`, respecting the maximum date window and pagination limits.

## Mandatory production controls

- HTTPS only
- authenticated user sessions
- CSRF state validation for every redirect flow
- encrypted provider tokens at rest
- strict redirect-origin allow-list
- no credentials in query strings or browser storage
- structured audit log without raw financial descriptions
- rate limiting and provider backoff
- idempotent synchronization jobs
- consent-expiry handling
- deletion and revocation endpoint
- webhook signature verification where supported
