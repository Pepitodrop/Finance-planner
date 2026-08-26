---
type: page
domain: finance
status: implemented
---

# Dashboard (page)

Default post-login destination (`desktopOrder: 1`, mobile primary). Financial overview: balances, recent transactions, goal progress.

- **Component:** `src/features/dashboard/Dashboard.tsx`
- **Model:** `src/features/dashboard/dashboardModel.ts`
- **Child components:** dashboard-transaction-row items (fixed border/focus treatment, PR #131 — `src/post-release-fixes.css`), [[MerchantLogo.tsx]] fallback icons
- **Data:** reads from the synced [[Data and Persistence|finance state]] via [[cloudState.ts]]/local vault
- **Fresh-account behavior:** genuinely empty state ("Across 0 accounts", "No accounts recorded") — see [[Legacy-Demo-State Cleanup]]
- **Remove account (added 2026-08-27, PR #154):** each account row exposes a discreet "⋯" action (`DashboardAccountActions`) opening a shared [[ConfirmationDialog]] naming the account and the exact transaction count that will also be removed — never a single unconfirmed click. Domain logic is a pure `removeAccountFromState()`/`restoreAccountToState()` pair in `src/accountState.ts` (atomic account+transaction removal, no orphan transaction can result). Manual accounts get a short-lived Undo toast (`src/App.tsx`, matching the existing deleted-transaction undo pattern); provider-linked accounts do not, and additionally trigger a best-effort server-side sync exclusion so the removed account isn't silently re-imported — see [[Stable Account Identity and Reconnect Reconciliation]] for the full suppression mechanism and why removing one account never disconnects the whole provider connection. **Code-fixed, test-verified only (`src/features/dashboard/Dashboard.test.tsx`'s "Remove account" suite) — not yet live-verified.**
- **Related tests:** `src/features/dashboard/dashboardModel.test.ts`, [[Production Browser Acceptance]]

Related: [[Accounts Page]] · [[Transactions Page]] · [[Frontend]] · [[Stable Account Identity and Reconnect Reconciliation]] · [[Bank Disconnect Flow]]
