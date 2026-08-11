---
type: page
domain: auth
status: implemented
---

# Authentication Loading / Session Check (page)

The transient state while the app resolves whether an existing session cookie is valid, shown before routing to [[Login and Registration]] or [[Vault Unlock]]/[[Dashboard Page]].

- **Component:** [[App.tsx]] (bootstraps through [[bootstrap.tsx]])
- **API called:** `GET /api/auth/session`
- **Backend service:** [[auth-router.js]], [[session-revocation.js]]
- **Data:** session validity depends on [[Session Cookie]] + [[Session Revocation]] state, not client-trusted
- **Flow:** first step of [[Login Flow]] and every authenticated page load

Related: [[Authentication]] · [[Session System]]
