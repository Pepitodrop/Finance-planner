# Non-desktop production readiness

This initiative raises repository-controlled readiness for the Mobile App, Web App, AI, Smartness, Bank connection, Frontend and Backend to at least 90%. Linux, Windows and macOS desktop packages are deliberately outside this scope.

## Measurement boundary

`config/non-desktop-readiness.json` defines weighted, machine-verifiable gates. `npm run verify:readiness` fails when any in-scope category has less than 90% repository-controlled evidence.

This score does not fabricate external acceptance. Physical-device tests, Android signing and store publication, live bank certification, production-token model evidence, independent accessibility validation, penetration testing and production restore drills remain separate dependencies. A category can therefore reach the repository-controlled target while still requiring external release acceptance.

## Added hardening

- a PostgreSQL-backed session revocation registry;
- complete account and user-data deletion with explicit confirmation;
- privacy-safe Prometheus metrics with bounded labels;
- automated retention for OAuth nonces, webhook events, rate-limit rows and session revocations;
- GoCardless consent-expiry enforcement and normalized reconciliation checks;
- scheduled Hugging Face, GoCardless and PayPal runtime canaries;
- a Chromium production-bundle acceptance workflow covering desktop, mobile, offline, PWA, accessibility and transaction CRUD;
- a versioned persistent-budget-learning benchmark covering allocation conservation, deficit safety, goal integrity, liquidity, privacy and feedback adaptation;
- stronger keyboard navigation, focus visibility, modal semantics and mobile touch targets.

## Release interpretation

The normal CI suite proves deterministic code and configuration invariants. The production browser workflow provides runtime evidence for the bundled application and PostgreSQL connector. The runtime-canary workflow proves provider availability only when the required secrets are configured. The controlled release workflow remains blocked by the stricter evidence manifest until external gates have accountable sign-off.

No repository change alone can honestly certify a physical phone, a live banking contract, an app-store identity, a production host or an independent security review.
