# Backend

Node.js connector under `server/`, run as its own container in Compose, reachable only via Nginx (loopback-bound port).

```
server/
├── migrations/            ordered PostgreSQL migrations (+ migrations/down/ for rollback)
├── src/
│   ├── server.js           entrypoint, route wiring, health endpoints
│   ├── auth-router.js       Google OAuth + WebAuthn passkey + test-account routes
│   ├── auth-store.js        encrypted auth profile/passkey persistence
│   ├── finance-router.js    finance state API, optimistic-concurrency writes
│   ├── user-state-store.js  encrypted, versioned finance-vault persistence
│   ├── providers.js         OpenBankingProvider registry: GoCardless, PayPal, finapi (placeholder)
│   ├── cobol-engine.js / cobol-banking-core.js   subprocess bridge to compiled COBOL binaries
│   ├── ai-router.js / ai-ensemble.js / huggingFaceClient.js   hosted-AI consent gate + client
│   ├── session-revocation.js   Postgres-backed session revocation registry
│   ├── distributed-rate-limiter.js   Postgres sliding-window rate limiting
│   ├── crypto-store.js      AES-256-GCM envelope helpers for provider credentials
│   ├── database.js          pool lifecycle, forward migrations
│   ├── migrate-rollback.js  CLI: reversible schema rollback to a target version
│   └── webhook-security.js  webhook signature/idempotency handling
└── test/ + src/*.test.js    Node test-runner coverage (one test file per module, broadly)
```

## Health endpoints

- `/health/ready` — core application readiness only; automatic bank monitoring is never a dependency of this, even with incomplete provider config (`docs/OPEN_BANKING_ARCHITECTURE.md`).
- `/health/bank` — reports automatic account-information capability separately; returns unavailable until at least one provider is correctly configured.
- `/healthz` — fast Nginx-level liveness check, not proxied to the connector.

## Readiness gate pattern worth knowing

Several `config/*.json` gate files (e.g. `config/production-readiness-evidence.json`, `config/non-desktop-readiness.json`) track named readiness checks with states like `pending` / `partial` / `verified`, each requiring cited evidence. `verified` specifically requires a named, accountable human `approvedBy`/`reviewedAt` — a passing test alone does not upgrade a gate to `verified` (see the `distributedRateLimiting` correction in git history, 2026-08-03). This distinction matters when reading any "readiness" claim in this repo.

## Detailed subgraph

Every listed module above has its own file-level node under [[Implementation Index]], linking upward to the feature it implements and downward to the specific logic it owns.

Related: [[System Architecture]] · [[Authentication]] · [[Bank Connections]] · [[PayPal]] · [[AI System]] · [[Data and Persistence]] · [[Implementation Index]]
