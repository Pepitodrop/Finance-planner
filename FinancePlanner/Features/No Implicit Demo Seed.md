---
type: feature
domain: data
status: implemented
---

# No Implicit Demo Seed

The former `reset-and-seed-demo.mjs` workflow and its package scripts were removed. No account provisioning path writes a financial payload implicitly.

Test finance data now requires a separate explicit operator action and is restricted to an internal `test:` identity. Production defaults remain empty.

Related: [[Empty Production Data]] · [[Test Data Seeding]] · [[Finance Data Cleanup]]
