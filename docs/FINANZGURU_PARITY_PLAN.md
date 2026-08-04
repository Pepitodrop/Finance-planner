# Finanzguru-style bank onboarding and account enrichment

This document defines the implementation contract for four product changes:

1. import Google Play / Google Payments subscriptions;
2. expose credit-card balances and available credit;
3. provide a low-friction, Finanzguru-inspired login and bank-connection flow;
4. execute deterministic bank-domain logic in COBOL.

The screenshots supplied for reference are treated as interaction inspiration only. Branding, copy, artwork and proprietary visual assets must remain original.

## Product flow

### Authentication

The app should open with a simple returning-user screen and provide:

- passkey/device-lock sign-in as the primary action when available;
- Google sign-in;
- email sign-in / registration;
- explicit account switching;
- a recovery path that does not reveal whether an account exists.

After first authentication, the user is prompted to enable WebAuthn/passkey or device lock. The existing encrypted local vault remains separate from account authentication.

### Bank connection

The connection wizard is a short state machine:

1. **Choose institution** — search by bank name, BIC or BLZ; display frequently used institutions and provider availability.
2. **Choose access type** — current account, cards/savings/investments, institution-specific investment access, or manual/virtual account.
3. **Consent and redirect** — explain that credentials are entered only on the regulated provider/bank page; launch the provider authorization flow.
4. **Select accounts** — list discovered accounts and allow selecting one or all.
5. **Synchronize** — show progress, partial errors and a retry action.
6. **Success** — summarize imported accounts, balances and recurring payments.

The application must not implement a first-party form that collects live online-banking PINs or passwords. Provider-hosted OAuth/PSD2 authorization is the production route. A credential-like screen may exist only as an explicitly marked local demo fixture with no network submission.

## Google subscriptions

Google OAuth sign-in alone does not provide a consumer's complete Google Play subscription list. The implementation therefore supports two sources:

- **Google Payments/Play email discovery**: with explicit Gmail read-only consent, scan only matching Google receipt/subscription messages, normalize merchant, amount, cadence, next billing date and source message ID, then store the minimum derived record. Raw message bodies are not persisted.
- **Developer-owned Play purchases**: for subscriptions sold by this app, validate purchase tokens server-side through the official Android Publisher API.

The UI must label inferred email-derived entries and allow confirmation or deletion. Duplicate records are merged using provider ID, merchant, amount, cadence and billing-date proximity.

## Credit-card balances

Extend the normalized account model with optional credit fields:

```ts
interface CreditAccountDetails {
  bookedBalanceCents: number;
  pendingAmountCents?: number;
  statementBalanceCents?: number;
  creditLimitCents?: number;
  availableCreditCents?: number;
  minimumPaymentCents?: number;
  paymentDueDate?: string;
  lastStatementDate?: string;
}
```

Provider values must be preserved with their timestamps and provenance. Where `availableCredit` is absent but a credit limit and current utilized balance exist, COBOL may derive it deterministically. The UI must distinguish:

- current/booked balance;
- pending card transactions;
- statement amount;
- credit limit;
- available credit;
- payment due date.

No field may silently substitute for another.

## COBOL boundary

All deterministic bank-domain decisions run through compiled GnuCOBOL modules under `core/cobol/banking/`. JavaScript remains responsible for HTTP, OAuth, encryption, persistence and provider adapters.

COBOL responsibilities:

- normalize provider account categories;
- compute signed balances and available credit in integer cents;
- map provider transaction state to booked/pending;
- calculate synchronization status from provider result codes;
- score recurring-payment candidates;
- generate deterministic deduplication keys from normalized input fields.

Non-COBOL responsibilities:

- TLS and HTTP transport;
- OAuth/PSD2 redirects and token exchange;
- Google API calls;
- secrets and key management;
- database access;
- JSON parsing and schema validation;
- provider-specific pagination and webhook verification.

The server invokes COBOL through a narrow adapter with versioned input/output records. It must fail closed when the binary is unavailable or returns invalid output; financial values are never recalculated with floating point.

## API changes

Suggested endpoints:

```http
GET  /api/institutions?q=
POST /api/bank-connections/authorize
GET  /api/bank-connections/:id/status
POST /api/bank-connections/:id/accounts/import
POST /api/bank-connections/:id/sync
GET  /api/accounts/:id/credit-details
POST /api/google/subscriptions/connect
POST /api/google/subscriptions/sync
GET  /api/google/subscriptions
DELETE /api/google/subscriptions/:id
```

Every mutation requires an authenticated session, CSRF protection where applicable, explicit consent and idempotency.

## Acceptance criteria

- A returning user can sign in with a passkey/device lock in one primary action.
- A new user can sign in with Google or email and is offered passkey enrollment.
- Bank selection supports name, BIC and BLZ search and is usable on a 360-pixel-wide viewport.
- Live bank credentials never transit through or persist in Finance Planner.
- A connected credit-card account shows booked, pending, statement and available-credit values when supplied.
- Google-derived subscriptions show their source and confidence and can be confirmed or removed.
- COBOL tests cover positive, negative, zero, missing-field and overflow boundaries using integer cents.
- Provider adapters and COBOL logic have contract tests with recorded, redacted fixtures.
- Accessibility tests cover keyboard navigation, labels, error summaries and progress announcements.
- Existing encrypted cloud-state and offline-vault behavior remains compatible.

## Delivery slices

1. **Domain and COBOL contracts** — account/credit schemas, COBOL programs, adapter and tests.
2. **Institution directory and authorization wizard** — search, account type, redirect, progress and completion.
3. **Credit-card enrichment** — provider mapping, persistence, API and account detail UI.
4. **Authentication redesign** — returning-user, registration, Google, email and passkey enrollment screens.
5. **Google subscription discovery** — consent, Gmail query, normalization, confirmation and deduplication.
6. **Production hardening** — provider certification, threat model, accessibility, mobile E2E and operational dashboards.
