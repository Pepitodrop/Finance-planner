---
type: flow
domain: auth
status: implemented
---

# Registration Flow

[[Login and Registration]] → email/password/name submitted → `POST /api/auth/password/register` → [[password-auth.js]] validates (12–200 char password) → [[auth-router.js]] checks `store.findByEmail` for a same-email Google account (merge, not duplicate, if found) → new `email:<uuid>` user created in [[auth_store (table)]] → session issued → [[Vault Setup]].

- **Pages:** [[Login and Registration]] → [[Vault Setup]]
- **API:** `POST /api/auth/password/register`
- **Security:** [[Password Hashing]] (scrypt, salted), same-account resolution against a pre-existing Google identity
- **Known gap:** the reverse direction (add a password to an existing Google account) is explicitly blocked, not silently merged — [[Known Issues and Limitations]]

Related: [[Authentication]] · [[Login Flow]] · [[Password Hashing]]
