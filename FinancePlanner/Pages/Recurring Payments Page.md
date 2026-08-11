---
type: page
domain: finance
status: implemented
---

# Recurring Payments (page)

Secondary nav, "Planning" group. Detected and manually-declared recurring transactions.

- **Component:** `src/features/recurring/RecurringPaymentsPage.tsx`
- **Model:** `src/features/recurring/recurringModel.ts`
- **Detection logic:** `src/recurringDetection.ts`
- **Boundary:** deliberately no unsupported cancellation control — English-only boundary confirmed by test
- **Related tests:** `src/features/recurring/RecurringPaymentsPage.test.tsx`, `src/features/recurring/recurringModel.test.ts`, `src/recurringDetection.test.ts`

Related: [[Dashboard Page]] · [[Subscriptions Page]]
