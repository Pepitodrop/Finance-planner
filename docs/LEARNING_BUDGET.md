# Persistent learning budget planner

The learning budget planner creates a monthly budget recommendation from the authenticated user's synchronized Finance Planner state.

## Data used

The deterministic planner may use:

- transaction dates, amounts, categories, income/expense type and recurring status;
- account balances, without account names;
- savings goals, remaining amounts and target dates;
- explicitly selected savings style, emergency-fund target and sustainability priority;
- optional coarse country, region, city and self-selected cost level;
- explicit approvals and rejections of prior recommendations.

Transaction descriptions, account names, bank credentials, IBANs and precise GPS coordinates are not persisted in the learning profile and are not sent to the budget model.

Only checking, savings and cash balances count toward the liquid emergency-fund calculation. Investment balances remain part of total wealth but are not treated as immediately available emergency cash.

## Persistence

Migration `007_budget_learning_profiles.sql` creates `user_budget_learning_profiles`. Each profile is:

- bound to the authenticated user ID as AES-GCM additional authenticated data;
- encrypted with `CONNECTOR_MASTER_KEY` before storage;
- versioned and updated transactionally in PostgreSQL;
- deletable through `DELETE /api/ai/budget-profile`.

The profile stores derived category weights, monthly behavior aggregates, preferences and feedback counts. It does not train or store separate neural-network weights per user.

Feedback is accepted only for a known recommendation from the most recently issued plan. Repeating the same decision for the same plan is idempotent; switching the decision replaces that plan's previous vote rather than double-counting it.

## Planning boundary

Budget amounts are calculated by `server/src/budget-learning.js`. The optional Hugging Face model can explain the already calculated recommendations, but cannot change:

- income or expense totals;
- essential/flexible allocation;
- emergency-fund contribution;
- savings-goal allocation;
- category caps.

The interface displays the monthly allocation, liquid emergency-fund gap, savings-goal contributions and category-level spending caps. The planner never creates transactions, changes balances, cancels contracts or moves money.

## Hugging Face

The optional explanation route uses:

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
```

Provider routing does not prove an immutable served model revision. Hosted quota or provider charges may apply. Without external-AI consent or when inference fails, the deterministic plan remains available. External-AI consent is consumed after each plan request and must be checked again for another hosted run.

## API

### Create/update plan and profile

```http
POST /api/ai/budget-plan
Content-Type: application/json
```

```json
{
  "consentBehaviorLearning": true,
  "consentExternalAi": true,
  "consentLocationContext": true,
  "location": {
    "country": "DE",
    "region": "Baden-Württemberg",
    "city": "Karlsruhe",
    "costLevel": "medium"
  },
  "preferences": {
    "savingsStyle": "balanced",
    "emergencyFundMonths": 3,
    "sustainabilityPriority": 60
  }
}
```

### Read profile

```http
GET /api/ai/budget-profile
```

### Record explicit feedback

```http
POST /api/ai/budget-feedback
Content-Type: application/json
```

```json
{
  "consentBehaviorLearning": true,
  "planId": "budget-2026-08-01-20-3",
  "recommendationId": "goal-allocation",
  "decision": "approved"
}
```

### Reset profile

```http
DELETE /api/ai/budget-profile
```

## Production acceptance

Before deployment:

1. Apply migration 007 and verify the encrypted payload cannot be decrypted with a different user binding.
2. Generate a deterministic plan with `HF_TOKEN` unset.
3. Generate a hosted explanation with the production Hugging Face token.
4. Verify logs and request payloads contain no transaction descriptions or account names.
5. Approve and reject recommendations and confirm the profile persists across devices.
6. Confirm stale-plan and unknown-recommendation feedback is rejected.
7. Reset the profile and confirm its PostgreSQL row is deleted.
8. Test low-history, zero-income, negative-cashflow and no-goal states.
9. Confirm investment balances do not satisfy the liquid emergency-fund target.
10. Confirm no recommendation causes an automatic financial mutation.
