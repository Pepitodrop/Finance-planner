---
type: flow
domain: auth
status: implemented
---

# Login Flow

[[Authentication Loading]] (`GET /api/auth/session`) → if unauthenticated → [[Login and Registration]] → user submits Google or email/password → session cookie issued ([[Session Cookie]]) → [[Vault Unlock]] or [[Vault Setup]] depending on whether an existing vault is found.

- **Pages:** [[Authentication Loading]], [[Login and Registration]], [[Vault Unlock]]/[[Vault Setup]]
- **APIs:** `GET /api/auth/session`, `POST /api/auth/password/login`, `POST /api/auth/google/start`+`callback`
- **Security:** [[Timing-Safe Password Verification]] runs unconditionally on every password-login attempt, matched or not
- **Storage:** session in [[auth_store (table)]]; finance state pulled from [[user_finance_state (table)]] once authenticated

Related: [[Authentication]] · [[Registration Flow]] · [[Google OAuth Flow]]
