---
type: flow
domain: provider
status: provider-dependent
---

# PayPal Redirect Flow

**Owner mode** (default without a partner merchant ID configured): no user redirect at all — server-side client-credential exchange directly against the configured PayPal Business account, gated by `PAYPAL_OWNER_USER_ID` so only that one Finance Planner user can ever connect it.

**Partner mode** (`PAYPAL_PARTNER_MERCHANT_ID` set): provider-hosted onboarding redirect + webhook verification, structurally similar to [[Bank Connection Flow]].

- **Verification state:** implemented (both modes, real API integration) / **not runtime or production verified**

Related: [[PayPal]] · [[Connections Page]] · [[Provider Status]]
