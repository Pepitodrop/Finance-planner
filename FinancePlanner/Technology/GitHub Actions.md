---
type: technology
domain: infrastructure
status: implemented
---

# GitHub Actions

- **Where used:** `.github/workflows/` — 9 workflows, see [[Testing and CI Index]]
- **Supply-chain hardening:** the Trivy container-scan step pins the third-party action to a commit SHA, not a mutable tag — specifically because `aquasecurity/trivy-action` itself was compromised in a March 2026 supply-chain attack affecting every tag `0.0.1`–`0.34.2` ([[Security Decisions]])

Related: [[Technology Index]] · [[Testing and CI Index]] · [[Deployment]]
