---
type: test
domain: data
status: implemented
---

# Data Privacy Acceptance

`scripts/data-privacy-production-acceptance.mjs` — the script that once still required "reset" to promise reseeded example data (the exact bug PR #131 fixed); rewritten to require the honest "empty state, no example/demo data" copy. Verified as a CodeQL open-alert file (line-checked, not affected by this PR's diff — see [[CodeQL]]).

Related: [[Testing and CI Index]] · [[Legacy-Demo-State Cleanup]] · [[Data and Backup Page]]
