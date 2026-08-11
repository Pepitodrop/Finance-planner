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
- **Related tests:** `src/features/dashboard/dashboardModel.test.ts`, [[Production Browser Acceptance]]

Related: [[Accounts Page]] · [[Transactions Page]] · [[Frontend]]
