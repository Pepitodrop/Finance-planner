# AI evaluation and drift gates

Finance Planner evaluates probabilistic AI separately from deterministic financial calculations. Model changes must not be promoted only because they appear subjectively better.

## Release metrics

The backend evaluation helper measures:

- signal precision, with a default minimum of `0.90`;
- signal recall, with a default minimum of `0.85`;
- safe abstention rate, which must remain `1.00` for cases requiring refusal or deterministic fallback;
- mean confidence calibration error, with a default maximum of `0.15`;
- inference p95 latency, with a default maximum of `12000 ms`.

A release fails when any threshold is missed. The checks run as part of the normal backend test suite and can also be run directly:

```bash
cd server
npm run test:ai-evaluation
```

## Drift policy

A reviewed baseline should be stored with each production model revision. The drift detector alerts when any of these default limits are exceeded:

- precision decreases by more than `0.05`;
- recall decreases by more than `0.05`;
- calibration error increases by more than `0.05`;
- p95 latency increases by more than `50%`.

Production monitoring should calculate the same metrics from privacy-safe, labelled evaluation samples. Raw transaction descriptions, account identifiers, credentials, and user prompts must not be added to evaluation telemetry.

## Model governance

The hosted analyst and critic remain locked to reviewed immutable Hugging Face revisions. The current Qwen model cards describe the models as Apache-2.0 open-weight text-generation models. Provider availability, quotas, and runtime performance are operational dependencies and must be verified independently before release.

Changing a model or revision requires:

1. a representative German and English finance evaluation set;
2. passing safety, abstention, precision, recall, calibration, and latency gates;
3. comparison against the current reviewed baseline;
4. explicit review of model licence and model-card changes;
5. a rollback plan to the previous immutable revision or deterministic fallback.
