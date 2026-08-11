---
type: page
domain: finance
status: implemented
---

# Goals / Savings Goals (page)

`desktopOrder: 4`, mobile primary. Savings-goal tracking with deterministic progress projection.

- **Component:** `src/features/goals/GoalsPage.tsx` (`src/SavingsGoals.tsx` compat)
- **Model:** `src/features/goals/goalsModel.ts`
- **Projection logic:** `finance_projection.cob` via [[COBOL Domain Core]] — end-balance projection from starting balance + monthly income/expenses, never JS floating point
- **Editor:** portals outside the inert background, restores body state on close (accessibility-tested)
- **Related tests:** `src/features/goals/GoalsPage.test.tsx`, `src/features/goals/goalsModel.test.ts`

Related: [[Dashboard Page]] · [[COBOL Domain Core]]
