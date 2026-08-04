# Issue 105 provider setup

## Bank and PayPal redirects

Finance Planner starts provider authorization from the Node connector. The browser sends the selected institution ID, display name, requested account type, country, and an exact return URI. The server validates the return URI origin, issues a short-lived single-use state value, stores setup metadata server-side, and redirects to the provider.

Production provider dashboards must allow only the exact HTTPS callback and return URIs for the deployed `APP_ORIGIN`. Bank credentials, PayPal passwords, provider access tokens, refresh tokens, and PSD2 consent secrets must never be returned to the browser or passed into the COBOL process.

Required provider variables are documented in `.env.example`. PayPal should initially be verified against the sandbox environment. GoCardless, finAPI, PayPal, and other PSD2 capabilities remain provider-dependent until credentials, supported institutions, and callback behavior are tested in the deployed runtime.

## Institution and account selection

The frontend directory supports name, aliases, BIC, and BLZ search. Institution selection is passed to the connector start request. Providers may ignore this hint when their hosted consent screen owns institution selection.

After synchronization, Finance Planner displays discovered accounts before import. The user can deselect accounts, and transactions belonging to deselected accounts are excluded from the import preview. Manual accounts and manual credit cards do not leave Finance Planner.

## Credit cards

Credit-card balances use these conventions:

- `amountOwedCents` is positive debt.
- account `balanceCents` is the corresponding negative ledger liability.
- pending card amounts and minimum payments are positive magnitudes.
- available credit is never negative.
- missing provider limits remain undefined rather than being guessed.

The compiled GnuCOBOL banking core is authoritative for deterministic normalization. Node remains responsible for provider JSON, authentication, process execution, validation, encryption, and persistence.

## Passkeys and device lock

Set `WEBAUTHN_RP_ID` to the exact relying-party domain and use HTTPS in production. Biometric information never reaches Finance Planner; the operating system or authenticator performs user verification and returns a signed WebAuthn assertion.

The client supports passkey enrollment and authentication against the existing `/api/auth/passkeys/*` routes. Recently used account identifiers and email addresses may be remembered locally to present an account switcher; switching still requires a fresh passkey assertion.

## Google subscriptions

Google does not provide one universal API containing every Google Play, Google Store, and third-party subscription. Finance Planner must use only explicitly supported Google APIs or user-provided account-data exports. It must never scrape Google account pages.

The client contract supports authorization, refresh, disconnect, deletion, normalization, and reconciliation. Imported Google subscriptions are deduplicated against recurring bank transactions using normalized merchant/product text and a conservative amount tolerance. Where Google exposes no supported source, the UI must state that limitation and offer a manual subscription fallback.

`GOOGLE_SUBSCRIPTIONS_ENABLED` must remain `false` until a supported server-side data source is configured and runtime-tested. Enabling Google login alone does not prove that subscription import works.

## Verification checklist

1. Run frontend unit tests and TypeScript compilation.
2. Run backend tests with PostgreSQL and the compiled COBOL binaries.
3. Run callback replay and invalid-state tests.
4. Verify PayPal sandbox redirect and return behavior.
5. Verify at least one supported PSD2 institution in a non-production test account.
6. Verify WebAuthn on Android, iOS, Windows, and a recovery/fallback path.
7. Verify Google subscription deletion and provider revocation where supported.
8. Confirm logs redact tokens, authorization codes, account identifiers, and personal transaction data.
