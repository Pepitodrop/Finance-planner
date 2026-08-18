---
type: page
domain: data
status: provider-dependent
---

# Connections (page)

Secondary nav, "Connections" group. Bank (GoCardless) and PayPal connection management — institution selection, consent redirect, sync status, disconnect. Not separately routed per sub-step; represented as UI states within this one page.

- **Component:** `src/features/connections/ConnectionsPage.tsx`, `src/ConnectionsPanel.tsx`
- **Model:** `src/features/connections/connectionsModel.ts`
- **Backend:** [[providers.js]] `OpenBankingProviderRegistry`
- **Providers:** [[GoCardless]], [[PayPal]]
- **Flows:** [[Bank Connection Flow]], [[Bank Consent Flow]], [[Bank Sync Flow]], [[Bank Disconnect Flow]], [[PayPal Redirect Flow]]
- **COBOL boundary:** [[Banking Core Module]]
- **Institution lookup:** `src/institutions.ts` (static picker catalogue/icons/categories) + `src/connectors.ts` `fetchProviderInstitutions`/`fetchProviderStatus` (live, server-validated directory + availability — see [[Provider Institution Selection Contract]])
- **Institution visual identity:** `src/institution-logos.ts` — reviewed Simple Icons CDN marks for PayPal/N26/Commerzbank/Deutsche Bank/Sparkasse, an original Finance Planner lettermark (never a bank's real brand color) for every other institution, with graceful `onError` fallback
- **Related tests:** `src/features/connections/connectionsModel.test.ts`, `src/features/connections/ConnectionsPage.test.tsx`, `src/institution-logos.test.ts`, `src/bankConnection.test.ts`, `src/app/navigation.test.ts` (return-detection tab routing)
- **UI structure (reworked 2026-08-13):** setup dialog is a single scroll region (fixed header/progress, `.connections-setup-content` scrolls) instead of nested scrollbars; the institution list is one bordered surface with row separators instead of individually outlined rows; category pills scroll full-bleed so the first/last is never clipped; the search box uses one `:focus-within` treatment on the wrapper, deliberately compounded with `.modal` in the selector so a same-specificity rule from another stylesheet loaded later can't reintroduce a second nested border (see [[Provider Institution Selection Contract]] sibling note in `connections.css` comments). Provider-start errors render with `role="alert"` inside the active step (setup modal / attention screen) instead of behind the modal, and clear on institution change, back, or close.
- **Provider availability (added 2026-08-14, verified still correct 2026-08-18):** `providerStatus` is an explicit `loading|error|ready` union — a "Checking availability…" badge appears per-institution while loading, a dismissible `role="alert"` banner with a Retry action appears on failure; external providers fail closed in both states (manual accounts unaffected). Retry (2026-08-18) uses a request-generation counter so a stale response can never overwrite a newer one, even though the Retry button itself can't practically be double-clicked (it only renders during `status === 'error'`, so a click immediately unmounts it).
- **Callback/return handling (fixed 2026-08-18):** landing back from a real provider return (or a failed callback) now correctly boots into this page — see [[Provider Callback Binding]] for the routing fix and `src/app/navigation.test.ts`'s `initialTabFromSearch` coverage. Previously this likely never happened automatically for GoCardless or PayPal-partner, and possibly not for PayPal-owner either.
- **Correction:** this note previously listed `src/bankCallbacks.test.ts` as related coverage. Verified 2026-08-18 that `bankCallbacks.ts` (and the sibling `bankRuntime.ts`/`bankWebhook.ts`/`bankWebhookHttp.ts`/`gocardlessBankProvider.ts` cluster) has no consumer anywhere outside its own test file — it does not exercise this page's actual code path. See [[Known Issues and Limitations]].
- **Verification state:** implemented / **not runtime or production verified** — see [[Provider Status]]

Related: [[Bank Connections]] · [[PayPal]] · [[Accounts Page]] · [[Provider Institution Selection Contract]] · [[Provider Callback Binding]] · [[Known Issues and Limitations]]
