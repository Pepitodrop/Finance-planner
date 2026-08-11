---
type: system
domain: auth
status: implemented
---

# Session System

Covers [[Session Cookie]] issuance, [[Session Revocation]] (per-user, Postgres-backed), and the session-check that gates every authenticated page load ([[Authentication Loading]]). Implemented in [[session-revocation.js]] and [[security.js]].

Related: [[Security Index]] · [[Authentication]] · [[Login Flow]] · [[Logout Flow]]
