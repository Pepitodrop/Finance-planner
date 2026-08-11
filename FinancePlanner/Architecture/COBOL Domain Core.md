# COBOL Domain Core

## Why COBOL is here

Exact finance stays deterministic and separate from probabilistic AI (`docs/ARCHITECTURE.md`, `docs/AI_PRODUCTION.md`). GnuCOBOL is the authoritative layer for money math and banking-domain decisions; Node.js is transport/orchestration only. See [[Architecture Decisions]] for the decision record.

## Modules (`core/cobol/`)

- `finance_projection.cob` (`PROGRAM-ID. FINANCE-PROJECTION`) — end balance from starting balance, monthly income/expenses, duration in months.
- `transaction_rules.cob` (`PROGRAM-ID. TRANSACTION-RULES`) — signed-amount → income/expense + absolute cents conversion, balance application, rejects unsupported ops.
- `banking/banking-core.cob` (`PROGRAM-ID. BANKING-CORE`) — the authoritative module for provider-facing normalization: account-type normalization, fixed-point provider amount conversion, consent-state classification, read-only scope enforcement, account/transaction reconciliation and duplicate-count acceptance, credit-card normalization. It also rejects any provider scope string containing money-movement terms — a hard block against payment-initiation capability leaking in.

All arithmetic is integer-cents; no binary floating point crosses the COBOL boundary (provider decimal strings are converted to cents by the Node adapter first).

## Node ↔ COBOL interop

Subprocess execution via `node:child_process.execFile`, not FFI/shared library:

- `server/src/cobol-engine.js` — calls a compiled binary at `COBOL_TRANSACTION_ENGINE` (default `build/transaction-rules`), 5s timeout, parses a pipe-delimited `OK|...` result line.
- `server/src/cobol-banking-core.js` — `CobolBankingCore` class, calls `COBOL_BANKING_BINARY` (default `/app/cobol/banking-core`), 2s timeout, 16KB max buffer, checks binary existence before invoking.

CLI contract example (`core/cobol/README.md`): `build/transaction-rules NORMALIZE -1299` → `OK|expense|1299`; `build/transaction-rules APPLY 100000 1299 expense` → `OK|98701`.

## Build-time vs runtime

- **Build-time only:** GnuCOBOL (`cobc`) compiles the `.cob` sources into native binaries (`cobc -x -o build/transaction-rules transaction_rules.cob`, etc.). `cobc` itself is not needed at runtime.
- **Runtime hard dependency:** the *compiled binary* must exist for the connector to function. Production is fail-closed — `cobol-engine.js` only falls back to a JS implementation when `ALLOW_JS_FINANCE_FALLBACK=true` **and** `NODE_ENV !== 'production'`; otherwise it throws `Authoritative COBOL finance engine unavailable`. `cobol-banking-core.js` throws `cobol_unavailable` when `COBOL_BANKING_REQUIRED=true` (Compose sets this `true` by default for the connector) — provider-facing operations always hard-require the binary regardless of that flag.

## Known local-sandbox gap

Sandboxes without GnuCOBOL installed (no `apt-get`/root) get `ENOENT` on `server/test/cobol-engine.test.js` because `build/transaction-rules` was never compiled. `.github/workflows/ci.yml` installs GnuCOBOL and compiles the binary, so this is believed CI-clean; it's specifically a local/dev-sandbox gap (`TODOS.md`, confirmed pre-existing on `main` via `git stash` bisection on 2026-07-29). See [[Known Issues and Limitations]].

## Detailed subgraph

Every module, responsibility, and boundary above has its own atomic note under [[COBOL Index]] — including [[GnuCOBOL Runtime]], which precisely distinguishes the `cobc` compiler (build-time) from the `libcob` runtime library (a separate runtime dependency), correcting this note's prior `ENOENT` characterization of the local-sandbox gap.

Related: [[System Architecture]] · [[Bank Connections]] · [[Architecture Decisions]] · [[COBOL Index]]
