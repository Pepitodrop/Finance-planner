# Production readiness gates

This document converts the remaining production-readiness work into evidence-based release gates. A capability is not considered production-ready because code or a configuration placeholder exists; it must have reproducible evidence and an accountable reviewer.

## Machine-enforced gate

`npm test` validates the readiness manifest and all referenced evidence paths. `npm run verify:release` is deliberately strict and fails until every required gate is `verified` or explicitly `not-applicable` with documented justification.

The source of truth is `config/production-readiness-evidence.json`. Never mark a gate verified without adding durable evidence to the repository or a controlled release system.

## Required evidence

### AI workers

For Whisper, Florence, semantic search, and graph inference, provide an isolated worker implementation, pinned dependencies and model revision, request-size limits, timeout and memory limits, health checks, deterministic fallback behavior, privacy tests, representative evaluation results, and deployment rollback instructions.

### Model governance

Every enabled model must have an immutable revision, verified licence, approved intended use, model-card review date, software-bill-of-materials coverage, evaluation owner, and rollback model. `config/ai-model-lock.json` prevents production enablement while placeholder values remain.

### AI evaluation and drift

Provide versioned German and English datasets, accuracy and abstention thresholds, latency and memory budgets, hallucination and leakage tests, baseline metrics, production drift windows, fallback-rate alerts, and an automatic disable policy when thresholds are breached.

### Banking certification

GoCardless and PayPal require sandbox and live-provider evidence for consent, token refresh, pagination, duplicate reconciliation, pending-to-booked transitions, reversals, refunds, webhook replay, idempotency, rate limits, provider outages, disconnect/reconnect, and audit-log correlation. Secrets and real financial records must never be committed.

### Web E2E and accessibility

Provide Playwright coverage for authentication, first-run setup, transaction CRUD, budgeting, goals, connector failure states, offline recovery, upgrade recovery, corrupted-cache recovery, keyboard-only navigation, screen-reader names, focus order, colour contrast, reduced motion, and responsive layouts. Accessibility scans do not replace manual keyboard and assistive-technology testing.

### Physical mobile validation

Android and iOS evidence must include actual device model, OS version, installation path, cold start, background/foreground recovery, offline behavior, safe-area handling, rotation, biometric/session behavior, file and camera permissions where applicable, upgrade from the prior release, corrupted local storage recovery, battery/network constraints, and tester sign-off. Emulators alone are insufficient.

### Signed desktop releases

Linux evidence must include package installation, checksum and repository/package signature verification. Windows requires Authenticode verification and SmartScreen/reputation observations. macOS requires Developer ID signing, hardened runtime, notarization, stapling, Gatekeeper verification, and update validation. Signing keys and certificates remain outside the repository.

### Distributed rate limiting and observability

Before multi-instance deployment, replace process-local sensitive-route rate limits with a shared atomic backend such as Redis or a database implementation with expiry. Provide dashboards and alerts for request rate, latency percentiles, HTTP errors, authentication failures, provider failures, AI latency, schema failures, fallback rate, database pool saturation, queue depth, restart loops, backup age, restoration failures, disk usage, and release version. Include trace/request correlation without logging financial descriptions or credentials.

### Independent security and privacy review

A qualified reviewer who did not implement the assessed feature must examine authentication, authorization, session handling, cryptography, secret management, connector callbacks, dependency and container supply chain, data isolation, AI data flows, logging, backup access, retention, export, deletion, incident response, and threat models. Findings require severity, owner, deadline, remediation evidence, retest status, and formal acceptance of any residual risk.

## External work that cannot be completed by repository changes alone

Physical-device testing, provider certification, code signing/notarization, and independent assessment require devices, provider credentials, certificates, deployment environments, and independent reviewers. Repository automation can make their evidence mandatory, but it cannot honestly manufacture that evidence.
