---
type: system
domain: data
status: implemented
---

# Persistence System

Top-level system covering all durable storage: [[PostgreSQL]] as canonical store, the browser [[Vault Encryption|encrypted vault]] as offline cache, and the [[Migrations System]] that evolves the schema. See [[Data and Persistence]] for the architecture-level narrative and [[Data Index]] for the atomic table-by-table breakdown.

Related: [[Data Index]] · [[Data and Persistence]] · [[System Architecture]]
