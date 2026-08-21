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

## Follow-up (2026-08-18): a real GoCardless/bank-flow trace during this same continuation session found the disconnect path had an analogous honesty gap -- fixed alongside this contract's spirit ("never claim more than the provider confirmed") rather than as part of institution selection itself; see [[Bank Disconnect Flow]] for the full fix (`OpenBankingProvider.disconnect()`, `GoCardlessProvider`/`PayPalProvider` overrides, and the server/frontend wiring that derives `providerRevoked` from the adapter instead of assuming it).

## Follow-up (2026-08-20): bank identity decoupled from provider, and Enable Banking joins the same anti-guessing contract

Adding [[Enable Banking]] as the preferred AIS provider meant the static picker catalogue (`src/institutions.ts`) could no longer hard-code `provider: 'gocardless'` on every bank — that would make GoCardless the only aggregator anything could ever resolve against, defeating the point of adding a preferred alternative. Fixed: `InstitutionProvider` uses a logical `'ais'` tag for every bank-kind entry (ING is not GoCardless; ING is a bank two different aggregators might separately be able to reach); `src/features/connections/connectionsModel.ts`'s `resolveAisProvider()` picks the concrete provider at runtime, in a fixed preference order (`AIS_PROVIDER_PREFERENCE = ['enablebanking', 'gocardless']`), and fails closed to unavailable exactly like every other provider already did — see [[Bank Connections]] for the full mechanism.

`EnableBankingProvider.institutionDirectory()`/`start()` join the same no-`[0]`-fallback, live-directory-validated contract this note documents for GoCardless — the one structural difference is that Enable Banking identifies an ASPSP by the compound `{name, country}` pair rather than a single opaque id, so `EnableBankingProvider` mints its own opaque `${country}:${name}` id for the `institutionId` contract, decoded and re-validated against the live `/aspsps` response in `start()` the same way GoCardless's institution id is. Sanitization is equally strict: only `{id, name, country, bic?, logo?}` reaches the browser, never `auth_methods`/`psu_types`/`beta`/other upstream ASPSP metadata.

Verification: `server/test/enable-banking-directory.test.js`, `server/test/enable-banking-callback.test.js` (institution validation/no-fallback/sanitization/caching, mirroring `gocardless-institution-directory.test.js`'s structure), `src/institutions.test.ts` (catalogue no longer names `gocardless`), `src/features/connections/connectionsModel.test.ts` (`resolveAisProvider` preferred/fallback/neither).

## Follow-up (2026-08-18): a real GoCardless/bank-flow trace during this same continuation session found the disconnect path had an analogous honesty gap -- fixed alongside this contract's spirit ("never claim more than the provider confirmed") rather than as part of institution selection itself; see [[Bank Disconnect Flow]] for the full fix (`OpenBankingProvider.disconnect()`, `GoCardlessProvider`/`PayPalProvider` overrides, and the server/frontend wiring that derives `providerRevoked` from the adapter instead of assuming it).

## Follow-up (2026-08-21): bank-family UX fix, contract unaffected

A real, reported UX defect — the "Volksbank / Raiffeisenbank" and "Sparkasse" picker tiles prefilled the live branch-search box with that literal umbrella label, which never matches a real ASPSP name — was fixed on `feat/bank-discovery-ux`. This contract's guarantee was never at risk: the prefilled/typed search text only ever affects which live directory rows are *displayed*; the `institutionId` actually submitted to `start()` still always comes from an explicit tap on a real, server-fetched directory entry (`resolvedProviderInstitution`), never from search text or a picker-tile label. Independently re-verified during that work's own adversarial review pass. See [[Bank Family Directory Resolution]] for the full mechanism.

Related: [[Enable Banking]] · [[GoCardless]] · [[Bank Connections]] · [[Bank Connection Flow]] · [[Bank Disconnect Flow]] · [[Connections Page]] · [[Provider Callback Binding]] · [[Provider Status]] · [[PayPal]] · [[Bank Family Directory Resolution]]
