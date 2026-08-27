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
- **Remove account (added 2026-08-27, PR #154, revised same day after independent review):** each account row exposes a discreet "⋯" action (`DashboardAccountActions`) opening a shared [[ConfirmationDialog]] naming the account and the exact transaction count that will also be removed — never a single unconfirmed click. Domain logic is a pure `removeAccountFromState()`/`restoreAccountToState()` pair in `src/accountState.ts` (atomic account+transaction removal, no orphan transaction can result).
  - **Manual accounts:** synchronous, local-only removal with a short-lived Undo toast (`src/App.tsx`, matching the existing deleted-transaction undo pattern).
  - **Provider-linked accounts:** removal is a single **coordinated** operation, not fire-and-forget (an earlier version of this feature removed the account locally before confirming the server-side exclusion succeeded, which an independent review correctly flagged as able to silently lie to the user on a network failure). The durable exclusion (see [[Stable Account Identity and Reconnect Reconciliation]]) must succeed FIRST; only then is the account removed from local state. The dialog shows a "Removing account…" busy state (duplicate submission disabled) and, on failure, an actionable inline error with retry — the account is never removed and no false success is ever shown. A provider account with **no stable identity** (`stableId` absent) is refused a destructive "Remove account" entirely — Finance Planner cannot guarantee such an account would stay removed, so the dialog instead explains this and offers a link to Connections to disconnect the whole bank connection instead. Provider accounts never get an Undo toast (the server-side exclusion has already been recorded by the time Undo could be pressed).
- **Restore a removed provider account:** see [[Connections Page]]'s "Manage connection" screen — removal is never an irreversible hidden tombstone.
- **Related tests:** `src/features/dashboard/dashboardModel.test.ts`, [[Production Browser Acceptance]]

Related: [[Accounts Page]] · [[Transactions Page]] · [[Frontend]] · [[Stable Account Identity and Reconnect Reconciliation]] · [[Bank Disconnect Flow]]
