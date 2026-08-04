# Read-only open-banking architecture

Finance Planner is an account-information application. It does not initiate payments, transfers, payouts, orders, mandates, or other money movement.

## Provider contract

`server/src/providers.js` exposes a generic `OpenBankingProvider` contract and `OpenBankingProviderRegistry`.

A provider adapter must declare read-only capabilities and implement:

- configuration detection;
- provider-hosted consent or owner-account connection setup;
- account, balance, and transaction synchronization;
- normalized reconciliation output.

The registry currently includes:

- `gocardless`: PSD2 account-information adapter;
- `paypal`: PayPal reporting adapter, with owner-account and partner modes;
- `finapi`: explicit unavailable placeholder until a real adapter is implemented and tested.

A replacement licensed PSD2 AISP can be added as another adapter without changing the deterministic banking-domain rules.

## COBOL boundary

GnuCOBOL is authoritative for banking-domain decisions:

- provider account-type normalization;
- fixed-point provider amount conversion;
- provider consent-state classification;
- read-only scope enforcement;
- credit-card normalization.

Node.js is limited to generic HTTP/TLS transport, OAuth redirects, provider JSON transport, encrypted persistence, sessions, and operational controls. Provider responses are not accepted into Finance Planner state until the COBOL banking core validates the relevant financial and consent semantics.

Production images set `COBOL_BANKING_REQUIRED=true`, so these decisions fail closed if the compiled banking core is unavailable.

## Readiness semantics

- `/health/ready` reports core application readiness. It can be ready when automatic bank monitoring is not configured.
- `/health/bank` reports automatic account-information capability and returns unavailable until at least one supported read-only provider is configured.
- Missing provider credentials are a bank-capability limitation, not a core application outage.

## PayPal modes

`PAYPAL_CONNECTION_MODE=owner` monitors the PayPal Business account associated with the configured REST application through the Transaction Search reporting API. It does not require partner onboarding and does not expose payment APIs.

`PAYPAL_CONNECTION_MODE=partner` retains the provider-hosted partner onboarding path and requires `PAYPAL_PARTNER_MERCHANT_ID` plus webhook verification.

When the variable is omitted, Finance Planner selects partner mode only when a partner merchant ID is present; otherwise it uses owner mode.

## Security invariant

Every registered provider reports these capabilities as false:

- payment initiation;
- transfers;
- payouts;
- orders;
- mandates.

The COBOL core separately rejects provider scope strings containing money-movement terms.
