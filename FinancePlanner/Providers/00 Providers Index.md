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
| Enable Banking / Bank AIS (preferred) | [[Enable Banking]] | Yes | Partial (directory/discovery/logos live-verified; consent blocked on `REDIRECT_URI_NOT_ALLOWED`, fixed not yet re-verified) | No | Partial (same split) |
| GoCardless / Bank PSD2 (fallback) | [[GoCardless]] | Yes | No | No | No |
| PayPal | [[PayPal]] | Yes | No | No | No |
| Google subscriptions | [[Google Subscriptions]] | Yes | No | No | No |
| Hugging Face (hosted AI) | [[Hosted Hugging Face Inference]] | Yes | Gate-execution only | No | No |
| WebAuthn / Passkeys | [[WebAuthn Passkeys]] | Yes | Unit-level only | No | No |

Related: [[Provider Status]] · [[Bank Connections]] · [[AI Index]] · [[00 Project Index]]
