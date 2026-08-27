---
type: system
domain: provider
status: partial
aliases: [Providers Index]
---

# Providers Index

Hub for every external/device provider. Conservative verification terminology throughout, matching [[Provider Status]] exactly — never "implemented" upgraded to "verified," never "CI gate executed" upgraded to "live provider flow succeeded."

| Provider | Node | Implementation | Runtime verified | Provider/device verified | Production verified |
|---|---|---|---|---|---|
| Google OAuth | [[Google OAuth]] | Yes | No | No | No |
| Enable Banking / Bank AIS (preferred) | [[Enable Banking]] | Yes | Partial, updated 2026-08-25 (fourth pass, Mock ASPSP): directory/discovery/logos/`POST /auth`/bank-auth page/**authorization/consent/callback/persistence** all live-verified for the first time — no real bank credentials needed via Mock ASPSP. Account/balance/transaction sync, second-sync dedup, and disconnect remain unverified: the first sync hit a real provider HTTP 422 (root-caused, code-fixed, test-verified only — see [[Enable Banking]]'s fourth-pass entry). The no-reunlock popup return ([[Provider Authorization Popup Bridge]]) is likewise code-fixed/test-verified only, not yet re-verified live. | No | Partial (same split — a persisted connection now exists in production for the first time in this codebase's history, but no sync/disconnect cycle has completed there yet) |
| GoCardless / Bank PSD2 (fallback) | [[GoCardless]] | Yes | No | No | No |
| PayPal | [[PayPal]] | Yes | No | No | No |
| Google subscriptions | [[Google Subscriptions]] | Yes | No | No | No |
| Hugging Face (hosted AI) | [[Hosted Hugging Face Inference]] | Yes | Gate-execution only | No | No |
| WebAuthn / Passkeys | [[WebAuthn Passkeys]] | Yes | Unit-level only | No | No |

Related: [[Provider Status]] · [[Bank Connections]] · [[AI Index]] · [[00 Project Index]]
