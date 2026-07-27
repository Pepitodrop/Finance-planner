# AI production readiness

Finance Planner uses compact Hugging Face models locally where possible. AI output is advisory. Exact balances, totals, projections, and transaction mutations must remain deterministic and must never depend solely on generative output.

## Approved model registry

The canonical registry is `src/aiModels.ts`. Every model entry must declare:

- an immutable model identifier or reviewed revision;
- task and runtime location;
- load policy and numeric precision;
- SPDX-compatible license;
- purpose and deterministic fallback;
- privacy classification and whether network access is required.

Model additions require model-card and license review. Runtime dependencies must be pinned and updated through a reviewed pull request.

## Required evaluation gates

A release may not describe AI or smartness as 85% production-ready until representative German and English finance datasets demonstrate all of the following:

- transaction-category macro F1 of at least 0.85 on the frozen test set;
- merchant-normalization precision of at least 0.90;
- abstention on low-confidence or out-of-domain inputs;
- no incorrect modification of balances or transactions;
- deterministic monetary answers matching the calculation engine in 100% of release-gate cases;
- documented p50/p95 latency and peak memory on the supported browser/device matrix;
- prompt-injection, data-exfiltration, unsafe-financial-advice, and hallucination tests;
- user-visible confidence and explanation for inferred categories;
- local-data and telemetry behavior verified against the privacy policy.

## Hugging Face integration policy

1. Prefer browser-local inference through Transformers.js for private financial data.
2. Pin the Transformers.js version and review model revisions before release.
3. Do not silently fall back to hosted inference.
4. Cache only model artifacts and non-sensitive derived metadata.
5. Validate model artifact integrity where the hosting/runtime permits it.
6. Provide a deterministic non-AI path when model loading, WebGPU, network access, or memory is unavailable.
7. Record model name, revision, runtime, latency, confidence, and fallback reason in privacy-safe diagnostics.

## Release evidence

Attach evaluation reports, device results, model-card/license review, dependency audit, and the exact commit/model revisions to issue #28 before increasing the AI or Smartness readiness score beyond 84%.