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
- **Institution lookup:** `src/institutions.ts`
- **Related tests:** `src/features/connections/connectionsModel.test.ts`, `src/bankConnection.test.ts`, `src/bankCallbacks.test.ts`
- **Verification state:** implemented / **not runtime or production verified** — see [[Provider Status]]

Related: [[Bank Connections]] · [[PayPal]] · [[Accounts Page]]
