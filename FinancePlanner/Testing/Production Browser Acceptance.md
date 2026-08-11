---
type: test
domain: infrastructure
status: implemented
---

# Production Browser Acceptance

`.github/workflows/production-acceptance.yml` — full Chromium acceptance suite (desktop/mobile/offline/a11y/connections/auth/data-privacy/readiness/resilience/load), `AUTH_MODE=local`. Corresponds to CI check `Chromium production acceptance` (7m43s at PR #131's final HEAD, fresh-confirmed `/ship`).

- **Scripts:** `scripts/auth-security-production-acceptance.mjs`, `scripts/browser-production-acceptance.mjs`, `scripts/connections-production-acceptance.mjs`, `scripts/data-privacy-production-acceptance.mjs`, `scripts/finance-intelligence-production-acceptance.mjs`, `scripts/whole-product-readiness-acceptance.mjs`
- **Real defects only found via this class of test:** see [[Debugging Learnings]] — legacy stylesheet leaks, touch-target sizing, `:where()` cascade losses, fixture wiring gaps

Related: [[Testing and CI Index]] · [[Debugging Learnings]] · [[Passkey Enrolment Banner]]
