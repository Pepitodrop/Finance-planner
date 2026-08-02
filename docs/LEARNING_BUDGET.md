# Persistent learning budget planner

The learning budget planner creates a monthly budget recommendation from the authenticated user's synchronized Finance Planner state.

## Data used

The deterministic planner may use transaction dates, amounts, categories, income/expense type, recurring status, liquid account balances, active savings goals, explicit budget preferences and prior recommendation feedback.

Transaction descriptions, account names, bank credentials, IBANs and precise coordinates are excluded from the persistent learning profile and the hosted model payload.

## Approximate location from the client IP

Location is optional and consented separately for every plan run.

When the user enables IP location for a run:

1. the server obtains the client address through the existing trusted-proxy logic;
2. the address is sent over HTTPS to the fixed `ipwho.is` free endpoint;
3. only country, region and city are requested;
4. the returned labels are normalized and instruction-like text is discarded;
5. the raw IP address is never stored in PostgreSQL, returned to the browser or included in the Hugging Face request.

The free endpoint does not require an API key and is limited to 1,000 requests per day from the server IP. `IP_GEOLOCATION_TIMEOUT_MS` may be set between 1,000 and 10,000 milliseconds; the default is 4,000.

For the Caddy production deployment, `TRUST_PROXY=true` is required so the connector uses the original visitor address rather than the local reverse-proxy address.

A successfully resolved coarse location may be stored encrypted in the learning profile. It is displayed as approximate and is not automatically reused. The location checkbox always starts disabled and is consumed after one plan request.

Only the ISO country code may be included in the hosted model context. Free-form city and region names are never sent to Hugging Face.

## Persistence

Migration `007_budget_learning_profiles.sql` creates `user_budget_learning_profiles`. Each profile is:

- bound to the authenticated user ID as AES-GCM additional authenticated data;
- encrypted with `CONNECTOR_MASTER_KEY` before storage;
- versioned and updated transactionally in PostgreSQL;
- deletable through `DELETE /api/ai/budget-profile`.

The profile stores derived category weights, monthly aggregates, preferences, coarse location and feedback counts. It does not train or store separate neural-network weights per user.

Feedback is accepted only for a recommendation from the most recently issued plan. Repeating the same decision for the same plan is idempotent; switching the decision replaces that plan's previous vote.

## Deterministic planning boundary

Budget amounts are calculated by `server/src/budget-learning.js`. The planner never creates transactions, changes balances, cancels contracts or moves money.

The optional Hugging Face model cannot generate the displayed summary or free-form financial claims. It returns only:

- a bounded confidence value;
- a recommendation ID already issued by the deterministic planner;
- one allowlisted emphasis value: `priority`, `habit`, `caution` or `motivation`.

The server maps those enum values to reviewed, number-free German sentences. Model output containing summaries, amounts, percentages, dates, arbitrary explanations or unknown recommendation IDs is rejected and the deterministic fallback is used.

## Hugging Face

The optional classification route uses:

```text
Qwen/Qwen3-4B-Instruct-2507:fastest
license: Apache-2.0
routing: Hugging Face provider-managed
```

Environment variables:

```text
HF_TOKEN=
HF_BUDGET_MODEL=Qwen/Qwen3-4B-Instruct-2507:fastest
HF_BUDGET_TIMEOUT_MS=30000
IP_GEOLOCATION_TIMEOUT_MS=4000
```

Provider routing does not prove an immutable served model revision. Hosted quota or provider charges may apply. Without external-AI consent or when inference fails, the complete deterministic plan remains available.

## API

### Create or update a plan and profile

```http
POST /api/ai/budget-plan
Content-Type: application/json
```

```json
{
  "consentBehaviorLearning": true,
  "consentExternalAi": true,
  "consentLocationContext": true,
  "preferences": {
    "savingsStyle": "balanced",
    "emergencyFundMonths": 3,
    "sustainabilityPriority": 60
  }
}
```

The client cannot submit country, region or city text. Those fields are derived server-side only after IP-location consent.

### Read profile

```http
GET /api/ai/budget-profile
```

### Record explicit feedback

```http
POST /api/ai/budget-feedback
Content-Type: application/json
```

### Reset profile

```http
DELETE /api/ai/budget-profile
```

## Production acceptance

Before deployment:

1. Set `TRUST_PROXY=true` behind Caddy and verify the connector receives the visitor IP rather than `127.0.0.1` or a Docker address.
2. Confirm no Geo-IP request occurs while location consent is disabled.
3. Confirm one consented run contacts only `https://ipwho.is/<ip>` and no raw IP appears in PostgreSQL, application responses or Hugging Face payloads.
4. Test IPv4, IPv6, VPN and private/local-address failure paths.
5. Verify malicious provider city or region text is discarded and never reaches the model.
6. Verify the location checkbox is disabled again after a run and after a page reload.
7. Generate a deterministic plan with `HF_TOKEN` unset.
8. Generate a hosted emphasis classification with the production Hugging Face token.
9. Confirm free-form or number-bearing model output falls back to deterministic text.
10. Test low-history, zero-income, negative-cashflow and no-goal states.
11. Reset the profile and confirm its PostgreSQL row is deleted.
