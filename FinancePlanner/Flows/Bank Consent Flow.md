---
type: flow
domain: provider
status: provider-dependent
---

# Bank Consent Flow

Sub-flow of [[Bank Connection Flow]]. GoCardless end-user agreement/consent is created server-side, its expiry tracked (`gocardlessConsentExpiresAt()`), and consent status is validated through [[Banking Core Module]] (`core.validateProviderConsent`) before the connection is trusted. Bank credentials are never seen by Finance Planner — they're entered on GoCardless's own site.

Related: [[Bank Connection Flow]] · [[GoCardless]] · [[COBOL Domain Core]]
