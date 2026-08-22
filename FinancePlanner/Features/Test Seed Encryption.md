---
type: feature
domain: security
status: implemented
---

# Test Seed Encryption

The GnuCOBOL test generator does not connect to PostgreSQL and never handles encryption keys. Node.js validates the generator output and encrypts the resulting payload with the same `CONNECTOR_MASTER_KEY` / user-ID AAD boundary used by normal cloud finance state before writing it to PostgreSQL.

Related: [[Test Data Seeding]] · [[Encryption Boundary (server)]]
