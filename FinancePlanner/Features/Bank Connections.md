# Bank Connections

Finance Planner is a **read-only account-information application** — it never initiates payments, transfers, payouts, orders or mandates (`docs/OPEN_BANKING_ARCHITECTURE.md`).

## Architecture

`server/src/providers.js` defines a generic `OpenBankingProvider` contract + `OpenBankingProviderRegistry`. Each adapter declares read-only capabilities and implements setup, callback, sync, disconnect, health and metrics. Currently registered:

- `gocardless` — GoCardless Bank Account Data API (PSD2 AISP), `GoCardlessProvider` class: institution lookup → end-user agreement → requisition creation/link → paginated transaction retrieval.
- `paypal` — see [[PayPal]].
- `finapi` — explicit unavailable placeholder, deliberately left for a future real adapter (see [[Rejected Approaches]]).

## Consent flow / credential boundary

The browser sends the selected institution ID; the server validates the return-URI origin, issues a short-lived single-use state value, stores setup metadata server-side, and redirects to the provider. Bank credentials/tokens are never returned to the browser or passed into the COBOL process (`docs/issue-105-provider-setup.md`). Consent expiry is tracked server-side (`gocardlessConsentExpiresAt()`), and the consent status is validated through the COBOL core (`core.validateProviderConsent`) before being trusted.

## COBOL boundary

See [[COBOL Domain Core]] — account-type normalization, fixed-point amount conversion, consent-state classification, scope enforcement, and reconciliation all happen in the compiled COBOL binary, not Node. Provider data is not accepted into state until COBOL validates it.

## Implementation vs verification

Real, complete integration code against the live GoCardless REST API — not a mock — but provider-credential-dependent (`GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`). `docs/issue-105-provider-setup.md`: "GoCardless, finAPI, PayPal, and other PSD2 capabilities remain provider-dependent until credentials, supported institutions, and callback behavior are tested in the deployed runtime."

- `.github/workflows/runtime-canaries.yml` — weekly + manual, checks GoCardless **control-plane access only** (can authenticate), credential-gated, non-blocking unless `require_all`/`PROVIDER_CANARY_REQUIRE_ALL` is set.
- `docs/issue-105-live-verification.md` — full consent→sync→reauthorize→disconnect flow requires a **human** to complete it manually against a sandbox account, recorded with date/environment/test account/result. Not automatable, not done by CI.
- `docs/bank-connection-production.md`: "A provider must not be enabled for real users until every critical control in `src/bankProduction.ts` is verified in the deployed environment... Passing unit tests proves the domain controls behave correctly. It does not replace deployment evidence, provider certification, security review, or sandbox end-to-end results."

## Known limitations

README lists "live GoCardless/PayPal certification and reconciliation testing" as outstanding. `docs/bank-production-runbook.md` describes the required operational posture (KMS-backed secrets, webhook signature verification, alerting) as a target, not a confirmed-deployed state.

Verification state: **implemented / not runtime or production verified — no evidence of a completed end-to-end consent+sync cycle found in-repo.**

## Detailed subgraph

[[GoCardless]] (in [[Providers Index]]) holds the atomic verification-status breakdown; [[Bank Connection Flow]], [[Bank Consent Flow]], [[Bank Sync Flow]], [[Bank Disconnect Flow]] (in [[Flows Index]]) hold the step-by-step sequences; [[Banking Core Module]] and its responsibility nodes (in [[COBOL Index]]) hold the deterministic validation detail.

Related: [[PayPal]], [[COBOL Domain Core]], [[Provider Status]], [[Architecture Decisions]], [[Providers Index]], [[Flows Index]]
