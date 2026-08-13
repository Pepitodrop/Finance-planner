---
type: page
domain: auth
status: implemented
---

# Account (page)

Secondary nav, "Data & account" group (`id: 'account'`). Session/account management: passkey status, logout, account deletion.

- **Component:** `src/AccountPage.tsx`
- **Shows:** `user.passkeyCount` (registered-passkey status line)
- **APIs called:** `POST /api/auth/logout`, account-deletion endpoint
- **Backend service:** [[auth-router.js]] (logout → [[Session Revocation]]), [[account-deletion.js]]
- **Security:** logout revokes server-side, not just the browser cookie ([[Logout]])
- **Related tests:** `src/AccountPage.test.tsx`, [[Session Revocation Tests]]
- **Flow:** [[Account Deletion Flow]]

Related: [[Authentication]] · [[Session System]] · [[Data and Backup Page]]
