---
type: security
domain: security
status: implemented
---

# Timing-Safe Password Verification

`POST /api/auth/password/login` performs exactly one scrypt verification per request, **regardless of whether the submitted email matches an existing account** — `crypto.timingSafeEqual` for the final comparison, and a `DUMMY_PASSWORD_HASH` (computed once at module load) used when no real user/hash exists, so the expensive scrypt cost is always paid.

- **Fixed 2026-08-10 (`/cso`):** before the fix, the hash check was skipped entirely for unknown emails — measured ~14ms (unknown) vs ~230ms (known, wrong password), a ~16x gap, single-request distinguishable.
- **Regression test:** `server/test/auth-router.test.js` (generous 0.25 ratio floor to avoid CI flakiness)
- **Re-confirmed fresh 2026-08-11 (`/ship`):** code re-read directly, unchanged.

Related: [[Security Index]] · [[User-Enumeration Mitigation]] · [[Login Flow]] · [[Security Decisions]]
