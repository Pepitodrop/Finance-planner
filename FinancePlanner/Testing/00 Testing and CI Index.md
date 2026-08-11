---
type: system
domain: infrastructure
status: implemented
aliases: [Testing and CI Index]
---

# Testing and CI Index

Hub connecting feature ↔ implementation ↔ test ↔ CI job ↔ production-verification state — especially important for provider-dependent functionality (see [[Provider Status]]).

## Test domains
[[Authentication Tests]] · [[Password Security Tests]] · [[Session Revocation Tests]] · [[Vault Tests]] · [[Legacy State Cleanup Tests]] · [[Transaction and Data Tests]] · [[COBOL Tests]] · [[Provider Tests]] · [[AI Tests]]

## Browser/production acceptance
[[Production Browser Acceptance]] · [[Data Privacy Acceptance]] · [[Finance Intelligence Acceptance]] · [[Connections Acceptance]] · [[Hosted Inference Acceptance]]

## Infrastructure/operational
[[Container Tests]] · [[Config and Restore Drill]]

## CI jobs (`.github/workflows/`, 9 workflows)
`ci.yml` (`web`, `connector-server`, `containers`, `cobol`, dependency audit, CodeQL JS analysis), `android.yml`, `hosted-ai-acceptance.yml`, `live-deployment-smoke.yml`, `production-acceptance.yml` (Chromium production acceptance), `production-operations.yml` (config-and-restore-drill, live-bank-acceptance), `release-readiness.yml`, `runtime-canaries.yml`, `security-analysis.yml` (Repository secret baseline, Public deployment evidence)

**All 12 required checks confirmed fresh SUCCESS at PR #131's final HEAD (`8ebd10c`) during `/ship`, 2026-08-11; `live-bank-acceptance` correctly reported as skipped/credential-gated, never conflated with a pass.**

Related: [[00 Project Index]] · [[Commands and Tests]] · [[Provider Status]]
