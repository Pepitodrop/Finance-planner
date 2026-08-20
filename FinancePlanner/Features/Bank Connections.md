# Bank Connections

Finance Planner is a **read-only account-information application** — it never initiates payments, transfers, payouts, orders or mandates (`docs/OPEN_BANKING_ARCHITECTURE.md`).

## Architecture

`server/src/providers.js` defines a generic `OpenBankingProvider` contract + `OpenBankingProviderRegistry`. Each adapter declares read-only capabilities and implements setup, callback, sync, disconnect, health and metrics. Currently registered:

- `enablebanking` — **preferred** AIS provider (added 2026-08-20), see [[Enable Banking]]: `EnableBankingProvider` class — ASPSP lookup → `POST /auth` redirect → authorization-code callback → `POST /sessions` exchange → `continuation_key`-paginated transaction retrieval.
- `gocardless` — **fallback** AIS provider, GoCardless Bank Account Data API (PSD2 AISP), `GoCardlessProvider` class: institution lookup → end-user agreement → requisition creation/link → paginated transaction retrieval.
- `paypal` — see [[PayPal]].
- `finapi` — explicit unavailable placeholder, deliberately left for a future real adapter (see [[Rejected Approaches]]).

## Bank identity vs. AIS provider (added 2026-08-20)

A bank in the picker catalogue (`src/institutions.ts`) has no fixed aggregator — `InstitutionProvider` uses a logical `'ais'` tag, not `'gocardless'`. ING is not GoCardless; ING is a bank that Enable Banking or GoCardless might separately be able to reach. Which concrete provider actually backs a given connection attempt is resolved at runtime (`resolveAisProvider()`, `src/features/connections/connectionsModel.ts`), in a fixed preference order (`AIS_PROVIDER_PREFERENCE = ['enablebanking', 'gocardless']`), never hard-coded on the catalogue and never guessed. The resolution happens transparently before any bank-specific network call — no "choose your aggregator" screen — and is fixed for the rest of that connection attempt once it begins (`ConnectionsPage.tsx`'s `resolvingProvider` state; `startConnector()` firing is a full-page navigation, so nothing can retarget an in-flight attempt after that point). If Enable Banking's live search for a specific bank comes back empty and GoCardless is independently available, an explicit, user-initiated "try another connection method" action offers the fallback — never an automatic switch. See [[Connections Page]] for the UI detail and [[Provider Institution Selection Contract]] for how each provider's own directory stays the anti-guessing source of truth.

## Consent flow / credential boundary

The browser sends the selected institution ID; the server validates the return-URI origin, issues a short-lived single-use state value, stores setup metadata server-side, and redirects to the provider. Bank credentials/tokens are never returned to the browser or passed into the COBOL process (`docs/issue-105-provider-setup.md`). Consent expiry is tracked server-side (`gocardlessConsentExpiresAt()`), and the consent status is validated through the COBOL core (`core.validateProviderConsent`) before being trusted.

The server validates the selected institution itself, not just the return URI: `GET /api/connectors/gocardless/institutions` exposes a sanitized, authenticated, cached live directory, and `start()` rejects any `institutionId` not present in it (never `institutions[0]`) — see [[Provider Institution Selection Contract]]. `GET /api/connectors` exposes sanitized per-provider availability/configuration so the frontend can't present an unconfigured or explicitly-unavailable provider as a normal choice.

## COBOL boundary

See [[COBOL Domain Core]] — account-type normalization, fixed-point amount conversion, consent-state classification, scope enforcement, and reconciliation all happen in the compiled COBOL binary, not Node. Provider data is not accepted into state until COBOL validates it.

## Implementation vs verification

Real, complete integration code against the live GoCardless REST API — not a mock — but provider-credential-dependent (`GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`). `docs/issue-105-provider-setup.md`: "GoCardless, finAPI, PayPal, and other PSD2 capabilities remain provider-dependent until credentials, supported institutions, and callback behavior are tested in the deployed runtime."

- `.github/workflows/runtime-canaries.yml` — weekly + manual, checks GoCardless **control-plane access only** (can authenticate), credential-gated, non-blocking unless `require_all`/`PROVIDER_CANARY_REQUIRE_ALL` is set.
- `docs/issue-105-live-verification.md` — full consent→sync→reauthorize→disconnect flow requires a **human** to complete it manually against a sandbox account, recorded with date/environment/test account/result. Not automatable, not done by CI.
- `docs/bank-connection-production.md`: "A provider must not be enabled for real users until every critical control in `src/bankProduction.ts` is verified in the deployed environment... Passing unit tests proves the domain controls behave correctly. It does not replace deployment evidence, provider certification, security review, or sandbox end-to-end results."

## Reconnect and healthy-connection disconnect (found + fixed 2026-08-18)

A Codex adversarial review found two real, previously-shipped defects, both verified directly against the code:

- **Reconnect was completely broken for GoCardless.** The "Reconnect" action called `startProvider(provider, {})` — an empty context, no `institutionId`. Once the institution-selection fix (2026-08-13, see [[Provider Institution Selection Contract]]) removed the `institutions[0]` fallback, `start()` began correctly throwing `institution_required` whenever no institution is supplied — which reconnect always did. Every "Reconnect" click failed. Fixed by exposing `institutionId` on the connection object returned from the server (`server.js`'s `connection()` helper — not a secret, the same id the picker already fetches from the live directory) and resubmitting it on reconnect.
- **A healthy, working connection had no Disconnect path anywhere in the UI.** Connection rows only became clickable — opening the one screen containing Disconnect — once `connectionNeedsAttention()` was true; a working connection rendered as an inert, unclickable `<div>`. Fixed by making every connection row clickable, opening a screen that shows neutral "Manage connection" copy for a healthy connection and the existing "needs attention" framing only when genuinely needed.

Both are `src/features/connections/ConnectionsPage.tsx` changes, covered by new tests in `ConnectionsPage.test.tsx`.

## Known limitations

README lists "live GoCardless/PayPal certification and reconciliation testing" as outstanding. `docs/bank-production-runbook.md` describes the required operational posture (KMS-backed secrets, webhook signature verification, alerting) as a target, not a confirmed-deployed state.

Verification state: **implemented / not runtime or production verified — no evidence of a completed end-to-end consent+sync cycle found in-repo.**

## Detailed subgraph

[[GoCardless]] (in [[Providers Index]]) holds the atomic verification-status breakdown; [[Bank Connection Flow]], [[Bank Consent Flow]], [[Bank Sync Flow]], [[Bank Disconnect Flow]] (in [[Flows Index]]) hold the step-by-step sequences; [[Banking Core Module]] and its responsibility nodes (in [[COBOL Index]]) hold the deterministic validation detail.

Related: [[Enable Banking]], [[GoCardless]], [[PayPal]], [[COBOL Domain Core]], [[Provider Status]], [[Architecture Decisions]], [[Providers Index]], [[Flows Index]], [[Provider Institution Selection Contract]], [[Connections Page]]
