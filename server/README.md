# Connector backend

Node 22 service for bank and PayPal synchronization. Provider credentials and refresh/access tokens never enter the browser. The server stores connection metadata in an AES-256-GCM encrypted file and exposes only normalized EUR accounts and transactions.

## Local sandbox setup

```bash
cd server
cp .env.example .env
# fill SESSION_SECRET and CONNECTOR_MASTER_KEY with independent random values
set -a && . ./.env && set +a
npm test
npm start
```

Use `http://localhost:8787` as the connector backend in the app. With `AUTH_MODE=local`, the web client creates a local HttpOnly session automatically. Never enable local auth on a public deployment.

## GoCardless Bank Account Data

Create sandbox credentials and set `GOCARDLESS_SECRET_ID` and `GOCARDLESS_SECRET_KEY`. Optionally set a sandbox institution ID. The service creates an end-user agreement and requisition, redirects the user to bank consent, then reads account details, balances, booked transactions and pending transactions.

## PayPal

Set sandbox client credentials. Owner-reporting mode reads the authenticated app owner's transaction report. Third-party PayPal accounts require approved partner onboarding and the appropriate permissions; configure `PAYPAL_PARTNER_MERCHANT_ID` after approval.

## Production requirements

- HTTPS behind a reverse proxy
- real application authentication instead of `AUTH_MODE=local`
- secrets from a secret manager, not `.env` files
- a managed encrypted database or KMS-backed credential store
- rate limiting, audit logging and consent-expiry jobs
- provider webhook verification where available
- explicit user disconnect and provider-token revocation
- backup and key-rotation procedures

The encrypted file store is suitable for sandbox and single-instance deployments. It is not a replacement for a transactional multi-instance production database.
