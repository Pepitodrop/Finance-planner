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
  - **Provider-linked accounts WITH a stable identity (`stableId` present) — modern removal, durable exclusion:** removal is a single **coordinated** operation, not fire-and-forget (an earlier version of this feature removed the account locally before confirming the server-side exclusion succeeded, which an independent review correctly flagged as able to silently lie to the user on a network failure). The durable exclusion (see [[Stable Account Identity and Reconnect Reconciliation]]) must succeed FIRST; only then is the account removed from local state. The dialog shows a "Removing account…" busy state (duplicate submission disabled) and, on failure, an actionable inline error with retry — the account is never removed and no false success is ever shown. Provider accounts never get an Undo toast (the server-side exclusion has already been recorded by the time Undo could be pressed). Confirmation copy truthfully promises "will not be automatically re-imported" — this promise is only ever made on this path.
  - **Provider-linked accounts WITHOUT a stable identity (`stableId` absent) — LEGACY LOCAL REMOVAL, revised 2026-08-27, fourth independent review, BLOCKER 2:** an earlier version of this feature refused ANY destructive action for this class of account (e.g. one imported before `stableId` existed, or the exact duplicate an earlier PR #154 reconnect bug created), leaving it permanently undeletable even though the user explicitly needs to remove accounts from the Dashboard. Now offers an explicit "Remove local copy" action instead — calls `App.tsx`'s `onRemoveLegacyAccountLocally`, which reuses the SAME `removeAccountFromState()` domain helper as the modern path (atomic account+transaction removal) but writes **no** `connector_account_exclusions` row and makes **no** durability promise. The confirmation dialog explicitly says the account "does not contain a stable bank identifier" and that Finance Planner "cannot guarantee the bank will not return it again during a future sync" — **never** phrased as durable exclusion, and never sharing wording with the modern path's promise. Still offers "Go to Connections to disconnect the bank instead" as an alternative. **Do not upgrade this to a durable exclusion without a real stable identity to key one by** — see [[Stable Account Identity and Reconnect Reconciliation]] for why fabricating one (or fuzzy-matching) is explicitly rejected.
- **Restore a removed provider account:** see [[Connections Page]]'s "Manage connection" screen — removal is never an irreversible hidden tombstone. Restore only ever applies to the modern, durable-exclusion path; a legacy local removal has no exclusion row to restore from (the account can simply reappear on the account's own next matching sync, per the legacy dialog's own wording above).
- **Related tests:** `src/features/dashboard/dashboardModel.test.ts`, [[Production Browser Acceptance]]

Related: [[Accounts Page]] · [[Transactions Page]] · [[Frontend]] · [[Stable Account Identity and Reconnect Reconciliation]] · [[Bank Disconnect Flow]]
