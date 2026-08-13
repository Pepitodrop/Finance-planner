---
type: security
domain: provider
status: implemented
---

# Provider Institution Selection Contract

Fixed a critical correctness/security gap (branch `fix/connections-provider-ui`, 2026-08-13): the browser sent `institutionId`/`institutionName` to `POST /api/connectors/:provider/start`, but `server.js`'s `start()` dropped them before calling `adapter.start()`, and `GoCardlessProvider.start()` then picked `GOCARDLESS_INSTITUTION_ID || institutions[0]?.id`. A user could select "Volksbank / Raiffeisenbank" in the UI while the server silently created a requisition for an unrelated institution — the UI's institution picker was cosmetic, not authoritative.

## The fix

- `server/src/server.js` `start()` now extracts `institutionId` from the request body and passes it through to `adapter.start()`.
- `GoCardlessProvider` (`server/src/providers.js`) gained `listInstitutions(country)` (10-minute per-country cache) and `institutionDirectory(country)` (sanitized `{id, name, bic, logo}[]`, throws `provider_not_configured` if GoCardless isn't configured).
- `start()`'s resolution order, with no silent fallback at any step:
  1. Client-supplied `institutionId` — validated against the live directory; unmatched → `HttpError(400, 'invalid_institution')`.
  2. Else `GOCARDLESS_INSTITUTION_ID` env override (sandbox/runtime-verification only) — validated the same way; unmatched → `HttpError(503, 'invalid_institution_override')`. Only applies when the client sent no `institutionId`, so it can never silently override an explicit user selection.
  3. Else `HttpError(400, 'institution_required')` — never `institutions[0]`.
- Resolved credential carries `institutionSource: 'user-selected' | 'operator-override'` for observability.
- New authenticated endpoints: `GET /api/connectors` (sanitized `providerRegistry.list()` — availability/configured/mode) and `GET /api/connectors/:provider/institutions?country=` (the sanitized directory). Both authenticate via `userId(request)` before disclosing anything (see [[Provider Callback Binding]] for the sibling pattern on the callback path).

## Frontend consequence: no client-side guessing either

The static picker catalogue (`src/institutions.ts`) has entries like "Sparkasse" and "Volksbank / Raiffeisenbank" that don't map to one unique GoCardless institution. `ConnectionsPage.tsx` no longer treats a picker tile as the final answer for `gocardless`-provider institutions: choosing one opens a live-search sub-step (`InstitutionResolutionStep`, prefilled with the tile's name) backed by the new institutions endpoint, and only an explicit tap on a real directory entry sets `resolvedProviderInstitution`, which is what actually gets sent to `/start`. Every other provider (`paypal`, `finapi`) is unaffected — the tile id is already the real provider id for those.

## Verification

`server/test/gocardless-institution-directory.test.js` (9 cases): validates a user selection against the mocked directory, rejects an unmatched id (asserts no agreement/requisition call happens), rejects the no-institution/no-override case, applies the override only when unselected, rejects a stale override, asserts the override never beats an explicit selection, asserts directory sanitization (no unreviewed upstream fields leak), fails closed when unconfigured, and asserts the directory is cached per country. `src/features/connections/ConnectionsPage.test.tsx` covers the resolution UI path end to end (mocked `fetchProviderInstitutions`).

This is a code-correctness fix, not new runtime verification — see [[GoCardless]] / [[Provider Status]] for why GoCardless as a whole is still provider/credential-dependent and unverified against a live sandbox.

## Follow-up (2026-08-14): closed two gaps an independent review found in the first version

An independent review of the initial PR (#138) found the availability/disclosure contract above still had two gaps:

1. **Availability failed open while loading or on network error.** `ConnectionsPage` initialized `providerStatus` as `[]` and treated a missing/not-yet-loaded descriptor as available, and swallowed `fetchProviderStatus()` failures — so while status was loading, or permanently if `GET /api/connectors` failed, finAPI/unconfigured providers were selectable again, recreating the exact defect this contract exists to prevent. Fixed with an explicit `ProviderStatus` union (`{status:'loading'}|{status:'error'}|{status:'ready', providers}`, `connectionsModel.ts`): `institutionAvailability()` now fails closed for `loading`, `error`, *and* a provider genuinely missing from a successful `ready` response — manual institutions are the sole exception (never gated). The setup dialog shows a calm "Checking availability…" badge while loading and a `role="alert"` banner with an explicit Retry action on error; nothing auto-retries silently.
2. **Owner-mode PayPal availability wasn't user-specific.** `GET /api/connectors` authenticated the request but then returned `providerRegistry.list()` unfiltered — `start()` already enforced `authorizeProviderUser()` (owner-user binding via `PAYPAL_OWNER_USER_ID`), but the listing endpoint didn't, so a non-owner authenticated user saw owner-mode PayPal as available/configured and only discovered it was forbidden after a 403 on click. Fixed with a shared `ownerAccessState()` helper in `server/src/provider-access.js` used by both `authorizeProviderUser()` (throws) and the new `describeProviderForUser()` (returns a sanitized unavailable descriptor with reason, never the owner user id) — `GET /api/connectors` now calls `describeProviderForUser()` per adapter instead of the registry's raw `.list()`, so listing and start share one source of truth and cannot drift.

Verification: `server/test/provider-access.test.js` (owner/non-owner/missing-binding/partner-mode/no-secret-leak/listing-start agreement), an added `open-banking-server-boundary.test.js` case asserting the listing route uses `describeProviderForUser` and never the raw list, and new `ConnectionsPage.test.tsx`/`connectionsModel.test.ts` cases for loading/error/retry/missing-descriptor/manual-stays-usable/finAPI-never-selectable and non-owner-disabled/owner-selectable PayPal gating.

Related: [[GoCardless]] · [[Bank Connections]] · [[Bank Connection Flow]] · [[Connections Page]] · [[Provider Callback Binding]] · [[Provider Status]] · [[PayPal]]
