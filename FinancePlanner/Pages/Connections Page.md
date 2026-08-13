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
- **Related tests:** `src/features/connections/connectionsModel.test.ts`, `src/features/connections/ConnectionsPage.test.tsx`, `src/institution-logos.test.ts`, `src/bankConnection.test.ts`, `src/bankCallbacks.test.ts`
- **UI structure (reworked 2026-08-13):** setup dialog is a single scroll region (fixed header/progress, `.connections-setup-content` scrolls) instead of nested scrollbars; the institution list is one bordered surface with row separators instead of individually outlined rows; category pills scroll full-bleed so the first/last is never clipped; the search box uses one `:focus-within` treatment on the wrapper, deliberately compounded with `.modal` in the selector so a same-specificity rule from another stylesheet loaded later can't reintroduce a second nested border (see [[Provider Institution Selection Contract]] sibling note in `connections.css` comments). Provider-start errors render with `role="alert"` inside the active step (setup modal / attention screen) instead of behind the modal, and clear on institution change, back, or close.
- **Verification state:** implemented / **not runtime or production verified** — see [[Provider Status]]

Related: [[Bank Connections]] · [[PayPal]] · [[Accounts Page]] · [[Provider Institution Selection Contract]]
