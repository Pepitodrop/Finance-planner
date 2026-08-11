---
type: page
domain: finance
status: implemented
---

# Transactions (page)

`desktopOrder: 2`, mobile primary. List, create, edit, delete transactions.

- **Component:** `src/features/transactions/TransactionsPage.tsx` (`src/TransactionsPage.tsx` re-export/compat), dialogs for [[Transaction Creation]]/[[Transaction Editing]]
- **Model:** `src/features/transactions/transactionsModel.ts`
- **Data model:** [[Transaction (data model)]], normalized via [[Transaction Normalization]] ([[COBOL Domain Core]])
- **Statement import:** `src/statementImport.ts` — bulk import path
- **Related tests:** `src/features/transactions/TransactionsApp.test.tsx`, `src/features/transactions/transactionsModel.test.ts`, `src/statementImport.test.ts`
- **Security:** every transaction must reference an existing account (server + client validated), integer-cents only

Related: [[Dashboard Page]] · [[Accounts Page]] · [[COBOL Domain Core]]
