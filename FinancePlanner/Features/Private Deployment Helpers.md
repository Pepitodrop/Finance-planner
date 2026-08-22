---
type: feature
domain: deployment
status: operator-local
---

# Private Deployment Helpers

The owner's PR-test and production-main deployment helper scripts are intentionally not stored in this repository. They wrap the repository-owned `scripts/deploy.sh` from the operator environment only.

This keeps machine-specific deployment convenience separate from shared application source and prevents private operational preferences from becoming product behavior.

Related: [[Deployment]] · [[Production]]
