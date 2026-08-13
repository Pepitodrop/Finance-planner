---
type: page
domain: finance
status: implemented
---

# Accounts (page)

`desktopOrder: 3`, mobile primary. Lists accounts (manual + provider-linked), balances, account-type.

- **Component:** `src/features/accounts/AccountsPage.tsx`
- **Model:** `src/features/accounts/accountsModel.ts`
- **Data model:** [[Account (data model)]]
- **Manual credit card support:** `src/manualCreditCard.ts`
- **Provider-linked accounts:** normalized through [[Balance Normalization]] ([[COBOL Domain Core]]) before entering state
- **Related tests:** `src/features/accounts/accountsModel.test.ts`

Related: [[Dashboard Page]] · [[Connections Page]] · [[COBOL Domain Core]]
