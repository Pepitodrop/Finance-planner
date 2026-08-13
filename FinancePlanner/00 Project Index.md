# Finance Planner

## Purpose

A privacy-focused personal finance application: accounts, balances, income/expenses, savings goals and recurring payments, with deterministic (integer-cents) financial calculations, an installable PWA, a native Android TWA package, authenticated cross-device sync, local browser AI, optional governed hosted AI, and bank/PayPal connector integrations. Status per README: "production-oriented personal MVP" — permanent Android signing, Play publication, independent security certification and live-bank-provider certification are explicitly still outstanding.

## Graph navigation

Start with [[Knowledge Graph]] when you want to understand how architecture, features, decisions, provider evidence, risks, testing, and production concerns connect to each other. Use this index as the directory-style overview; use the graph map and peer links for relationship-centric navigation.

## Current architecture

React/TypeScript + Vite frontend, Node.js connector backend, PostgreSQL as the canonical cross-device store, GnuCOBOL for deterministic finance/banking-domain logic. See [[System Architecture]] for the full picture, [[Frontend]] and [[Backend]] for each side, [[Data and Persistence]] for the sync/storage model, and [[COBOL Domain Core]] for the deterministic-finance boundary.

## Core technologies

React 18, TypeScript, Vite, Vitest, PostgreSQL 17, GnuCOBOL, Transformers.js/ONNX Runtime (local AI), Hugging Face hosted inference (optional), `@simplewebauthn` (passkeys), `google-auth-library` (Google OAuth), Docker Compose + Nginx, Android TWA (Gradle/Kotlin project in `android/`).

## Major subsystems

- [[Frontend]] — React app structure, layering rules
- [[Backend]] — Node connector, routers, stores
- [[Data and Persistence]] — local vault + PostgreSQL sync model, conflict semantics
- [[COBOL Domain Core]] — deterministic finance/banking logic and the Node↔COBOL boundary
- [[Authentication]] — Google OAuth, WebAuthn passkeys, sessions, test accounts
- [[AI System]] — local vs hosted AI, consent, evaluation gates
- [[Bank Connections]] — GoCardless/PSD2 read-only account-information integration
- [[PayPal]] — owner/partner reporting integration
- [[Sync and Offline]] — cross-device sync lifecycle, offline behavior
- [[Mobile PWA Android]] — PWA shell, Android TWA, signing status

## Current provider status

See [[Provider Status]] for a strict per-integration breakdown of implemented vs configured vs runtime-verified vs production-verified. Short version: GoCardless, PayPal and hosted Hugging Face inference are real, credential-dependent integrations that are **implemented but not runtime/production verified** — full end-to-end flows are documented as requiring manual, human-recorded verification (`docs/issue-105-live-verification.md`), not something CI proves. Google OAuth and physical-device passkeys are similarly implemented but not proven live in CI (the production-acceptance browser suite runs under `AUTH_MODE=local`).

## Current limitations

See [[Known Issues and Limitations]]. Notable: no independent penetration test or privacy review yet; no physical-device or Play Store evidence for Android; live GoCardless/PayPal certification outstanding; single-instance-only safe coordination for the encrypted auth store; representative Playwright/load/device test matrices still pending.

## Important decisions

See [[Architecture Decisions]] and [[Security Decisions]] for the reasoning behind integer-cents money, the deterministic-COBOL/probabilistic-AI split, PostgreSQL as canonical store, server-side-only provider credentials, and fail-closed COBOL enforcement. See [[Rejected Approaches]] for deferred/explicitly-not-done options and why.

## Engineering

[[Commands and Tests]] for canonical typecheck/lint/test/build commands. [[Known Issues and Limitations]] for current gaps. [[Debugging Learnings]] for durable investigation techniques worth reusing (real defects found via browser acceptance testing, CSS/measurement debugging, focus-management bugs).

## Detailed subgraphs (micro-level)

Ten additional hub notes index a much finer-grained decomposition added 2026-08-11 — pages, flows, AI models, technologies, COBOL responsibilities, database tables, providers, security controls, tests/CI, and implementation files:

[[Pages Index]] · [[Flows Index]] · [[AI Index]] · [[Technology Index]] · [[COBOL Index]] · [[Data Index]] · [[Providers Index]] · [[Security Index]] · [[Testing and CI Index]] · [[Implementation Index]]

Each atomic note in these subgraphs links back up to the relevant subsystem/feature note above, so a reader can traverse either top-down (subsystem → detail) or bottom-up (a specific file/table/test → its owning feature → the architecture).

## Memory usage

See [[Memory System]] for what belongs in this vault, the graph-first maintenance rules, and the source-of-truth precedence future sessions must follow. See [[Knowledge Graph]] for the cross-domain relationship map.
