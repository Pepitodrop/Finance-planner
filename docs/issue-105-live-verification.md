# Issue 105 live-provider verification

This runbook covers the credential-dependent checks that cannot be proven by mocked CI alone.

## Required deployment

Use an HTTPS deployment with PostgreSQL persistence, encrypted connector storage, production session settings, and exact provider callback allowlists. Never paste provider secrets into browser configuration or commit them to Git.

## PayPal

1. Create a PayPal sandbox application and partner/merchant test account.
2. Configure `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and, for partner onboarding, `PAYPAL_PARTNER_MERCHANT_ID`.
3. Register the exact Finance Planner callback/return URL.
4. Set `VERIFY_PAYPAL=true` and run the verification command.
5. Complete the redirect manually, confirm return to Finance Planner, synchronize transactions, refresh, disconnect, and confirm provider revocation where the PayPal account model supports it.

The owner-reporting fallback is not equivalent to third-party user authorization and must not be presented as such.

## GoCardless / PSD2

1. Configure a sandbox or non-production GoCardless Bank Account Data account.
2. Set `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`, and an institution ID supported by the test account.
3. Set `VERIFY_GOCARDLESS=true` and run the verification command.
4. Complete bank consent, verify callback state is single-use, select discovered accounts, synchronize, reauthorize, and disconnect.

Never use a real user's primary bank account for initial verification.

## Google subscriptions

Google does not expose every Google Play, Google Store, or third-party subscription through one universal API. Finance Planner supports only an explicitly configured HTTPS data source that the operator has verified is permitted and stable.

Set:

- `GOOGLE_SUBSCRIPTIONS_ENABLED=true`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SUBSCRIPTIONS_SCOPES`
- `GOOGLE_SUBSCRIPTIONS_DATA_SOURCE`
- `VERIFY_GOOGLE_SUBSCRIPTIONS=true`

The source response must use:

```json
{
  "subscriptions": [
    {
      "externalId": "provider-stable-id",
      "provider": "Google Play",
      "product": "Product name",
      "amountCents": 199,
      "currency": "EUR",
      "billingInterval": "monthly",
      "nextChargeDate": "2026-09-01",
      "status": "active"
    }
  ]
}
```

Unsupported subscriptions must use the manual fallback. Scraping Google account pages is prohibited.

## Passkeys

Verify registration, login, account switching, cancellation, and fallback/recovery on Android, iOS, and Windows over HTTPS. Confirm that only WebAuthn public-key material is stored and that biometric data never reaches Finance Planner.

## Command

From `server/`:

```bash
VERIFY_APP_ORIGIN=https://finance.example \
VERIFY_SESSION_COOKIE='fp_session=...' \
VERIFY_PAYPAL=true \
VERIFY_GOCARDLESS=true \
VERIFY_GOOGLE_SUBSCRIPTIONS=true \
npm run verify:issue-105-live
```

The automated command verifies readiness and provider-hosted authorization starts. Human completion of the external consent screens and post-return data checks is still required and must be recorded with date, environment, provider test account, and result before issue #105 can be closed as live-verified.
